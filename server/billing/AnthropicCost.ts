/*
 * The real Anthropic bill, month to date, from the Usage & Cost Admin API
 * (GET /v1/organizations/cost_report, Admin API key). Used by the admin dashboard to
 * compare the metered estimate with what Anthropic actually charges.
 */

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

interface CostReportPage {
  data: { starting_at: string; ending_at: string; results: { amount: string; currency: string; workspace_id: string | null }[] }[];
  has_more: boolean;
  next_page: string | null;
}

export interface ActualAICost {
  /** Month to date, in US dollars. */
  usd: number;
  /** "YYYY-MM" (UTC). */
  month: string;
  fetchedAt: number;
}

export interface AICostStatus {
  configured: boolean;
  actual: ActualAICost | null;
  error?: string;
}

const CACHE_MS = 10 * 60_000;

export class AnthropicCostReport {
  private cached: ActualAICost | null = null;
  private lastError: string | undefined;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly opts: { adminKey?: string; workspaceId?: string },
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return Boolean(this.opts.adminKey);
  }

  /** Month-to-date cost (cached 10 min; the API asks for at most one poll per minute). */
  async status(): Promise<AICostStatus> {
    if (!this.configured) return { configured: false, actual: null };
    const month = new Date(this.now()).toISOString().slice(0, 7);
    const fresh = this.cached && this.cached.month === month && this.now() - this.cached.fetchedAt < CACHE_MS;
    if (!fresh) {
      this.inflight ??= this.refresh(month).finally(() => (this.inflight = null));
      await this.inflight;
    }
    const actual = this.cached?.month === month ? this.cached : null;
    return { configured: true, actual, error: this.lastError };
  }

  private async refresh(month: string): Promise<void> {
    try {
      const start = `${month}-01T00:00:00Z`;
      // Daily buckets that end before this cover today's (partial) day too.
      const d = new Date(this.now());
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 1)).toISOString();
      const filter = this.opts.workspaceId;
      let cents = 0;
      let page: string | null = null;
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ starting_at: start, ending_at: end, bucket_width: "1d", limit: "31" });
        if (filter) q.append("group_by[]", "workspace_id");
        if (page) q.set("page", page);
        const res = await this.fetchImpl(`https://api.anthropic.com/v1/organizations/cost_report?${q}`, {
          headers: { "x-api-key": this.opts.adminKey!, "anthropic-version": "2023-06-01", "User-Agent": "NovusLive/1.0" },
        });
        if (!res.ok) throw new Error(`Anthropic cost API ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const body = (await res.json()) as CostReportPage;
        for (const bucket of body.data ?? [])
          for (const r of bucket.results ?? []) {
            if (r.currency && r.currency !== "USD") continue;
            if (filter && (r.workspace_id ?? "default") !== filter) continue;
            cents += Number(r.amount) || 0;
          }
        if (!body.has_more || !body.next_page) break;
        page = body.next_page;
      }
      this.cached = { usd: Math.round(cents) / 100, month, fetchedAt: this.now() };
      this.lastError = undefined;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.warn(`[billing] ${this.lastError}`);
    }
  }
}
