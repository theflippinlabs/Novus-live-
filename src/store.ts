import { useSyncExternalStore } from "react";
import { defaultSettings } from "../shared/settings";
import type {
  ActionRecord,
  AIStatus,
  AnalyzedComment,
  DemoStatus,
  LiveSessionInfo,
  LiveStats,
  ModerationAlert,
  RealtimeBatch,
  Settings,
  Snapshot,
  TikTokIntegrationStatus,
} from "../shared/types";

// Minimal external store fed by the SSE stream. Each slice keeps its own
// reference, so components subscribed to `stats` do not rerender when chat
// messages arrive, and the chat list only receives a new array per batch.

export type View = "live" | "alerts" | "viewers" | "assistant" | "analytics" | "settings";
export type Connection = "connecting" | "live" | "reconnecting" | "unauthorized";

const MAX_CHAT = 1500;

export interface AppState {
  connection: Connection;
  view: View;
  session: LiveSessionInfo | null;
  stats: LiveStats;
  comments: AnalyzedComment[];
  alerts: ModerationAlert[];
  lastActions: ActionRecord[];
  settings: Settings;
  ai: AIStatus;
  demo: DemoStatus;
  tiktok: TikTokIntegrationStatus | null;
  selectedViewerId: string | null;
  toast: { id: number; text: string; tone: "info" | "ok" | "warn" } | null;
  serverOffset: number;
}

const emptyStats: LiveStats = {
  messagesTotal: 0,
  messagesPerMinute: 0,
  viewerCount: 0,
  activeChatters: 0,
  uniqueChatters: 0,
  openAlerts: 0,
  criticalAlerts: 0,
  gifts: 0,
  follows: 0,
  joins: 0,
};

let state: AppState = {
  connection: "connecting",
  view: (sessionStorageGet("novus:view") as View) ?? "live",
  session: null,
  stats: emptyStats,
  comments: [],
  alerts: [],
  lastActions: [],
  settings: defaultSettings(),
  ai: { state: "local_only", provider: "local", queued: 0, analyzed: 0 },
  demo: { running: false, speed: 1, demoSecond: 0 },
  tiktok: null,
  selectedViewerId: null,
  toast: null,
  serverOffset: 0,
};

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export function navigate(view: View): void {
  try {
    sessionStorage.setItem("novus:view", view);
  } catch {
    /* ignore */
  }
  setState({ view });
}

export function openViewer(id: string | null): void {
  setState({ selectedViewerId: id });
}

let toastSeq = 0;
export function toast(text: string, tone: "info" | "ok" | "warn" = "info"): void {
  const id = ++toastSeq;
  setState({ toast: { id, text, tone } });
  setTimeout(() => {
    if (state.toast?.id === id) setState({ toast: null });
  }, 3200);
}

const statusRank = { open: 0, watching: 1, resolved: 2, dismissed: 3 } as const;
const sevRank = { normal: 0, watch: 1, warning: 2, critical: 3 } as const;

export function sortAlerts(list: ModerationAlert[]): ModerationAlert[] {
  return [...list].sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      sevRank[b.severity] - sevRank[a.severity] ||
      b.riskScore - a.riskScore ||
      b.updatedAt - a.updatedAt,
  );
}

function applySnapshot(s: Snapshot): void {
  setState({
    session: s.session,
    stats: s.stats,
    comments: s.comments,
    alerts: sortAlerts(s.alerts),
    settings: s.settings,
    ai: s.ai,
    demo: s.demo,
    tiktok: s.tiktok,
    serverOffset: s.serverTime - Date.now(),
  });
}

function applyBatch(b: RealtimeBatch): void {
  const patch: Partial<AppState> = {};
  let comments = b.reset ? [] : state.comments;
  let alerts = b.reset ? [] : state.alerts;

  if (b.commentUpdates.length) {
    const updates = new Map(b.commentUpdates.map((c) => [c.id, c]));
    // Only replace the objects that changed; untouched rows keep identity (no rerender).
    comments = comments.map((c) => updates.get(c.id) ?? c);
  }
  if (b.comments.length) {
    comments = comments.concat(b.comments);
    if (comments.length > MAX_CHAT) comments = comments.slice(comments.length - MAX_CHAT);
  }
  if (comments !== state.comments) patch.comments = comments;

  if (b.alerts.length) {
    const byId = new Map(alerts.map((a) => [a.id, a]));
    for (const a of b.alerts) byId.set(a.id, a);
    alerts = sortAlerts([...byId.values()]).slice(0, 400);
  }
  if (alerts !== state.alerts) patch.alerts = alerts;

  if (b.actions.length) patch.lastActions = state.lastActions.concat(b.actions).slice(-50);
  if (b.stats) patch.stats = b.stats;
  if (b.session !== undefined) patch.session = b.session;
  if (b.ai) patch.ai = b.ai;
  if (b.demo) patch.demo = b.demo;
  if (b.tiktok) patch.tiktok = b.tiktok;
  if (b.settings) patch.settings = b.settings;
  if (Object.keys(patch).length) setState(patch);
}

let source: EventSource | null = null;

export function connectRealtime(onUnauthorized: () => void): () => void {
  source?.close();
  const es = new EventSource("/api/stream");
  source = es;
  es.addEventListener("snapshot", (e) => {
    applySnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot);
    setState({ connection: "live" });
  });
  es.addEventListener("batch", (e) => applyBatch(JSON.parse((e as MessageEvent<string>).data) as RealtimeBatch));
  es.onerror = () => {
    setState({ connection: "reconnecting" });
    // EventSource cannot see status codes; check whether we were logged out.
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((s: { required: boolean; authenticated: boolean }) => {
        if (s.required && !s.authenticated) {
          es.close();
          setState({ connection: "unauthorized" });
          onUnauthorized();
        }
      })
      .catch(() => undefined);
  };
  return () => es.close();
}

/** Merge a single alert returned by an API call (the SSE batch will also confirm it). */
export function upsertAlert(a: ModerationAlert): void {
  const byId = new Map(state.alerts.map((x) => [x.id, x]));
  byId.set(a.id, a);
  setState({ alerts: sortAlerts([...byId.values()]) });
}

export function serverNow(): number {
  return Date.now() + state.serverOffset;
}
