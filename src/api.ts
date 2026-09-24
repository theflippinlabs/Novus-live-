import type {
  ActionRecord,
  ActionType,
  AnalyticsSummary,
  CatchUp,
  ChatPulse,
  DemoSpeed,
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

  viewers: (params: { q?: string; sort?: string; filter?: string }) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<{ viewers: ViewerListItem[] }>("GET", `/viewers${qs ? `?${qs}` : ""}`);
  },
  viewer: (id: string) => request<{ profile: ViewerProfile; alerts: ModerationAlert[] }>("GET", `/viewers/${encodeURIComponent(id)}`),
  setFlag: (id: string, flag: ViewerFlag | null) => request<{ profile: ViewerProfile }>("POST", `/viewers/${encodeURIComponent(id)}/flag`, { flag }),
  viewerAction: (id: string, action: ActionType) =>
    request<{ record: ActionRecord; profile: ViewerProfile }>("POST", `/viewers/${encodeURIComponent(id)}/action`, { action }),

  pulse: () => request<ChatPulse>("GET", "/assistant/pulse"),
  catchUp: (since?: number) => request<CatchUp>("POST", "/assistant/catchup", since ? { since } : {}),
  markAnswered: (id: string, answered: boolean) => request<{ ok: boolean }>("POST", `/assistant/questions/${encodeURIComponent(id)}/answered`, { answered }),

  analytics: () => request<AnalyticsSummary>("GET", "/analytics"),
  report: () => request<StreamReport>("GET", "/report"),

  settings: () => request<Settings>("GET", "/settings"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("PUT", "/settings", patch),

  rooms: () => request<{ rooms: RoomSummary[] }>("GET", "/rooms"),
  tiktok: () => request<TikTokIntegrationStatus>("GET", "/integrations/tiktok"),
  tiktokConnect: (username: string) => request<TikTokIntegrationStatus & { room: string }>("POST", "/integrations/tiktok/connect", { username }),
  tiktokDisconnect: () => request<TikTokIntegrationStatus>("POST", "/integrations/tiktok/disconnect"),
};
