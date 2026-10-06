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

// ---------------------------------------------------------------- LIVE safety events

export type SafetyEventType = "warning" | "restriction" | "moderation" | "interruption" | "content_action" | "visibility_action" | "report" | "unknown";
export type SafetySeverity = "info" | "warning" | "high" | "critical";

/** What was happening in the minutes before a safety event (compact: counts and a few samples). */
export interface SafetyContext {
  /** Window covered, in seconds before the event. */
  windowSec: number;
  comments: number;
  /** Comments in the window of the same length just before (to see a surge). */
  commentsBefore: number;
  flaggedComments: number;
  /** A few of the riskiest comments of the window. */
  flagged: { username: string; text: string; riskScore: number; t: number }[];
  /** Moderation actions taken in the window. */
  actions: { action: string; username: string; status: string; t: number }[];
  /** Viewer count at the start and end of the window, and its range (null when not received). */
  viewers: { start: number; end: number; min: number; max: number } | null;
  joins: number;
  follows: number;
  gifts: number;
  diamonds: number;
  /** Most active chatters of the window: context only, never a suspected reporter. */
  activeUsers: string[];
}

/** NOVUS analysis of a safety event: facts from the snapshot, plus a hedged AI reading. */
export interface SafetyAnalysis {
  text: string;
  provider: string;
  at: number;
}

/**
 * A safety, moderation, restriction or enforcement event the provider actually sent during a
 * LIVE (never inferred). The reporter is only set when the provider explicitly discloses it.
 */
export interface LiveSafetyEvent extends BaseEvent {
  type: "safety";
  eventType: SafetyEventType;
  severity: SafetySeverity;
  /** Provider message it comes from, e.g. "tiktok:perception". */
  source: string;
  title: string;
  description?: string;
  target?: { id?: string; username?: string };
  reporter?: { id?: string; username?: string };
  reporterDisclosed: boolean;
  /** "novus": captured live by NOVUS; "imported": supplied afterwards by an external source. */
  captured: "novus" | "imported";
  /** Compact provider payload (only the fields that matter), for audit. */
  raw?: Record<string, unknown>;
  context?: SafetyContext;
  analysis?: SafetyAnalysis;
}

export interface SafetyCounts {
  total: number;
  warnings: number;
  restrictions: number;
  critical: number;
}

export type LiveEvent =
  | LiveComment
  | LiveViewer
  | LiveGift
  | LiveFollow
  | LiveJoin
  | LiveModerationEvent
  | LiveStreamStatusEvent
  | LiveSafetyEvent;

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
  /**
   * Followed accounts whose LIVE is also recorded in video (lowercase). Needs the video
   * option; the moderator confirmed having the streamer's consent when switching it on.
   */
  tiktokVideo?: string[];
  /** Weekly goals per followed account (lowercase handle), set by the manager. */
  tiktokGoals?: Record<string, WeeklyGoals>;
  /**
   * TikTok's reward tiers (entered by the agency from TikTok Backstage — TikTok exposes no
   * API for them), per streamer (lowercase handle) or "*" for every streamer.
   */
  tiktokTiers?: Record<string, TierProgram>;
}

/** One TikTok reward tier: its share and what it takes over the period. */
export interface RewardTier {
  /** Reward rate of the tier (%), as TikTok announces it. */
  percent: number;
  label?: string;
  /** Days with at least `validDayMinutes` of LIVE. */
  validDays?: number;
  hours?: number;
  diamonds?: number;
  follows?: number;
}

export interface TierProgram {
  period: "week" | "month";
  /** Minutes of LIVE that make a day "valid" (TikTok's usual rule: 60). */
  validDayMinutes: number;
  /** From the lowest to the highest tier. */
  tiers: RewardTier[];
}

export type TierKey = "validDays" | "hours" | "diamonds" | "follows";
export const TIER_KEYS: TierKey[] = ["validDays", "hours", "diamonds", "follows"];

/** Where the streamer stands against the TikTok tiers (estimated from the LIVEs Novus followed). */
export interface TierProgress {
  period: TierProgram["period"];
  periodStart: number;
  periodEnd: number;
  /** Share of the period already gone (%). */
  elapsed: number;
  validDayMinutes: number;
  /** "*": the space-wide tiers; otherwise this streamer's own. */
  source: "account" | "all";
  done: Record<TierKey, number>;
  tiers: (RewardTier & { reached: boolean; missing: Partial<Record<TierKey, number>> })[];
  /** Highest tier reached (index), and the next one to aim for. */
  current: number | null;
  next: number | null;
}

/** A streamer's goals for the week (Monday to Sunday); unset = no goal. */
export interface WeeklyGoals {
  diamonds?: number;
  hours?: number;
  lives?: number;
  follows?: number;
  peakViewers?: number;
}

export type GoalKey = keyof WeeklyGoals;
export const GOAL_KEYS: GoalKey[] = ["diamonds", "hours", "lives", "follows", "peakViewers"];

/** GET /api/goals — the week's goals of the room's streamer and where they stand. */
export interface GoalProgress {
  account: string;
  /** Monday 00:00 and next Monday 00:00 (the space's time zone). */
  weekStart: number;
  weekEnd: number;
  /** Share of the week already gone (%), to tell ahead from behind. */
  weekElapsed: number;
  goals: WeeklyGoals;
  /** This week so far, the running LIVE included. */
  done: Required<WeeklyGoals>;
  livesCounted: number;
  /** TikTok reward tiers, when the agency entered them. */
  tiers: TierProgress | null;
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
  /** Connected with the moderation permissions (mute, kick, comments): actions run from Novus. */
  moderation?: boolean;
  /** Connected with the bulk LIVE check permission (checks 50 accounts per Euler request). */
  bulkLiveCheck?: boolean;
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
  /** Top gifters of the LIVE (by diamonds, then gifts). */
  supporters: Supporter[];
}

export interface Supporter {
  viewer: ViewerRef;
  gifts: number;
  diamonds: number;
  messages: number;
}

// ---------------------------------------------------------------- copilot

export type CoachKind = "alerts" | "question" | "mood" | "activity" | "spike" | "supporter" | "topic" | "calm" | "idle";

/** One "do this now" suggestion from the copilot (most urgent first). */
export interface CoachTip {
  /** Stable while the situation lasts (the app can hide a tip the user dismissed). */
  id: string;
  kind: CoachKind;
  /** 1 = urgent, 2 = important, 3 = opportunity. */
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  questionId?: string;
  question?: string;
  viewer?: ViewerRef;
}

export interface CopilotTurn {
  role: "user" | "assistant";
  text: string;
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
  /** Audience detail (LIVEs recorded since these were kept). */
  avgViewers?: number;
  seenViewers?: number;
  follows?: number;
  joins?: number;
  donors?: number;
  /** Video of this LIVE (video option), when one was recorded and not yet expired. */
  video?: VideoInfo;
  /** Safety events captured by NOVUS during this LIVE (absent: LIVE recorded before they were). */
  safety?: SafetyCounts;
}

/** Derived, easier-to-read figures for one LIVE (Stats page). */
export interface StatsInsights {
  /** Indicative LIVE score 0-100 and its four parts. */
  score: { total: number; engagement: number; audience: number; safety: number; monetization: number };
  ratios: {
    durationMin: number;
    messagesPerMin: number;
    messagesPerChatter: number | null;
    /** Share of the audience that wrote in the chat (%). */
    participation: number | null;
    /** New followers per 100 viewers seen. */
    followsPer100: number | null;
    /** Per-hour rates need at least 10 minutes of LIVE (null before). */
    giftsPerHour: number | null;
    diamondsPerHour: number | null;
    /** Share of the viewers seen who sent a gift (%). */
    donorRate: number | null;
    alertsPer1k: number;
    /** Alerts the team acted on (%). */
    handledPct: number | null;
    avgResponseSec: number | null;
  };
  moments: { kind: "chat_peak" | "audience_peak" | "tense" | "quiet"; t: number; value: number }[];
  /** Against the average of this account's previous LIVEs (null without history). */
  comparison: {
    lives: number;
    metrics: { key: "duration" | "messagesPerMin" | "peakViewers" | "uniqueChatters" | "gifts" | "diamonds" | "alertsPer1k"; value: number; average: number; deltaPct: number; higherIsBetter: boolean }[];
  } | null;
  /** Conversion funnel: of the viewers Novus saw, how many chatted, followed and gave (null without audience data). */
  funnel: { seen: number; chatters: number; followers: number; donors: number } | null;
  /** Conversion KPIs (null when the data is missing or too thin). */
  conversions: {
    /** % of the viewers seen who wrote in the chat. */
    viewerToChatter: number | null;
    /** % of the viewers seen who followed. */
    viewerToFollower: number | null;
    /** % of the viewers seen who sent a gift. */
    viewerToDonor: number | null;
    /** % of the chatters who also sent a gift. */
    chatterToDonor: number | null;
    /** Average diamonds per donor (basket). */
    avgBasket: number | null;
    /** Diamonds per viewer seen. */
    diamondsPerViewer: number | null;
    /** Average audience as a % of the peak (how well the LIVE keeps its viewers). */
    retention: number | null;
    /** Viewers joining per hour (10+ minutes of LIVE). */
    joinsPerHour: number | null;
    /** New followers per hour (10+ minutes of LIVE). */
    followsPerHour: number | null;
  };
  /** Up to the last 10 LIVEs of the account, oldest first (this one included). */
  trend: { sessionId: string; startedAt: number; peakViewers: number; messages: number; diamonds: number; alerts: number; current: boolean }[];
}

/** One donor across the space's LIVEs (donor directory). */
export interface DonorSummary {
  viewer: ViewerRef;
  diamonds: number;
  gifts: number;
  /** Number of LIVEs where this viewer sent at least one gift. */
  lives: number;
  avgDiamondsPerLive: number;
  /** Share of all the diamonds of the period (%). */
  share: number;
  /** Followed accounts (rooms) this viewer gifted in, biggest first. */
  rooms: { account: string | null; diamonds: number; gifts: number; lives: number }[];
  byGift: { name: string; count: number; diamonds: number }[];
  favoriteGift: { name: string; count: number } | null;
  firstAt: number;
  lastAt: number;
  /** Where the donor stands, to keep them giving (computed from their real gifts only). */
  retention: DonorRetention;
  /** Their gifts LIVE by LIVE (the last 20, oldest first). */
  history: { sessionId: string; account: string | null; at: number; diamonds: number; gifts: number }[];
}

/**
 * active: gave recently, at their usual pace · cooling: later than usual, worth a thank-you
 * or a mention · lost: nothing for a long time · new: first gifts in the last 14 days.
 */
export type DonorStatus = "new" | "active" | "cooling" | "lost";

export interface DonorRetention {
  status: DonorStatus;
  daysSinceLast: number;
  /** Usual number of days between two LIVEs where they give (null with a single LIVE). */
  gapDays: number | null;
  /** Diamonds in the last 30 days, and in the 30 days before. */
  last30: number;
  prev30: number;
  /** Most diamonds in a single LIVE. */
  bestLive: number;
  /** Most expensive gift they sent (diamonds for one). */
  topGift: { name: string; value: number } | null;
}

export interface DonorDirectory {
  totals: { donors: number; diamonds: number; gifts: number; lives: number; status: Record<DonorStatus, number> };
  donors: DonorSummary[];
  /** Followed accounts present in the period, for the room filter. */
  accounts: string[];
}

/** A saved chat line, for history exports. */
export interface ChatLine {
  t: number;
  username: string;
  text: string;
  severity: Severity;
  riskScore: number;
  /** Exports with translation: the message in the chosen language (absent when unchanged). */
  translation?: string;
}

export interface StreamReport {
  sessionId: string;
  generatedAt: number;
  analytics: AnalyticsSummary;
  markdown: string;
  /** Safety events captured during the LIVE (absent for LIVEs recorded before this existed). */
  safety?: SafetyCounts;
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
  /** Video of this account's LIVE: switched on, and being recorded right now. */
  video?: { on: boolean; recording: boolean };
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
  /** Safety events of the current LIVE, oldest first. */
  safety?: LiveSafetyEvent[];
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
  /** The current LIVE's safety events (whole list, sent when it changes). */
  safety?: LiveSafetyEvent[];
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
  /** The platform owner: admin dashboards (profitability, metrics, config). */
  admin?: boolean;
}

// ---------------------------------------------------------------- billing

export type WorkspaceStatus = "pending" | "trialing" | "active" | "past_due" | "restricted" | "canceled" | "comped";

/** What the workspace can do right now. */
export type AccessLevel = "full" | "trial" | "grace" | "restricted";

export interface UsageSnapshot {
  ai_requests: number;
  ai_tokens: number;
  live_monitoring_hours: number;
  exports: number;
  provider_calls: number;
  recording_hours: number;
  /** Video gigabytes recorded this month. */
  video_gb: number;
  screenshots: number;
}

/** GET /api/billing/me — the customer's own plan, limits and usage (never internal costs). */
export interface BillingMe {
  workspaceId: string;
  name: string;
  /** The founder's e-mail (shown to the founder only). */
  email?: string;
  plan: import("./plans").PlanId;
  cycle: import("./plans").BillingCycle;
  status: WorkspaceStatus;
  access: AccessLevel;
  /** Why access is restricted, when it is. */
  reason?: "payment" | "canceled" | "not_started" | "trial_quota";
  trialEndsAt?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  founding: boolean;
  foundingUntil?: number;
  comped: boolean;
  canManageBilling: boolean;
  /** The founder logs in with a stored code they can change (self-serve workspaces). */
  ownCode: boolean;
  entitlements: import("./plans").Entitlements;
  usage: UsageSnapshot;
  creators: number;
  seats: number;
  /** Video option: the active pack, and whether it was granted (not bought). */
  video: { pack: import("./plans").VideoPackId | null; granted: boolean; included: boolean; canBuy: boolean };
}

/** GET /api/billing/plans — public pricing data. */
export interface PublicPricing {
  currency: "EUR";
  plans: {
    id: import("./plans").PlanId;
    monthly: number | null;
    yearly: number | null;
    trialDays: number;
    available: boolean;
    entitlements: import("./plans").Entitlements;
  }[];
  video: import("./plans").VideoPack[];
  founding: {
    available: boolean;
    capacity: number;
    /** Real remaining slots, or null when it cannot be verified. */
    remaining: number | null;
    monthly: number;
    months: number;
  };
  checkoutEnabled: boolean;
}

// ---------------------------------------------------------------- LIVE video (option)

export interface VideoSegment {
  /** Object path in storage ("<tenant>/<session>/<file>.ts"). */
  path: string;
  seconds: number;
  bytes: number;
  /** A new ffmpeg run starts here (the stream was reconnected): the player resyncs. */
  discontinuity?: boolean;
}

/** One LIVE's video: 60-second MPEG-TS segments in private storage. */
export interface VideoRecord {
  sessionId: string;
  account: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "done" | "stopped_quota" | "failed";
  segments: VideoSegment[];
  seconds: number;
  bytes: number;
  /** Deleted automatically after this (the pack's retention). */
  expiresAt: number;
  /** Kept in the app's Videos: no automatic deletion. */
  kept?: boolean;
}

/** One subtitle line: seconds from the start of the video. */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/** A video's subtitles in one language. */
export interface VideoSubtitles {
  lang: string;
  /** Language spoken in the LIVE (ISO code from speech-to-text), when this is the transcript itself. */
  source?: string;
  cues: SubtitleCue[];
}

/** Where a video's subtitles stand, per language (Stats › Videos). */
export interface SubtitleStatus {
  /** Speech-to-text is configured on the server. */
  configured: boolean;
  /** Languages ready to show. */
  ready: string[];
  /** A job in progress: language and share done (0-1). */
  job?: { lang: string; progress: number; phase: "transcribing" | "translating" };
  error?: string;
  /** Subtitle minutes left this month, and the month's allowance. */
  minutesLeft: number;
  minutesLimit: number;
}

/** One downloadable part of a video (long LIVEs are saved in parts a phone can hold). */
export interface VideoPart {
  index: number;
  seconds: number;
  bytes: number;
}

/** What the app shows about a LIVE's video. */
export interface VideoInfo {
  sessionId: string;
  status: VideoRecord["status"];
  seconds: number;
  bytes: number;
  startedAt: number;
  endedAt?: number;
  expiresAt: number;
  kept: boolean;
  parts: VideoPart[];
}

/** Stats › Videos: every LIVE video of the space. */
export interface VideoLibraryItem extends VideoInfo {
  account: string;
  title: string;
}

export interface VideoLibrary {
  videos: VideoLibraryItem[];
  /** Kept videos (no automatic deletion) count against the option's storage. */
  keptGb: number;
  keepLimitGb: number;
}

// ---------------------------------------------------------------- leaderboard (Stats › Ranking)

export type LeaderboardBadge = "top_diamonds" | "top_engagement" | "top_audience" | "most_active" | "safest";

/** One followed streamer over the period, with the parts of their score. */
export interface LeaderboardEntry {
  account: string;
  rank: number;
  /** Overall score 0-100 (weighted parts below). */
  score: number;
  parts: { monetization: number; engagement: number; audience: number; activity: number; safety: number };
  lives: number;
  hours: number;
  diamonds: number;
  diamondsPerHour: number;
  avgViewers: number;
  peakViewers: number;
  /** Average share of the audience that chatted (%). */
  engagementRate: number | null;
  messagesPerMin: number;
  /** New followers per 100 viewers seen (%). */
  followConversion: number | null;
  /** Viewers seen who sent a gift (%). */
  donorConversion: number | null;
  alertsPer1k: number;
  lastLiveAt: number;
  badges: LeaderboardBadge[];
}

export interface Leaderboard {
  days: number | null;
  entries: LeaderboardEntry[];
  /** LIVEs taken into account. */
  lives: number;
  generatedAt: number;
}
