import type { PushPrefs } from "./push";
import type {
  CoachTip,
  StatsInsights,
  DonorDirectory,
  Leaderboard,
  GoalProgress,
  VideoInfo,
  VideoLibrary,
  SubtitleCue,
  SubtitleStatus,
  CopilotTurn,
  ActionRecord,
  ActionType,
  AnalyticsSummary,
  CatchUp,
  ChatSenderStatus,
  ChatPulse,
  DemoSpeed,
  HistoryEntry,
  LiveSessionInfo,
  Me,
  Permission,
  TeamMember,
  TeamRole,
  ModerationAlert,
  RoomSummary,
  Settings,
  StreamReport,
  TikTokIntegrationStatus,
  ViewerFlag,
  ViewerListItem,
  ViewerProfile, LiveSafetyEvent, SafetyCounts } from "../shared/types";
import { getState } from "./store";

// Thin typed client. The browser only ever talks to the Novus server —
// never to Anthropic, Supabase or TikTok, and never holds a secret.

export interface MemberDraft {
  name: string;
  role: TeamRole;
  permissions: Permission[];
  accounts: string[] | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Called when the API refuses an action because of the plan (402): shows the upgrade prompt. */
let on402: (code: string) => void = () => undefined;
export function setPlanLimitHandler(fn: (code: string) => void): void {
  on402 = fn;
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
    if (res.status === 402) on402(code);
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

/** TikTok mute lengths (seconds; -1 = until unmuted). */
export type MuteSeconds = 5 | 30 | 60 | 300 | -1;

export const api = {
  authStatus: () => request<{ required: boolean; authenticated: boolean }>("GET", "/auth/status"),
  login: (key: string) => request<{ ok: boolean }>("POST", "/auth/login", { key }),
  logout: () => request<{ ok: boolean }>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/auth/me"),
  team: () => request<{ members: TeamMember[] }>("GET", "/team"),
  addMember: (m: MemberDraft) => request<{ member: TeamMember; code: string }>("POST", "/team", m),
  updateMember: (id: string, patch: Partial<MemberDraft> & { disabled?: boolean }) => request<{ member: TeamMember }>("PATCH", `/team/${encodeURIComponent(id)}`, patch),
  newMemberCode: (id: string) => request<{ member: TeamMember; code: string }>("POST", `/team/${encodeURIComponent(id)}/code`),
  removeMember: (id: string) => request<{ ok: boolean }>("DELETE", `/team/${encodeURIComponent(id)}`),

  startDemo: (speed: DemoSpeed) => request<{ session: LiveSessionInfo }>("POST", "/demo/start", { speed }),
  setDemoSpeed: (speed: DemoSpeed) => request<{ ok: boolean }>("POST", "/demo/speed", { speed }),
  endSession: () => request<{ session: LiveSessionInfo | null; report: StreamReport | null }>("POST", "/session/end"),

  alertAction: (id: string, action: ActionType, note?: string, muteSeconds?: MuteSeconds) =>
    request<{ record: ActionRecord; alert: ModerationAlert }>("POST", `/alerts/${encodeURIComponent(id)}/action`, { action, note, muteSeconds }),
  setComments: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/live/comments", { enabled }),
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
  viewerAction: (id: string, action: ActionType, muteSeconds?: MuteSeconds) =>
    request<{ record: ActionRecord; profile: ViewerProfile }>("POST", `/viewers/${encodeURIComponent(id)}/action`, { action, muteSeconds }),

  pulse: () => request<ChatPulse>("GET", "/assistant/pulse"),
  pushConfig: () => request<{ publicKey: string | null }>("GET", "/push/config"),
  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, prefs: PushPrefs) => request<{ subscribed: boolean; prefs: PushPrefs }>("POST", "/push/subscribe", { subscription, prefs }),
  pushNativeSubscribe: (token: string, prefs: PushPrefs) => request<{ subscribed: boolean; prefs: PushPrefs; endpoint: string }>("POST", "/push/native-subscribe", { token, prefs }),
  pushStatus: (endpoint: string) => request<{ subscribed: boolean; prefs: PushPrefs }>("POST", "/push/status", { endpoint }),
  pushPrefs: (endpoint: string, prefs: PushPrefs) => request<{ prefs: PushPrefs }>("PUT", "/push/prefs", { endpoint, prefs }),
  pushUnsubscribe: (endpoint: string) => request<{ subscribed: boolean }>("POST", "/push/unsubscribe", { endpoint }),
  pushTest: (endpoint: string) => request<{ sent: boolean }>("POST", "/push/test", { endpoint }),
  coach: (lang: "en" | "fr") => request<{ tips: CoachTip[] }>("GET", `/assistant/coach?lang=${lang}`),
  askCopilot: (question: string, history: CopilotTurn[], lang: "en" | "fr") => request<{ text: string }>("POST", "/assistant/ask", { question, history, lang }),
  draftMessage: (b: { kind: "question" | "thanks" | "welcome" | "revive"; questionId?: string; viewerId?: string }, lang: "en" | "fr") => request<{ text: string }>("POST", "/assistant/draft", { ...b, lang }),
  copilotSendChat: (text: string) => request<{ ok: boolean }>("POST", "/assistant/send-chat", { text }),
  catchUp: (since: number | undefined, lang: "en" | "fr") => request<CatchUp>("POST", "/assistant/catchup", since ? { since, lang } : { lang }),
  markAnswered: (id: string, answered: boolean) => request<{ ok: boolean }>("POST", `/assistant/questions/${encodeURIComponent(id)}/answered`, { answered }),

  analytics: () => request<AnalyticsSummary>("GET", "/analytics"),
  donors: (days: number, account: string) => request<DonorDirectory>("GET", `/donors?days=${days}${account ? `&account=${encodeURIComponent(account)}` : ""}`),
  leaderboard: (days: number) => request<Leaderboard>("GET", `/leaderboard${days ? `?days=${days}` : ""}`),
  video: (sessionId: string) => request<VideoInfo>("GET", `/history/${encodeURIComponent(sessionId)}/video`),
  videos: () => request<VideoLibrary>("GET", "/videos"),
  watch: () => request<{ url: string; delayed: boolean }>("GET", "/rooms/watch"),
  watchCrop: () => request<{ crop: { x: number; y: number; w: number; h: number } | null }>("GET", "/rooms/watch/crop"),
  subtitles: (sessionId: string, lang?: "fr" | "en") => request<SubtitleStatus & { minutesNeeded: number; cues?: SubtitleCue[] }>("GET", `/history/${encodeURIComponent(sessionId)}/subtitles${lang ? `?lang=${lang}` : ""}`),
  makeSubtitles: (sessionId: string, lang: "fr" | "en") => request<SubtitleStatus>("POST", `/history/${encodeURIComponent(sessionId)}/subtitles`, { lang }),
  translate: (texts: string[], target: "en" | "fr") => request<{ translations: string[]; available: boolean }>("POST", "/translate", { texts, target }),
  keepVideo: (sessionId: string, keep: boolean) => request<VideoInfo>("POST", `/history/${encodeURIComponent(sessionId)}/video/keep`, { keep }),
  insights: () => request<StatsInsights>("GET", "/analytics/insights"),
  historyInsights: (id: string) => request<StatsInsights>("GET", `/history/${encodeURIComponent(id)}/insights`),
  askStats: (question: string, history: CopilotTurn[], sessionId: string | undefined, lang: "en" | "fr") => request<{ text: string }>("POST", "/analytics/ask", { question, history, sessionId, lang }),
  history: () => request<{ entries: HistoryEntry[] }>("GET", "/history"),
  /** Safety events of the current LIVE (no id) or of a past one. */
  safety: (sessionId?: string) => request<{ events: LiveSafetyEvent[] }>("GET", sessionId ? `/history/${encodeURIComponent(sessionId)}/safety` : "/safety"),
  analyzeSafety: (eventId: string, sessionId: string | undefined, lang: "en" | "fr") => request<{ event: LiveSafetyEvent }>("POST", `/safety/${encodeURIComponent(eventId)}/analysis`, { sessionId, lang }),
  safetySummary: (days = 0) => request<{ lives: number; totals: SafetyCounts; perLive: number | null; perHour: number | null }>("GET", `/safety/summary?days=${days}`),
  historyDetail: (id: string) => request<{ entry: HistoryEntry; analytics: AnalyticsSummary }>("GET", `/history/${encodeURIComponent(id)}`),

  settings: () => request<Settings>("GET", "/settings"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("PUT", "/settings", patch),
  goals: () => request<GoalProgress>("GET", "/goals"),

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
