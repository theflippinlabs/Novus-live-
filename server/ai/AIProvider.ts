import type { Category, ModerationAnalysis, RecommendedAction, Severity, ViewerFlag } from "../../shared/types";

// Provider-agnostic contract for stage-2 contextual analysis.
// The engine never imports a vendor SDK directly — only this interface.

export interface AIReviewItem {
  id: string;
  username: string;
  text: string;
  flag: ViewerFlag | null;
  heuristic: ModerationAnalysis;
  viewerHistory: { text: string; riskScore: number }[];
}

export interface AIReviewContext {
  streamerName: string;
  language: "en" | "fr";
  /** Moderation sensitivity chosen by the moderator (strict = raise borderline content). */
  sensitivity?: "low" | "balanced" | "strict" | "custom";
  /** Recent room messages (oldest first) for conversational context. */
  room: { username: string; text: string }[];
}

export interface AIVerdict {
  riskScore: number;
  severity: Severity;
  categories: Category[];
  explanation: string;
  /** Same explanation in the other language, when the provider returns both. */
  explanationFr?: string;
  recommendedAction: RecommendedAction;
  confidence: number;
}

export interface AIProvider {
  readonly name: string;
  readonly model?: string;
  /** False when no credentials are configured; the app then runs on stage 1 only. */
  available(): boolean;
  reviewBatch(items: AIReviewItem[], ctx: AIReviewContext): Promise<Map<string, AIVerdict>>;
  /** Optional narrative polish for "Catch me up". */
  summarize?(facts: string, language: "en" | "fr"): Promise<string>;
}

export class NullAIProvider implements AIProvider {
  readonly name = "local";
  available(): boolean {
    return false;
  }
  async reviewBatch(): Promise<Map<string, AIVerdict>> {
    return new Map();
  }
}
