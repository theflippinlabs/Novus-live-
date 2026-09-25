// Platform-independent domain model shared by the server and the client.
// Nothing in this file knows about TikTok or any other platform.

export type PlatformId = "mock" | "tiktok" | "external";

export type Severity = "normal" | "watch" | "warning" | "critical";
export const SEVERITIES: Severity[] = ["normal", "watch", "warning", "critical"];

export type RecommendedAction = "none" | "watch" | "warn" | "mute" | "block" | "report";

export const CATEGORIES = [
  "spam",
  "flooding",
  "repetition",
  "insult",
  "harassment",
  "threat",
  "hate",
  "sexual_harassment",
  "scam",
  "suspicious_link",
  "impersonation",
  "doxxing",
  "coordinated_attack",
  "escalation",
  "banned_phrase",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ViewerRef {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

interface BaseEvent {
  id: string;
  sessionId: string;
  platform: PlatformId;
  timestamp: number;
}

export interface LiveComment extends BaseEvent {
  type: "comment";
  viewer: ViewerRef;
  text: string;
  language?: string;
}

export interface LiveViewer extends BaseEvent {
  type: "viewer_count";
  count: number;
}

export interface LiveGift extends BaseEvent {
  type: "gift";
  viewer: ViewerRef;
  giftName: string;
  count: number;
  value?: number;
}

export interface LiveFollow extends BaseEvent {
  type: "follow";
  viewer: ViewerRef;
}

export interface LiveJoin extends BaseEvent {
  type: "join";
  viewer: ViewerRef;
}

/** A moderation action that happened on the platform itself (e.g. reported by a connector). */
export interface LiveModerationEvent extends BaseEvent {
  type: "moderation";
  viewer?: ViewerRef;
  action: string;
  detail?: string;
}

export interface LiveStreamStatusEvent extends BaseEvent {
  type: "stream_status";
  status: "started" | "ended";
  title?: string;
}

export type LiveEvent =
  | LiveComment
  | LiveViewer
  | LiveGift
  | LiveFollow
  | LiveJoin
  | LiveModerationEvent
  | LiveStreamStatusEvent;

export interface ModerationAnalysis {
  riskScore: number;
  severity: Severity;
  categories: Category[];
  explanation: string;
  /** The explanation in both languages (absent on rows saved by older versions). */
  explanationI18n?: { en: string; fr: string };
  recommendedAction: RecommendedAction;
  confidence: number;
  /** Human readable, compact reason indicators ("Targeted threat", "Repeated 4x"). */
  reasons: string[];
  stage: "heuristic" | "ai";
  /** True when stage 1 queued the message for contextual AI review. */
  aiPending?: boolean;
}

export interface AnalyzedComment extends LiveComment {
  analysis: ModerationAnalysis;
}

export type AlertStatus = "open" | "watching" | "resolved" | "dismissed";

export interface ModerationAlert {
  id: string;
  sessionId: string;
  viewer: ViewerRef;
  commentId: string;
  text: string;
  riskScore: number;
  severity: Severity;
  categories: Category[];
  reasons: string[];
  explanation: string;
  explanationI18n?: { en: string; fr: string };
  recommendedAction: RecommendedAction;
  confidence: number;
  stage: "heuristic" | "ai";
  createdAt: number;
  updatedAt: number;
  status: AlertStatus;
  /** Number of messages merged into this alert (same viewer, still open). */
  occurrences: number;
  relatedCommentIds: string[];
  /** Other accounts taking part in the same coordinated burst (grouped into one alert). */
  accounts?: ViewerRef[];
  resolution?: ActionRecord;
}

export type ActionType = "watch" | "warn" | "mute" | "block" | "report" | "dismiss";
export const ACTION_TYPES: ActionType[] = ["watch", "warn", "mute", "block", "report", "dismiss"];

/**
 * executed         — the adapter performed the action through an authorized API.
 * simulated        — demo mode: applied to the mock platform only.
 * manual_required  — no authorized API: the moderator must do it inside the platform app.
 * recorded         — local-only bookkeeping action (watch / dismiss).
 * failed           — the adapter tried and failed.
 */
export type ActionStatus = "executed" | "simulated" | "manual_required" | "recorded" | "failed";

export interface ActionRecord {
  id: string;
  sessionId: string;
  alertId?: string;
  viewer: ViewerRef;
  action: ActionType;
  status: ActionStatus;
  adapter: string;
  message: string;
  /** Exact steps for the moderator when status is manual_required. */
  instructions?: string[];
  /** Suggested chat text (e.g. for a warning) the moderator can paste. */
  suggestedMessage?: string;
  /** Message, steps and suggested text in both languages. */
  i18n?: Partial<Record<"en" | "fr", ActionCopy>>;
  note?: string;
  performedAt: number;
  /** ms between alert creation and this action. */
  responseTimeMs?: number;
  /** Set when the moderator confirms a manual action was done in-app. */
  confirmedAt?: number;
  /** Set when the suggested message was posted in the LIVE chat from Novus. */
  sentToChatAt?: number;
}

export interface ActionCopy {
  message: string;
  instructions?: string[];
  suggestedMessage?: string;
}

export type ViewerFlag = "trusted" | "watchlist" | "ignored";

export interface RiskPoint {
  t: number;
  score: number;
}

export interface ViewerCommentSummary {
  id: string;
  text: string;
  t: number;
  riskScore: number;
  severity: Severity;
}

export interface ViewerProfile {
  viewer: ViewerRef;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  messagesPerMinute: number;
  warnings: number;
  alertIds: string[];
  riskTrend: RiskPoint[];
  recentComments: ViewerCommentSummary[];
  categories: Partial<Record<Category, number>>;
  flag: ViewerFlag | null;
  assessment: ModerationAnalysis | null;
  actions: ActionRecord[];
  gifts: number;
  maxRisk: number;
  language?: string;
}

export type ViewerListItem = Omit<ViewerProfile, "recentComments" | "riskTrend" | "actions"> & {
  lastRisk: number;
};

export type Sensitivity = "low" | "balanced" | "strict" | "custom";

export interface Thresholds {
  watch: number;
  warning: number;
  critical: number;
}

export interface Settings {
  sensitivity: Sensitivity;
  customThresholds: Thresholds;
  categories: Record<Category, boolean>;
  bannedPhrases: string[];
  trustedUsers: string[];
  watchlist: string[];
  language: "en" | "fr";
  streamerName: string;
  aiEnabled: boolean;
  /** TikTok account whose LIVE the connector follows ("" = none). */
  tiktokUsername: string;
  /** Saved TikTok accounts the owner can switch between (without "@"). */
  tiktokProfiles: string[];
  /** Folders to organize followed accounts; an account belongs to at most one group. */
  tiktokGroups: TikTokGroup[];
  /**
   * Followed accounts in MANUAL mode (lowercase): their LIVE is detected but only recorded
   * once the moderator taps "Start recording". Every other account records automatically.
   */
  tiktokManual: string[];
}

export interface TikTokGroup {
  id: string;
  name: string;
  /** Followed accounts in this group (lowercase, without "@"). */
  members: string[];
}

export type SessionStatus = "idle" | "live" | "ended";

export interface LiveSessionInfo {
  id: string;
  platform: PlatformId;
  source: "demo" | "tiktok" | "external";
  title: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  /** TikTok account (without "@") this LIVE belongs to; absent for demo/connector sessions. */
  account?: string;
}

export interface LiveStats {
  messagesTotal: number;
  messagesPerMinute: number;
  viewerCount: number;
  activeChatters: number;
  uniqueChatters: number;
  openAlerts: number;
  criticalAlerts: number;
  gifts: number;
  follows: number;
  joins: number;
}

export type AIStatusState = "active" | "local_only" | "disabled" | "degraded";

export interface AIStatus {
  state: AIStatusState;
  provider: string;
  model?: string;
  queued: number;
  analyzed: number;
  lastError?: string;
}

export type TikTokIntegrationState =
  | "NOT_CONNECTED"
  | "CONNECTOR_AVAILABLE"
  | "CONNECTED"
  | "LIVE_DETECTED"
  | "LIVE_ENDED"
  | "ERROR";

export interface CapabilityInfo {
  capability: string;
  status: "implemented" | "requires_authorized_connector" | "manual_only" | "not_available";
  detail: string;
}

/** "Send in chat": the moderator's TikTok account connected through Euler Stream OAuth. */
export interface ChatSenderStatus {
  /** Server has the Euler API key + OAuth client configured. */
  configured: boolean;
  connected: boolean;
  username?: string;
  nickname?: string;
  connectedAt?: number;
  lastError?: string;
}

export interface TikTokIntegrationStatus {
  state: TikTokIntegrationState;
  username?: string;
  connectorConfigured: boolean;
  lastEventAt?: number;
  error?: string;
  /** Human-readable connector status, e.g. "Waiting for @x to go LIVE". */
  detail?: string;
  /** Which source feeds events: an authorized connector push, or the unofficial live connector. */
  source?: "connector_push" | "unofficial_live_connector";
  capabilities: CapabilityInfo[];
}

export type DemoSpeed = 1 | 5 | 20;

export interface DemoStatus {
  running: boolean;
  speed: DemoSpeed;
  demoSecond: number;
}

export interface QuestionCluster {
  id: string;
  question: string;
  count: number;
  askers: string[];
  firstAskedAt: number;
  lastAskedAt: number;
  answered: boolean;
}

export interface TopicTrend {
  topic: string;
  count: number;
  growth: number;
}

export interface ImportantMessage {
  commentId: string;
  viewer: ViewerRef;
  text: string;
  reason: string;
  t: number;
}

export interface SentimentPoint {
  t: number;
  value: number;
}

export interface ChatPulse {
  generatedAt: number;
  messagesTotal: number;
  activeViewers: number;
  viewerCount: number;
  messagesPerMinute: number;
  activityChangePct: number;
  trending: TopicTrend[];
  topQuestions: QuestionCluster[];
  topUnanswered: QuestionCluster | null;
  repeatedRequests: QuestionCluster[];
  sentiment: { current: number; label: string; change: number; shift: string | null };
  sentimentSeries: SentimentPoint[];
  importantMessages: ImportantMessage[];
  spikes: { t: number; messages: number }[];
  viewersNeedingAttention: number;
}

export interface CatchUpSection {
  title: string;
  items: string[];
}

export interface CatchUp {
  since: number;
  until: number;
  headline: string;
  sections: CatchUpSection[];
  narrative?: string;
  source: "local" | "ai";
}

export interface MinuteBucket {
  t: number;
  /** Highest audience reported by the platform during the minute (0 when unknown). */
  viewers?: number;
  messages: number;
  alerts: number;
  toxicity: number;
  avgRisk: number;
  sentiment: number;
}

export interface AnalyticsSummary {
  session: LiveSessionInfo | null;
  totals: {
    messages: number;
    uniqueChatters: number;
    alerts: number;
    critical: number;
    warnings: number;
    muteRecommendations: number;
    blockRecommendations: number;
    reportRecommendations: number;
    actions: number;
    manualActions: number;
    gifts: number;
    follows: number;
  };
  peak: { t: number; messages: number } | null;
  buckets: MinuteBucket[];
  topParticipants: { viewer: ViewerRef; messages: number; maxRisk: number }[];
  topQuestions: QuestionCluster[];
  topTopics: TopicTrend[];
  categoryCounts: Partial<Record<Category, number>>;
  avgResponseTimeMs: number | null;
  durationMs: number;
  /** Added for LIVE history and PDF exports; absent in summaries saved by older versions. */
  audience?: AudienceStats;
  gifts?: GiftStats;
  incidents?: IncidentRecord[];
  moderationLog?: ModerationLogEntry[];
}

export interface AudienceStats {
  peakViewers: number;
  peakAt: number | null;
  avgViewers: number | null;
  joins: number;
  follows: number;
  /** Viewers Novus saw individually (chatted, gifted, followed or announced as joining). */
  seenViewers: number;
}

export interface GiftStats {
  total: number;
  diamonds: number;
  senders: number;
  top: { viewer: ViewerRef; gifts: number; diamonds: number }[];
  byName: { name: string; count: number; diamonds: number }[];
}

export interface IncidentRecord {
  t: number;
  username: string;
  text: string;
  severity: Severity;
  riskScore: number;
  reasons: string[];
  recommendedAction: RecommendedAction;
  status: string;
}

export interface ModerationLogEntry {
  t: number;
  action: ActionType;
  username: string;
  status: string;
  confirmed: boolean;
}

/** One row of the LIVE history list. */
export interface HistoryEntry {
  sessionId: string;
  title: string;
  /** Followed TikTok account of this LIVE (none for demos). */
  account?: string;
  source: LiveSessionInfo["source"];
  /** "interrupted": the server restarted during the LIVE; stats up to the last save are kept. */
  status: "live" | "ended" | "interrupted";
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  messages: number;
  uniqueChatters: number;
  gifts: number;
  diamonds: number;
  peakViewers: number;
  alerts: number;
}

/** A saved chat line, for history exports. */
export interface ChatLine {
  t: number;
  username: string;
  text: string;
  severity: Severity;
  riskScore: number;
}

export interface StreamReport {
  sessionId: string;
  generatedAt: number;
  analytics: AnalyticsSummary;
  markdown: string;
}

/** One moderation space: the demo/connector room, or one followed TikTok account. */
export interface RoomSummary {
  id: string;
  kind: "main" | "tiktok";
  /** TikTok handle (without "@") for TikTok rooms. */
  username?: string;
  /** A LIVE session is being recorded in this room. */
  live: boolean;
  /** The account is confirmed LIVE on TikTok (recorded or not). */
  detected?: boolean;
  /** Recording mode of a followed account. */
  mode?: "auto" | "manual";
  state: TikTokIntegrationState;
  openAlerts: number;
  criticalAlerts: number;
  viewerCount: number;
}

export interface Snapshot {
  room: string;
  rooms: RoomSummary[];
  session: LiveSessionInfo | null;
  stats: LiveStats;
  comments: AnalyzedComment[];
  alerts: ModerationAlert[];
  settings: Settings;
  ai: AIStatus;
  demo: DemoStatus;
  tiktok: TikTokIntegrationStatus;
  serverTime: number;
  /** Script bundle the server currently ships; an app running an older one reloads itself. */
  build?: string;
}

/** A batched realtime update pushed to clients (one per flush interval). */
export interface RealtimeBatch {
  comments: AnalyzedComment[];
  commentUpdates: AnalyzedComment[];
  alerts: ModerationAlert[];
  actions: ActionRecord[];
  stats?: LiveStats;
  session?: LiveSessionInfo | null;
  ai?: AIStatus;
  demo?: DemoStatus;
  tiktok?: TikTokIntegrationStatus;
  settings?: Settings;
  rooms?: RoomSummary[];
  reset?: boolean;
}

// ---------------------------------------------------------------- agency team

/** What a team member is allowed to do (the founder can do everything). */
export const PERMISSIONS = ["moderate", "send_chat", "manage_accounts", "settings", "history", "team"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type TeamRole = "director" | "manager" | "moderator";

export interface TeamMember {
  id: string;
  name: string;
  role: TeamRole;
  permissions: Permission[];
  /** Streamers this member can see (lowercase handles); null = all of them. */
  accounts: string[] | null;
  disabled: boolean;
  createdAt: number;
  /** "founder" or the id of the member who added them. */
  createdBy: string;
}

/** Who is logged in (GET /api/auth/me). */
export interface Me {
  kind: "founder" | "member";
  /** Team features need access codes on the server. */
  teamEnabled: boolean;
  member?: TeamMember;
  permissions: Permission[];
  accounts: string[] | null;
}
