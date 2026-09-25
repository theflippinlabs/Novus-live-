import { PLAN_IDS, type PlanId } from "../../shared/plans";
import { monthKey } from "./Entitlements";
import type { BillingService } from "./Billing";
import type { BillingEvent, Workspace } from "./Store";

/*
 * Admin-only economics: per-workspace profitability and SaaS metrics.
 * Costs are ESTIMATES from the admin's cost assumptions × metered usage; they are
 * never sent to customers.
 */

export type MarginHealth = "healthy" | "watch" | "at_risk" | "n/a";

export interface WorkspaceEconomics {
  id: string;
  name: string;
  plan: PlanId;
  cycle: string;
  status: string;
  founding: boolean;
  mrr: number;
  arr: number;
  creators: number;
  seats: number;
  liveHours: number;
  aiRequests: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  costs: { ai: number; provider: number; live: number; recording: number; storage: number; screenshots: number; fixed: number; total: number };
  grossProfit: number;
  grossMargin: number | null;
  health: MarginHealth;
}

const eur = (cents: number) => Math.round(cents) / 100;

/** Profitability of each workspace over the current UTC month (values in EUR). */
export function workspaceEconomics(billing: BillingService, sizes: (id: string) => { creators: number; seats: number }, now = Date.now()): WorkspaceEconomics[] {
  const c = billing.config.costs;
  const m = billing.config.margins;
  const month = monthKey(now);
  return billing.all().map((ws: Workspace) => {
    const g = (metric: Parameters<typeof billing.meter.get>[2]) => billing.meter.get(ws.id, month, metric);
    const inTok = g("ai_input_tokens");
    const outTok = g("ai_output_tokens");
    const liveHours = g("live_minutes") / 60;
    const paying = ["active", "past_due", "trialing"].includes(ws.status);
    const costs = {
      ai: (inTok / 1e6) * c.per_1m_input_tokens + (outTok / 1e6) * c.per_1m_output_tokens,
      provider: g("provider_calls") * c.per_provider_request,
      live: liveHours * c.per_live_hour,
      recording: (g("recording_minutes") / 60) * c.per_recording_hour,
      storage: 0,
      screenshots: (g("screenshots") / 1000) * c.per_1000_screenshots,
      fixed: paying ? c.per_workspace_month : 0,
      total: 0,
    };
    costs.total = costs.ai + costs.provider + costs.live + costs.recording + costs.storage + costs.screenshots + costs.fixed;
    const mrr = eur(billing.mrr(ws));
    const grossProfit = mrr - costs.total;
    const grossMargin = mrr > 0 ? (grossProfit / mrr) * 100 : null;
    const health: MarginHealth = grossMargin === null ? "n/a" : grossMargin >= m.target ? "healthy" : grossMargin >= m.watch ? "watch" : "at_risk";
    const size = sizes(ws.id);
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      id: ws.id,
      name: ws.name,
      plan: ws.plan,
      cycle: ws.cycle,
      status: ws.status,
      founding: ws.founding,
      mrr,
      arr: round(mrr * 12),
      creators: size.creators,
      seats: size.seats,
      liveHours: round(liveHours),
      aiRequests: g("ai_requests"),
      aiInputTokens: inTok,
      aiOutputTokens: outTok,
      costs: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, round(v)])) as WorkspaceEconomics["costs"],
      grossProfit: round(grossProfit),
      grossMargin: grossMargin === null ? null : Math.round(grossMargin * 10) / 10,
      health,
    };
  });
}

export interface SaasMetrics {
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  trials: number;
  pastDue: number;
  trialToPaid: number | null;
  mrrByPlan: Record<string, number>;
  arpu: number;
  last30: { newSubscriptions: number; upgrades: number; downgrades: number; cancellations: number; paymentsFailed: number; paymentsRecovered: number };
  churn30: number | null;
  estimatedCost: number;
  grossProfit: number;
  grossMargin: number | null;
  founding: { capacity: number; used: number; remaining: number; enabled: boolean };
  /** New subscriptions and cancellations per month over the last 6 months (from events). */
  trend: { month: string; newSubscriptions: number; cancellations: number }[];
}

export function saasMetrics(billing: BillingService, economics: WorkspaceEconomics[], events: BillingEvent[], now = Date.now()): SaasMetrics {
  const all = billing.all();
  const paying = all.filter((w) => ["active", "past_due"].includes(w.status));
  const mrr = economics.reduce((s, e) => s + e.mrr, 0);
  const mrrByPlan = Object.fromEntries(PLAN_IDS.map((p) => [p, 0])) as Record<string, number>;
  for (const e of economics) mrrByPlan[e.plan] += e.mrr;
  const since30 = now - 30 * 24 * 3600 * 1000;
  const recent = events.filter((e) => e.at >= since30);
  const count = (type: string, list = recent) => list.filter((e) => e.type === type).length;
  // Trial → paid: workspaces that ever trialed, and how many are paying now.
  const trialed = all.filter((w) => w.trialUsed);
  const trialToPaid = trialed.length ? Math.round((trialed.filter((w) => ["active", "past_due"].includes(w.status)).length / trialed.length) * 1000) / 10 : null;
  const cancellations = count("subscription_cancelled");
  const churnBase = paying.length + cancellations;
  const cost = economics.reduce((s, e) => s + e.costs.total, 0);
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    const month = monthKey(d.getTime());
    const inMonth = events.filter((e) => monthKey(e.at) === month);
    return { month, newSubscriptions: count("subscription_started", inMonth), cancellations: count("subscription_cancelled", inMonth) };
  });
  const f = billing.config.founding;
  const remaining = billing.foundingRemaining();
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    mrr: round(mrr),
    arr: round(mrr * 12),
    activeSubscriptions: paying.length,
    trials: all.filter((w) => w.status === "trialing").length,
    pastDue: all.filter((w) => w.status === "past_due").length,
    trialToPaid,
    mrrByPlan: Object.fromEntries(Object.entries(mrrByPlan).map(([k, v]) => [k, round(v)])),
    arpu: paying.length ? round(mrr / paying.length) : 0,
    last30: {
      newSubscriptions: count("subscription_started"),
      upgrades: count("subscription_upgraded"),
      downgrades: count("subscription_downgraded"),
      cancellations,
      paymentsFailed: count("payment_failed"),
      paymentsRecovered: count("payment_recovered"),
    },
    churn30: churnBase ? Math.round((cancellations / churnBase) * 1000) / 10 : null,
    estimatedCost: round(cost),
    grossProfit: round(mrr - cost),
    grossMargin: mrr > 0 ? Math.round(((mrr - cost) / mrr) * 1000) / 10 : null,
    founding: { capacity: f.capacity, used: f.capacity - remaining, remaining, enabled: f.enabled },
    trend,
  };
}

export interface FunnelStep {
  step: string;
  total: number;
  byPlan: Record<string, number>;
}

/** Visitors → pricing views → selections → checkout → trials → paid → retained, per plan. */
export function funnel(billing: BillingService, events: BillingEvent[], now = Date.now()): FunnelStep[] {
  const step = (name: string, list: BillingEvent[], unique: (e: BillingEvent) => string | undefined) => {
    const seen = new Set<string>();
    const byPlan: Record<string, number> = {};
    for (const e of list) {
      const key = unique(e) ?? `${e.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = e.plan ?? "—";
      byPlan[p] = (byPlan[p] ?? 0) + 1;
    }
    return { step: name, total: seen.size, byPlan };
  };
  const of = (type: string) => events.filter((e) => e.type === type);
  const visitors = step("visitors", of("pricing_viewed"), (e) => e.anonId);
  const views = step("pricing_views", of("pricing_viewed"), () => undefined);
  const retainedCut = now - 30 * 24 * 3600 * 1000;
  const retained = billing.all().filter((w) => ["active", "past_due"].includes(w.status) && w.paidSince && w.paidSince < retainedCut);
  const retainedByPlan: Record<string, number> = {};
  for (const w of retained) retainedByPlan[w.plan] = (retainedByPlan[w.plan] ?? 0) + 1;
  return [
    { ...visitors, byPlan: {} },
    { ...views, byPlan: {} },
    step("plan_selections", of("plan_selected"), (e) => `${e.anonId}|${e.plan}`),
    step("checkout_starts", of("checkout_started"), (e) => e.workspaceId),
    step("checkout_completions", of("checkout_completed"), (e) => e.workspaceId),
    step("trials", of("trial_started"), (e) => e.workspaceId),
    step("paid", of("subscription_started"), (e) => e.workspaceId),
    { step: "retained_30d", total: retained.length, byPlan: retainedByPlan },
  ];
}
