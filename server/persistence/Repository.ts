import type {
  ActionRecord,
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

export interface Repository {
  readonly kind: "memory" | "supabase";
  init(): Promise<void>;
  loadSettings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<void>;
  loadViewerFlags(): Promise<Record<string, ViewerFlag>>;
  saveViewerFlag(username: string, flag: ViewerFlag | null): Promise<void>;
  saveSession(session: LiveSessionInfo): Promise<void>;
  writeBatch(batch: PersistBatch): Promise<void>;
  saveReport(report: StreamReport): Promise<void>;
  listReports(limit: number): Promise<{ sessionId: string; generatedAt: number }[]>;
  getReport(sessionId: string): Promise<StreamReport | null>;
}

export function emptyBatch(): PersistBatch {
  return { events: [], comments: [], alerts: [], actions: [], viewers: [], analyses: [] };
}
