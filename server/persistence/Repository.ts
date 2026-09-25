import type {
  ActionRecord,
  ChatLine,
  AnalyzedComment,
  LiveEvent,
  LiveSessionInfo,
  ModerationAlert,
  Settings,
  StreamReport,
  ViewerFlag,
  ViewerProfile,
} from "../../shared/types";

// Persistence boundary. The runtime only talks to this interface, so the
// in-memory store and Supabase/Postgres are interchangeable.

export interface AIAnalysisRecord {
  sessionId: string;
  commentId: string;
  provider: string;
  model?: string;
  riskScore: number;
  severity: string;
  categories: string[];
  explanation: string;
  recommendedAction: string;
  confidence: number;
  createdAt: number;
}

export interface PersistBatch {
  sessionId?: string;
  events: LiveEvent[];
  comments: AnalyzedComment[];
  alerts: ModerationAlert[];
  actions: ActionRecord[];
  viewers: ViewerProfile[];
  analyses: AIAnalysisRecord[];
}

/** Which LIVEs a history view shows: one followed account, or the demo/connector space. */
export interface SessionFilter {
  account?: string;
  /** Sessions not tied to a followed account (demos, connector LIVEs). */
  withoutAccount?: boolean;
}

/** The space of the app owner (APP_ACCESS_TOKEN); data written before spaces existed belongs to it. */
export const OWNER_TENANT = "owner";

export interface Repository {
  readonly kind: "memory" | "supabase";
  /** Whose space this repository reads and writes (one per access key). */
  readonly tenant: string;
  /** The same store, restricted to another space: settings, flags, secrets and LIVE history are separate. */
  scoped(tenant: string): Repository;
  init(): Promise<void>;
  loadSettings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<void>;
  loadViewerFlags(): Promise<Record<string, ViewerFlag>>;
  saveViewerFlag(username: string, flag: ViewerFlag | null): Promise<void>;
  saveSession(session: LiveSessionInfo): Promise<void>;
  writeBatch(batch: PersistBatch): Promise<void>;
  saveReport(report: StreamReport): Promise<void>;
  getReport(sessionId: string): Promise<StreamReport | null>;
  /** LIVE history: most recent sessions first. */
  listSessions(limit: number, filter?: SessionFilter): Promise<LiveSessionInfo[]>;
  getSession(sessionId: string): Promise<LiveSessionInfo | null>;
  getReports(sessionIds: string[]): Promise<StreamReport[]>;
  /** Saved chat of a session, oldest first. */
  getChat(sessionId: string, limit: number): Promise<ChatLine[]>;
  /** Server-only secrets (e.g. the chat sender's OAuth tokens). Never sent to the browser. */
  loadSecret(id: string): Promise<unknown | null>;
  saveSecret(id: string, value: unknown | null): Promise<void>;
}

export function emptyBatch(): PersistBatch {
  return { events: [], comments: [], alerts: [], actions: [], viewers: [], analyses: [] };
}
