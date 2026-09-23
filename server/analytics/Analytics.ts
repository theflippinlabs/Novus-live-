import type { AnalyzedComment, Category, MinuteBucket } from "../../shared/types";

// Per-minute rollups for the analytics view and the post-LIVE report.

interface Bucket {
  messages: number;
  alerts: number;
  toxic: number;
  riskSum: number;
  sentimentSum: number;
}

export class Analytics {
  private buckets = new Map<number, Bucket>();
  categoryCounts: Partial<Record<Category, number>> = {};

  reset(): void {
    this.buckets.clear();
    this.categoryCounts = {};
  }

  private bucket(t: number): Bucket {
    const key = Math.floor(t / 60_000) * 60_000;
    let b = this.buckets.get(key);
    if (!b) {
      b = { messages: 0, alerts: 0, toxic: 0, riskSum: 0, sentimentSum: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  addComment(c: AnalyzedComment, sentiment: number): void {
    const b = this.bucket(c.timestamp);
    b.messages += 1;
    b.riskSum += c.analysis.riskScore;
    b.sentimentSum += sentiment;
    if (c.analysis.severity !== "normal") b.toxic += 1;
    for (const cat of c.analysis.categories) this.categoryCounts[cat] = (this.categoryCounts[cat] ?? 0) + 1;
  }

  /** Adjust rollups when AI refinement changes a comment's verdict. */
  reviseComment(before: AnalyzedComment, after: AnalyzedComment): void {
    const b = this.bucket(before.timestamp);
    b.riskSum += after.analysis.riskScore - before.analysis.riskScore;
    b.toxic += (after.analysis.severity !== "normal" ? 1 : 0) - (before.analysis.severity !== "normal" ? 1 : 0);
    for (const cat of before.analysis.categories) this.categoryCounts[cat] = Math.max(0, (this.categoryCounts[cat] ?? 1) - 1);
    for (const cat of after.analysis.categories) this.categoryCounts[cat] = (this.categoryCounts[cat] ?? 0) + 1;
  }

  addAlert(t: number): void {
    this.bucket(t).alerts += 1;
  }

  series(): MinuteBucket[] {
    const keys = [...this.buckets.keys()].sort((a, b) => a - b);
    if (!keys.length) return [];
    // Fill gaps so the chart has a continuous time axis.
    const out: MinuteBucket[] = [];
    for (let t = keys[0]; t <= keys[keys.length - 1]; t += 60_000) {
      const b = this.buckets.get(t);
      out.push(
        b
          ? {
              t,
              messages: b.messages,
              alerts: b.alerts,
              toxicity: b.messages ? Math.round((b.toxic / b.messages) * 1000) / 10 : 0,
              avgRisk: b.messages ? Math.round(b.riskSum / b.messages) : 0,
              sentiment: b.messages ? Math.round((b.sentimentSum / b.messages) * 100) / 100 : 0,
            }
          : { t, messages: 0, alerts: 0, toxicity: 0, avgRisk: 0, sentiment: 0 },
      );
    }
    return out.slice(-240);
  }
}
