import type { BillingCycle, PlanId } from "../shared/plans";
import type { BillingMe, PublicPricing } from "../shared/types";
import { ApiError } from "./api";
import { getState, setState } from "./store";

// Billing client: public pricing, signup/checkout, the workspace's own plan, and the
// conversion events (anonymous per-browser id, no personal data).

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined || method !== "GET" ? { "Content-Type": "application/json" } : {},
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export function anonId(): string {
  try {
    let id = localStorage.getItem("novus:anon");
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("novus:anon", id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export function track(type: string, extra: { plan?: PlanId; cycle?: BillingCycle; source?: string } = {}): void {
  void call("POST", "/billing/track", { type, ...extra, anonId: anonId() }).catch(() => undefined);
}

export const billingApi = {
  plans: () => call<PublicPricing>("GET", "/billing/plans"),
  me: () => call<BillingMe>("GET", "/billing/me"),
  signup: (b: { name: string; email: string; plan: PlanId; cycle: BillingCycle; founding: boolean; source?: string }) =>
    call<{ workspaceId: string; code: string; checkoutUrl: string }>("POST", "/billing/signup", { ...b, anonId: anonId() }),
  checkout: (b: { plan: PlanId; cycle: BillingCycle; founding: boolean; source?: string }) => call<{ url: string }>("POST", "/billing/checkout", { ...b, anonId: anonId() }),
  portal: () => call<{ url: string }>("POST", "/billing/portal"),
  changePlan: (plan: PlanId, cycle: BillingCycle) => call<{ ok: boolean }>("POST", "/billing/change-plan", { plan, cycle }),
  lead: (b: { name: string; email: string; company: string; creators: number; message?: string }) => call<{ ok: boolean }>("POST", "/billing/lead", b),
  recover: (email: string, lang: "en" | "fr") => call<{ email: boolean; support: string | null }>("POST", "/auth/recover", { email, lang }),
  recoverComplete: (token: string) => call<{ code: string; name: string }>("POST", "/auth/recover/complete", { token }),
  rename: (name: string) => call<{ ok: boolean }>("PUT", "/billing/profile", { name }),
  changeFounderCode: () => call<{ code: string }>("POST", "/billing/founder-code"),
  adminResetCode: (id: string) => call<{ code: string }>("POST", `/admin/workspaces/${encodeURIComponent(id)}/reset-code`),
  adminOverview: () => call<AdminOverview>("GET", "/admin/overview"),
  adminConfig: () => call<import("../shared/plans").BillingConfig>("GET", "/admin/config"),
  saveAdminConfig: (patch: unknown) => call<import("../shared/plans").BillingConfig>("PUT", "/admin/config", patch),
};

export interface AdminOverview {
  stripe: boolean;
  metrics: {
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
    ai: {
      source: "anthropic" | "estimate";
      estimated: number;
      actual: number | null;
      actualUsd: number | null;
      deviation: number | null;
      unallocated: number;
      fetchedAt: number | null;
      configured: boolean;
      error?: string;
    };
    grossProfit: number;
    grossMargin: number | null;
    founding: { capacity: number; used: number; remaining: number; enabled: boolean };
    trend: { month: string; newSubscriptions: number; cancellations: number }[];
  };
  workspaces: {
    id: string;
    name: string;
    plan: PlanId;
    cycle: string;
    status: string;
    founding: boolean;
    ownCode: boolean;
    mrr: number;
    arr: number;
    creators: number;
    seats: number;
    liveHours: number;
    aiRequests: number;
    costs: { ai: number; provider: number; live: number; recording: number; storage: number; screenshots: number; fixed: number; total: number };
    grossProfit: number;
    grossMargin: number | null;
    health: "healthy" | "watch" | "at_risk" | "n/a";
  }[];
  funnel: { step: string; total: number; byPlan: Record<string, number> }[];
  leads: { at: number; name?: string; email?: string; company?: string; creators?: number; message?: string }[];
}

/** Refresh the workspace's plan, limits and usage. */
export async function refreshBilling(): Promise<void> {
  try {
    setState({ billing: await billingApi.me() });
  } catch {
    /* keep the last known */
  }
}

/** A 402 from the API: show the matching upgrade prompt (once per code per minute). */
let lastPrompt = { code: "", at: 0 };
export function showUpgrade(code: string): void {
  const now = Date.now();
  if (lastPrompt.code === code && now - lastPrompt.at < 60_000) return;
  lastPrompt = { code, at: now };
  setState({ upgrade: code });
  track("upgrade_prompt_shown", { plan: getState().billing?.plan, source: code });
}

export const PLAN_NAMES: Record<PlanId, string> = {
  moderator_pro: "Moderator Pro",
  creator_pro: "Creator Pro",
  agency: "Agency",
  agency_pro: "Agency Pro",
  enterprise: "Enterprise",
};

/** Next plan up (contextual upsell). */
export const NEXT_PLAN: Partial<Record<PlanId, PlanId>> = { moderator_pro: "creator_pro", creator_pro: "agency", agency: "agency_pro", agency_pro: "enterprise" };

export function euro(cents: number, lang: "en" | "fr", decimals?: number): string {
  const v = cents / 100;
  const d = decimals ?? (Number.isInteger(v) ? 0 : 2);
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}
