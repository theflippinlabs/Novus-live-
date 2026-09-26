import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BillingCycle, PlanId } from "../../shared/plans";
import type { WorkspaceStatus } from "../../shared/types";

/*
 * Billing persistence: workspaces (one per customer space), usage counters, processed
 * Stripe events (webhook idempotency), billing/conversion events and admin config.
 * Service-role only — none of this is reachable from the browser.
 */

export interface Workspace {
  /** Same id as the space (tenant) it bills. */
  id: string;
  name: string;
  ownerEmail?: string;
  /** SHA-256 of the founder access code (self-serve workspaces). */
  founderCodeHash?: string;
  /** Pending lost-code recovery: SHA-256 of the one-time e-mailed token, and its expiry. */
  recoveryHash?: string;
  recoveryExpiresAt?: number;
  recoverySentAt?: number;
  plan: PlanId;
  cycle: BillingCycle;
  status: WorkspaceStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  trialEndsAt?: number;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  founding: boolean;
  foundingUntil?: number;
  /** A founding checkout in progress holds a slot until this time. */
  foundingHoldUntil?: number;
  trialUsed: boolean;
  pastDueSince?: number;
  paidSince?: number;
  canceledAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface UsageRow {
  workspaceId: string;
  /** "YYYY-MM" (UTC) or "trial". */
  period: string;
  metric: string;
  value: number;
}

export interface BillingEvent {
  type: string;
  workspaceId?: string;
  plan?: string;
  cycle?: string;
  source?: string;
  /** Random per-browser id for the funnel (no personal data). */
  anonId?: string;
  meta?: Record<string, unknown>;
  at: number;
}

export interface BillingStore {
  readonly kind: "memory" | "supabase";
  listWorkspaces(): Promise<Workspace[]>;
  saveWorkspace(ws: Workspace): Promise<void>;
  loadUsage(periods: string[]): Promise<UsageRow[]>;
  saveUsage(rows: UsageRow[]): Promise<void>;
  /** Records a Stripe event id; false when it was already processed. */
  claimStripeEvent(id: string, type: string): Promise<boolean>;
  /** Lets a failed event be retried by Stripe. */
  releaseStripeEvent(id: string): Promise<void>;
  addEvents(events: BillingEvent[]): Promise<void>;
  listEvents(sinceMs: number): Promise<BillingEvent[]>;
  loadConfig(): Promise<unknown>;
  saveConfig(value: unknown): Promise<void>;
}

export class MemoryBillingStore implements BillingStore {
  readonly kind = "memory" as const;
  private workspaces = new Map<string, Workspace>();
  private usage = new Map<string, UsageRow>();
  private stripe = new Set<string>();
  private events: BillingEvent[] = [];
  private config: unknown = null;

  async listWorkspaces() {
    return [...this.workspaces.values()].map((w) => ({ ...w }));
  }
  async saveWorkspace(ws: Workspace) {
    this.workspaces.set(ws.id, { ...ws });
  }
  async loadUsage(periods: string[]) {
    return [...this.usage.values()].filter((r) => periods.includes(r.period)).map((r) => ({ ...r }));
  }
  async saveUsage(rows: UsageRow[]) {
    for (const r of rows) this.usage.set(`${r.workspaceId}|${r.period}|${r.metric}`, { ...r });
  }
  async claimStripeEvent(id: string, _type?: string) {
    if (this.stripe.has(id)) return false;
    this.stripe.add(id);
    return true;
  }
  async releaseStripeEvent(id: string) {
    this.stripe.delete(id);
  }
  async addEvents(events: BillingEvent[]) {
    this.events.push(...events);
  }
  async listEvents(sinceMs: number) {
    return this.events.filter((e) => e.at >= sinceMs);
  }
  async loadConfig() {
    return this.config;
  }
  async saveConfig(value: unknown) {
    this.config = value;
  }
}

const iso = (t?: number) => (t ? new Date(t).toISOString() : null);
const ms = (s?: string | null) => (s ? Date.parse(s) : undefined);

export class SupabaseBillingStore implements BillingStore {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async check<T>(p: PromiseLike<{ error: { message: string; code?: string } | null; data?: T | null }>, what: string): Promise<T | undefined> {
    const { error, data } = await p;
    if (error) throw new Error(`Supabase ${what}: ${error.message}`);
    return data ?? undefined;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.check<{ data: Workspace }[]>(this.db.from("workspaces").select("data"), "listWorkspaces");
    return (rows ?? []).map((r) => r.data);
  }

  async saveWorkspace(ws: Workspace): Promise<void> {
    await this.check(
      this.db.from("workspaces").upsert({
        id: ws.id,
        data: ws,
        status: ws.status,
        plan: ws.plan,
        billing_cycle: ws.cycle,
        stripe_customer_id: ws.stripeCustomerId ?? null,
        stripe_subscription_id: ws.stripeSubscriptionId ?? null,
        founding: ws.founding,
        created_at: iso(ws.createdAt),
        updated_at: iso(ws.updatedAt),
      }),
      "saveWorkspace",
    );
  }

  async loadUsage(periods: string[]): Promise<UsageRow[]> {
    if (!periods.length) return [];
    const rows = await this.check<{ workspace_id: string; period: string; metric: string; value: number }[]>(
      this.db.from("usage_counters").select("workspace_id, period, metric, value").in("period", periods),
      "loadUsage",
    );
    return (rows ?? []).map((r) => ({ workspaceId: r.workspace_id, period: r.period, metric: r.metric, value: Number(r.value) }));
  }

  async saveUsage(rows: UsageRow[]): Promise<void> {
    if (!rows.length) return;
    await this.check(
      this.db.from("usage_counters").upsert(
        rows.map((r) => ({ workspace_id: r.workspaceId, period: r.period, metric: r.metric, value: r.value, updated_at: new Date().toISOString() })),
        { onConflict: "workspace_id,period,metric" },
      ),
      "saveUsage",
    );
  }

  async claimStripeEvent(id: string, type: string): Promise<boolean> {
    const { error } = await this.db.from("stripe_events").insert({ id, type });
    if (!error) return true;
    // 23505 = unique violation: already processed.
    if (error.code === "23505") return false;
    throw new Error(`Supabase claimStripeEvent: ${error.message}`);
  }

  async releaseStripeEvent(id: string): Promise<void> {
    await this.check(this.db.from("stripe_events").delete().eq("id", id), "releaseStripeEvent");
  }

  async addEvents(events: BillingEvent[]): Promise<void> {
    if (!events.length) return;
    await this.check(
      this.db.from("billing_events").insert(
        events.map((e) => ({
          type: e.type,
          workspace_id: e.workspaceId ?? null,
          plan: e.plan ?? null,
          billing_cycle: e.cycle ?? null,
          source: e.source ?? null,
          anon_id: e.anonId ?? null,
          meta: e.meta ?? null,
          created_at: iso(e.at),
        })),
      ),
      "addEvents",
    );
  }

  async listEvents(sinceMs: number): Promise<BillingEvent[]> {
    const out: BillingEvent[] = [];
    for (let from = 0; ; from += 1000) {
      const rows = await this.check<
        { type: string; workspace_id: string | null; plan: string | null; billing_cycle: string | null; source: string | null; anon_id: string | null; meta: Record<string, unknown> | null; created_at: string }[]
      >(
        this.db
          .from("billing_events")
          .select("type, workspace_id, plan, billing_cycle, source, anon_id, meta, created_at")
          .gte("created_at", iso(sinceMs))
          .order("created_at", { ascending: true })
          .range(from, from + 999),
        "listEvents",
      );
      for (const r of rows ?? [])
        out.push({ type: r.type, workspaceId: r.workspace_id ?? undefined, plan: r.plan ?? undefined, cycle: r.billing_cycle ?? undefined, source: r.source ?? undefined, anonId: r.anon_id ?? undefined, meta: r.meta ?? undefined, at: ms(r.created_at) ?? 0 });
      if ((rows ?? []).length < 1000 || out.length >= 50_000) break;
    }
    return out;
  }

  async loadConfig(): Promise<unknown> {
    const rows = await this.check<{ value: unknown }[]>(this.db.from("billing_config").select("value").eq("id", "default").limit(1), "loadConfig");
    return rows?.[0]?.value ?? null;
  }

  async saveConfig(value: unknown): Promise<void> {
    await this.check(this.db.from("billing_config").upsert({ id: "default", value, updated_at: new Date().toISOString() }), "saveConfig");
  }
}
