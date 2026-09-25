import type {
  ActionRecord,
  ActionType,
  AnalyticsSummary,
  CatchUp,
  ChatSenderStatus,
  ChatPulse,
  DemoSpeed,
  HistoryEntry,
  LiveSessionInfo,
  ModerationAlert,
  RoomSummary,
  Settings,
  StreamReport,
  TikTokIntegrationStatus,
  ViewerFlag,
  ViewerListItem,
  ViewerProfile,
} from "../shared/types";
import { getState } from "./store";

// Thin typed client. The browser only ever talks to the Novus server —
// never to Anthropic, Supabase or TikTok, and never holds a secret.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Novus-Room": getState().room,
      ...(body !== undefined || method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export const api = {
  authStatus: () => request<{ required: boolean; authenticated: boolean }>("GET", "/auth/status"),
  login: (key: string) => request<{ ok: boolean }>("POST", "/auth/login", { key }),
  logout: () => request<{ ok: boolean }>("POST", "/auth/logout"),

  startDemo: (speed: DemoSpeed) => request<{ session: LiveSessionInfo }>("POST", "/demo/start", { speed }),
  setDemoSpeed: (speed: DemoSpeed) => request<{ ok: boolean }>("POST", "/demo/speed", { speed }),
  endSession: () => request<{ session: LiveSessionInfo | null; report: StreamReport | null }>("POST", "/session/end"),

  alertAction: (id: string, action: ActionType, note?: string) =>
    request<{ record: ActionRecord; alert: ModerationAlert }>("POST", `/alerts/${encodeURIComponent(id)}/action`, { action, note }),
  confirmAction: (id: string) => request<{ record: ActionRecord }>("POST", `/actions/${encodeURIComponent(id)}/confirm`),
  sendToChat: (id: string, text: string) => request<{ record: ActionRecord | null }>("POST", `/actions/${encodeURIComponent(id)}/send-chat`, { text }),
  chatSender: () => request<ChatSenderStatus>("GET", "/chat-sender"),
  chatSenderConnect: () => request<{ url: string }>("POST", "/chat-sender/connect"),
  chatSenderDisconnect: () => request<ChatSenderStatus>("POST", "/chat-sender/disconnect"),

  viewers: (params: { q?: string; sort?: string; filter?: string }) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<{ viewers: ViewerListItem[] }>("GET", `/viewers${qs ? `?${qs}` : ""}`);
  },
  viewer: (id: string) => request<{ profile: ViewerProfile; alerts: ModerationAlert[] }>("GET", `/viewers/${encodeURIComponent(id)}`),
  setFlag: (id: string, flag: ViewerFlag | null) => request<{ profile: ViewerProfile }>("POST", `/viewers/${encodeURIComponent(id)}/flag`, { flag }),
  viewerAction: (id: string, action: ActionType) =>
    request<{ record: ActionRecord; profile: ViewerProfile }>("POST", `/viewers/${encodeURIComponent(id)}/action`, { action }),

  pulse: () => request<ChatPulse>("GET", "/assistant/pulse"),
  catchUp: (since: number | undefined, lang: "en" | "fr") => request<CatchUp>("POST", "/assistant/catchup", since ? { since, lang } : { lang }),
  markAnswered: (id: string, answered: boolean) => request<{ ok: boolean }>("POST", `/assistant/questions/${encodeURIComponent(id)}/answered`, { answered }),

  analytics: () => request<AnalyticsSummary>("GET", "/analytics"),
  history: () => request<{ entries: HistoryEntry[] }>("GET", "/history"),
  historyDetail: (id: string) => request<{ entry: HistoryEntry; analytics: AnalyticsSummary }>("GET", `/history/${encodeURIComponent(id)}`),

  settings: () => request<Settings>("GET", "/settings"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("PUT", "/settings", patch),

  rooms: () => request<{ rooms: RoomSummary[] }>("GET", "/rooms"),
  setRecording: (action: "start" | "stop") => request<{ session: LiveSessionInfo | null; rooms: RoomSummary[] }>("POST", "/rooms/recording", { action }),
  tiktok: () => request<TikTokIntegrationStatus>("GET", "/integrations/tiktok"),
  tiktokConnect: (username: string) => request<TikTokIntegrationStatus & { room: string }>("POST", "/integrations/tiktok/connect", { username }),
  tiktokDisconnect: () => request<TikTokIntegrationStatus>("POST", "/integrations/tiktok/disconnect"),
};

/**
 * Download a report/export. On iPhone the share sheet is the reliable way to save a
 * file from an installed web app ("Save to Files", AirDrop, Mail…); elsewhere a
 * regular download is used. Returns the file when sharing needs a fresh tap.
 */
export async function fetchExport(path: string, fallbackName: string): Promise<File> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "X-Novus-Room": getState().room } });
  if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

/** Share (mobile) or download (desktop). Throws "needs_tap" when the browser wants a new user gesture. */
export async function saveFile(file: File): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (mobile && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return;
      if ((e as DOMException)?.name === "NotAllowedError") throw new Error("needs_tap", { cause: e });
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
