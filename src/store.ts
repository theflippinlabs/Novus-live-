import { useSyncExternalStore } from "react";
import { defaultSettings } from "../shared/settings";
import type {
  ActionRecord,
  AIStatus,
  AnalyzedComment,
  BillingMe,
  ChatSenderStatus,
  Me,
  DemoStatus,
  LiveSessionInfo,
  LiveStats,
  ModerationAlert,
  RealtimeBatch,
  RoomSummary,
  Settings,
  Snapshot,
  TikTokIntegrationStatus,
} from "../shared/types";

// Minimal external store fed by the SSE stream. Each slice keeps its own
// reference, so components subscribed to `stats` do not rerender when chat
// messages arrive, and the chat list only receives a new array per batch.

export type View = "live" | "alerts" | "viewers" | "assistant" | "analytics" | "settings" | "admin";
/** A sub-page of Settings (null = the menu). */
export type SettingsPage = "profile" | "billing" | "team" | "moderation" | "lists" | "ai" | "tiktok" | "app";
export type Connection = "connecting" | "live" | "reconnecting" | "unauthorized";

const MAX_CHAT = 1500;

export interface AppState {
  connection: Connection;
  /** The moderation room on screen: "main" (demo/connector) or "tt:<handle>". */
  room: string;
  rooms: RoomSummary[];
  view: View;
  settingsPage: SettingsPage | null;
  session: LiveSessionInfo | null;
  stats: LiveStats;
  comments: AnalyzedComment[];
  alerts: ModerationAlert[];
  lastActions: ActionRecord[];
  settings: Settings;
  ai: AIStatus;
  demo: DemoStatus;
  tiktok: TikTokIntegrationStatus | null;
  /** "Send in chat": the moderator's TikTok account connected through Euler OAuth. */
  chatSender: ChatSenderStatus | null;
  /** Who is logged in: the founder, or a team member with limited rights. */
  me: Me | null;
  /** The workspace's plan, limits and usage (billing). */
  billing: BillingMe | null;
  /** A plan limit was hit: which one (shows the contextual upgrade prompt). */
  upgrade: string | null;
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
  room: localGet("novus:room") ?? "main",
  rooms: [],
  view: (sessionStorageGet("novus:view") as View) ?? "live",
  settingsPage: (sessionStorageGet("novus:settings-page") as SettingsPage | null) ?? null,
  session: null,
  stats: emptyStats,
  comments: [],
  alerts: [],
  lastActions: [],
  // The device's language applies until the server settings arrive (e.g. on the login screen).
  settings: { ...defaultSettings(), language: localGet("novus:lang") === "fr" ? "fr" : localGet("novus:lang") === "en" ? "en" : defaultSettings().language },
  ai: { state: "local_only", provider: "local", queued: 0, analyzed: 0 },
  demo: { running: false, speed: 1, demoSecond: 0 },
  tiktok: null,
  chatSender: null,
  me: null,
  billing: null,
  upgrade: null,
  selectedViewerId: null,
  toast: null,
  serverOffset: 0,
};

function localGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** A team member limited to some streamers only sees their rooms (the server enforces it too). */
export function visible(rooms: RoomSummary[]): RoomSummary[] {
  const scope = state.me?.accounts;
  return scope ? rooms.filter((r) => r.kind !== "tiktok" || (r.username && scope.includes(r.username.toLowerCase()))) : rooms;
}

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
  // Tapping Settings again goes back to its menu.
  if (view === "settings" && state.view === "settings") return openSettings(null);
  setState({ view });
}

/** Open Settings on one of its sub-pages (or its menu). */
export function openSettings(page: SettingsPage | null): void {
  try {
    sessionStorage.setItem("novus:view", "settings");
    if (page) sessionStorage.setItem("novus:settings-page", page);
    else sessionStorage.removeItem("novus:settings-page");
  } catch {
    /* ignore */
  }
  setState({ view: "settings", settingsPage: page });
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

/** The language picked on this device wins over the saved one (it may have been chosen on the login screen). */
function withDeviceLanguage(settings: Settings): Settings {
  const device = localGet("novus:lang");
  if ((device !== "en" && device !== "fr") || device === settings.language) return settings;
  void fetch("/api/settings", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: device }),
  }).catch(() => undefined);
  return { ...settings, language: device };
}

/**
 * An installed iPhone app can stay suspended in memory for days and keep running an old
 * version. Each (re)connection tells us which bundle the server ships: reload onto it.
 */
function reloadIfOutdated(build: string | undefined): void {
  const bundles = [...document.scripts].map((s) => s.src).filter((src) => src.includes("/assets/"));
  // Dev server (no built bundle) or already on the shipped version: nothing to do.
  if (!build || !bundles.length || bundles.some((src) => src.includes(`/assets/${build}`))) return;
  try {
    // Never loop: one reload attempt per new version.
    if (sessionStorage.getItem("novus:reloadedFor") === build) return;
    sessionStorage.setItem("novus:reloadedFor", build);
  } catch {
    return;
  }
  location.reload();
}

function applySnapshot(s: Snapshot): void {
  reloadIfOutdated(s.build);
  setState({
    room: s.room,
    rooms: visible(s.rooms),
    session: s.session,
    stats: s.stats,
    comments: s.comments,
    alerts: sortAlerts(s.alerts),
    settings: withDeviceLanguage(s.settings),
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
  if (b.settings) {
    const device = localGet("novus:lang");
    patch.settings = device === "en" || device === "fr" ? { ...b.settings, language: device } : b.settings;
  }
  if (b.rooms) patch.rooms = visible(b.rooms);
  if (Object.keys(patch).length) setState(patch);
}

let source: EventSource | null = null;
let unauthorizedHandler: () => void = () => undefined;

/** Show another room: clear the previous room's live data and resubscribe to its stream. */
export function switchRoom(id: string): void {
  if (id === state.room && source) return;
  try {
    localStorage.setItem("novus:room", id);
  } catch {
    /* ignore */
  }
  setState({ room: id, session: null, stats: emptyStats, comments: [], alerts: [], lastActions: [], selectedViewerId: null, connection: "connecting" });
  if (source) connectRealtime(unauthorizedHandler);
}

export function connectRealtime(onUnauthorized: () => void): () => void {
  unauthorizedHandler = onUnauthorized;
  source?.close();
  const es = new EventSource(`/api/stream?room=${encodeURIComponent(state.room)}`);
  source = es;
  es.addEventListener("snapshot", (e) => {
    applySnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot);
    setState({ connection: "live" });
  });
  es.addEventListener("batch", (e) => applyBatch(JSON.parse((e as MessageEvent<string>).data) as RealtimeBatch));
  es.onerror = () => {
    setState({ connection: "reconnecting" });
    // EventSource cannot see status codes; check whether we were logged out.
    const room = state.room;
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then(async (s: { required: boolean; authenticated: boolean }) => {
        // The followed account was removed: fall back to the main room.
        if (room !== "main" && !(s.required && !s.authenticated)) {
          const r = await fetch("/api/rooms", { credentials: "same-origin" });
          const { rooms } = (await r.json()) as { rooms: RoomSummary[] };
          if (!rooms.some((x) => x.id === room)) switchRoom("main");
          return;
        }
        if (s.required && !s.authenticated) {
          es.close();
          setState({ connection: "unauthorized" });
          onUnauthorized();
        }
      })
      .catch(() => undefined);
  };
  return () => {
    es.close();
    if (source === es) source = null;
  };
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
