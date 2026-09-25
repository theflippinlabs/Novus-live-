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
  reviewBatch(items: AIReviewItem[], ctx: AIReviewContext, meter?: UsageCallback): Promise<Map<string, AIVerdict>>;
  /** Optional narrative polish for "Catch me up". */
  summarize?(facts: string, language: "en" | "fr", meter?: UsageCallback): Promise<string>;
}

/** Tokens used by one AI call (for usage metering). */
export type UsageCallback = (usage: { inputTokens: number; outputTokens: number }) => void;

/**
 * One workspace's view of the shared AI provider: counts its requests and tokens, and
 * reports itself unavailable once the plan's AI allowance is used up — Novus then keeps
 * moderating with its local rules only.
 */
export class MeteredAIProvider implements AIProvider {
  constructor(
    private inner: AIProvider,
    private gate: { allowed(): boolean; record(requests: number, input: number, output: number): void },
  ) {}
  get name() {
    return this.inner.name;
  }
  get model() {
    return this.inner.model;
  }
  available(): boolean {
    return this.inner.available() && this.gate.allowed();
  }
  reviewBatch(items: AIReviewItem[], ctx: AIReviewContext): Promise<Map<string, AIVerdict>> {
    return this.inner.reviewBatch(items, ctx, (u) => this.gate.record(1, u.inputTokens, u.outputTokens));
  }
  get summarize(): AIProvider["summarize"] {
    const inner = this.inner.summarize?.bind(this.inner);
    if (!inner) return undefined;
    return (facts, language) => inner(facts, language, (u) => this.gate.record(1, u.inputTokens, u.outputTokens));
  }
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
