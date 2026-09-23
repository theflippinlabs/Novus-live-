import type { AIStatus } from "../../shared/types";
import type { AIProvider, AIReviewContext, AIReviewItem, AIVerdict } from "./AIProvider";

// Batches ambiguous messages for stage-2 review and enforces a call budget,
// so harmless chat never reaches the (expensive) model and spikes cannot run up a bill.

export interface AIQueueOptions {
  batchSize: number;
  flushMs: number;
  maxCallsPerMinute: number;
  maxQueue: number;
}

export type VerdictHandler = (item: AIReviewItem, verdict: AIVerdict | null) => void;

export class AIQueue {
  private queue: AIReviewItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;
  private callTimes: number[] = [];
  private analyzed = 0;
  private lastError?: string;
  private lastErrorAt = 0;
  enabled = true;

  constructor(
    private provider: AIProvider,
    private contextFn: () => AIReviewContext,
    private onVerdict: VerdictHandler,
    private opts: AIQueueOptions = { batchSize: 8, flushMs: 1200, maxCallsPerMinute: 20, maxQueue: 64 },
  ) {}

  get active(): boolean {
    return this.enabled && this.provider.available();
  }

  /** Returns false when the item could not be queued (AI off, queue full). */
  enqueue(item: AIReviewItem): boolean {
    if (!this.active) return false;
    if (this.queue.length >= this.opts.maxQueue) {
      // Keep the most severe items when saturated.
      this.queue.sort((a, b) => b.heuristic.riskScore - a.heuristic.riskScore);
      const dropped = this.queue.pop();
      if (dropped) this.onVerdict(dropped, null);
    }
    this.queue.push(item);
    if (this.queue.length >= this.opts.batchSize) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.opts.flushMs);
    return true;
  }

  private budgetAvailable(now: number): boolean {
    this.callTimes = this.callTimes.filter((t) => t > now - 60_000);
    return this.callTimes.length < this.opts.maxCallsPerMinute;
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0 || this.inFlight >= 2) return;
    const now = Date.now();
    if (!this.budgetAvailable(now)) {
      // Over budget: retry later; items keep their heuristic verdicts meanwhile.
      this.timer = setTimeout(() => this.flush(), 2000);
      return;
    }
    const batch = this.queue.splice(0, this.opts.batchSize);
    this.callTimes.push(now);
    this.inFlight++;
    this.provider
      .reviewBatch(batch, this.contextFn())
      .then((verdicts) => {
        this.analyzed += verdicts.size;
        for (const item of batch) this.onVerdict(item, verdicts.get(item.id) ?? null);
      })
      .catch((err: unknown) => {
        this.lastError = err instanceof Error ? err.message.slice(0, 200) : "AI error";
        this.lastErrorAt = Date.now();
        for (const item of batch) this.onVerdict(item, null);
      })
      .finally(() => {
        this.inFlight--;
        if (this.queue.length) this.flush();
      });
  }

  status(): AIStatus {
    if (!this.provider.available()) return { state: "local_only", provider: "local", queued: 0, analyzed: 0 };
    if (!this.enabled) return { state: "disabled", provider: this.provider.name, model: this.provider.model, queued: 0, analyzed: this.analyzed };
    const degraded = this.lastError && Date.now() - this.lastErrorAt < 60_000;
    return {
      state: degraded ? "degraded" : "active",
      provider: this.provider.name,
      model: this.provider.model,
      queued: this.queue.length + this.inFlight,
      analyzed: this.analyzed,
      lastError: degraded ? this.lastError : undefined,
    };
  }

  clear(): void {
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
