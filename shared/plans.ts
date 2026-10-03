/*
 * Novus Live commercial catalog — the single source of truth for plans, prices,
 * entitlements, trial allowances and internal cost assumptions.
 *
 * The server merges admin overrides (stored in the database) over these defaults, so
 * limits, trial allowances, founding capacity and cost assumptions can change without
 * a deploy. Prices charged are Stripe's (looked up by `lookup_key`); the amounts below
 * are what the pricing page shows and what profitability uses.
 */

export const PLAN_IDS = ["moderator_pro", "creator_pro", "agency", "agency_pro", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type BillingCycle = "month" | "year";

/** Plans a customer can buy online (Enterprise is sales-led). */
export const SELF_SERVE_PLANS: PlanId[] = ["moderator_pro", "creator_pro", "agency", "agency_pro"];

export interface Entitlements {
  /** Followed TikTok accounts monitored at the same time. */
  creator_limit: number;
  /** Team members besides the founder. */
  team_seat_limit: number;
  /** AI moderation reviews per billing month (fair use; beyond it, local rules keep moderating). */
  ai_requests: number;
  /** AI tokens per billing month (fair use). */
  ai_tokens: number;
  /** LIVE hours monitored per billing month, all creators together (fair use). */
  live_monitoring_hours: number;
  recording_hours: number;
  video_storage_gb: number;
  video_retention_days: number;
  screenshot_limit: number;
  /** How far back the History goes. */
  history_retention_days: number;
  /** Exports (PDF, CSV, conversation) per billing month; 0 = none. */
  exports_limit: number;
  advanced_analytics: boolean;
  agency_dashboard: boolean;
  team_roles: boolean;
  recording: boolean;
  screenshots: boolean;
  priority_support: boolean;
  api_access: boolean;
  white_label: boolean;
}

export interface PlanDef {
  id: PlanId;
  /** Monthly price in cents (EUR); null = custom. */
  monthly: number | null;
  /** Yearly price in cents (EUR); null = custom. */
  yearly: number | null;
  /** Free trial length for new customers (0 = no trial). */
  trialDays: number;
  entitlements: Entitlements;
  /** Tighter allowances while trialing (merged over `entitlements`). */
  trial: Partial<Entitlements>;
}

const base: Entitlements = {
  creator_limit: 1,
  team_seat_limit: 0,
  ai_requests: 0,
  ai_tokens: 0,
  live_monitoring_hours: 0,
  recording_hours: 0,
  video_storage_gb: 0,
  video_retention_days: 0,
  screenshot_limit: 0,
  history_retention_days: 7,
  exports_limit: 0,
  advanced_analytics: false,
  agency_dashboard: false,
  team_roles: false,
  recording: false,
  screenshots: false,
  priority_support: false,
  api_access: false,
  white_label: false,
};

export const DEFAULT_PLANS: Record<PlanId, PlanDef> = {
  moderator_pro: {
    id: "moderator_pro",
    monthly: 2900,
    yearly: 29000,
    trialDays: 7,
    // Allowances follow what a LIVE hour really costs (≈ 10 AI reviews and 25k tokens per hour).
    entitlements: {
      ...base,
      creator_limit: 1,
      team_seat_limit: 0,
      ai_requests: 600,
      ai_tokens: 1_600_000,
      live_monitoring_hours: 60,
      history_retention_days: 30,
      exports_limit: 300,
    },
    trial: { ai_requests: 150, ai_tokens: 400_000, live_monitoring_hours: 12, exports_limit: 10 },
  },
  creator_pro: {
    id: "creator_pro",
    monthly: 5900,
    yearly: 59000,
    trialDays: 7,
    entitlements: {
      ...base,
      creator_limit: 3,
      team_seat_limit: 3,
      ai_requests: 1200,
      ai_tokens: 3_200_000,
      live_monitoring_hours: 120,
      history_retention_days: 90,
      exports_limit: 500,
      advanced_analytics: true,
      team_roles: true,
    },
    trial: { ai_requests: 200, ai_tokens: 520_000, live_monitoring_hours: 15, exports_limit: 15 },
  },
  agency: {
    id: "agency",
    monthly: 24900,
    yearly: 249000,
    trialDays: 14,
    entitlements: {
      ...base,
      creator_limit: 15,
      team_seat_limit: 10,
      ai_requests: 6000,
      ai_tokens: 16_000_000,
      live_monitoring_hours: 600,
      screenshot_limit: 60000,
      history_retention_days: 365,
      exports_limit: 3000,
      advanced_analytics: true,
      agency_dashboard: true,
      team_roles: true,
      screenshots: true,
      priority_support: true,
    },
    // Agency trials are the most expensive to serve: fewer creators and a small allowance.
    trial: { creator_limit: 5, team_seat_limit: 3, ai_requests: 400, ai_tokens: 1_040_000, live_monitoring_hours: 40, screenshot_limit: 1000, exports_limit: 30 },
  },
  agency_pro: {
    id: "agency_pro",
    monthly: 59900,
    yearly: 599000,
    // Normally an upgrade from Agency or after onboarding: no self-serve trial.
    trialDays: 0,
    entitlements: {
      ...base,
      creator_limit: 40,
      team_seat_limit: 25,
      ai_requests: 16000,
      ai_tokens: 42_000_000,
      live_monitoring_hours: 1600,
      screenshot_limit: 180000,
      history_retention_days: 730,
      exports_limit: 10000,
      advanced_analytics: true,
      agency_dashboard: true,
      team_roles: true,
      screenshots: true,
      priority_support: true,
    },
    trial: {},
  },
  enterprise: {
    id: "enterprise",
    monthly: null,
    yearly: null,
    trialDays: 0,
    entitlements: {
      ...base,
      creator_limit: 200,
      team_seat_limit: 200,
      ai_requests: 1_000_000,
      ai_tokens: 2_000_000_000,
      live_monitoring_hours: 30000,
      recording_hours: 8000,
      video_storage_gb: 20000,
      video_retention_days: 180,
      screenshot_limit: 2_000_000,
      history_retention_days: 3650,
      exports_limit: 100000,
      advanced_analytics: true,
      agency_dashboard: true,
      team_roles: true,
      recording: true,
      screenshots: true,
      priority_support: true,
      api_access: true,
      white_label: true,
    },
    trial: {},
  },
};

/** Stripe price lookup keys (created by `npm run stripe:setup`). */
export const priceLookupKey = (plan: PlanId, cycle: BillingCycle) => `novus_${plan}_${cycle}`;

// ---------------------------------------------------------------- Video option (add-on)

/*
 * LIVE video recording is sold as an option on top of any self-serve plan (Enterprise
 * includes it by contract). Each pack has two hard caps per billing month — recorded
 * hours and stored gigabytes — and recording simply stops at either one: there is no
 * overage, so the cost of a pack is bounded whatever the stream's bitrate.
 */
export const VIDEO_PACK_IDS = ["video_50", "video_150", "video_500"] as const;
export type VideoPackId = (typeof VIDEO_PACK_IDS)[number];

export interface VideoPack {
  id: VideoPackId;
  /** Monthly price in cents (EUR); the yearly price is `yearly` (two months free). */
  monthly: number;
  yearly: number;
  /** Hard caps per billing month. */
  hours: number;
  storage_gb: number;
  retention_days: number;
}

export const DEFAULT_VIDEO_PACKS: Record<VideoPackId, VideoPack> = {
  video_50: { id: "video_50", monthly: 1900, yearly: 19000, hours: 50, storage_gb: 40, retention_days: 30 },
  video_150: { id: "video_150", monthly: 4900, yearly: 49000, hours: 150, storage_gb: 120, retention_days: 30 },
  video_500: { id: "video_500", monthly: 14900, yearly: 149000, hours: 500, storage_gb: 400, retention_days: 30 },
};

/** Stripe lookup key of a pack's price; it must match the plan's billing interval. */
export const videoLookupKey = (pack: VideoPackId, cycle: BillingCycle) => `novus_addon_${pack}_${cycle}`;

/** Entitlements a pack adds on top of the plan's (a plan that already records keeps the larger values). */
export function withVideoPack(e: Entitlements, pack: VideoPack | undefined): Entitlements {
  if (!pack) return e;
  return {
    ...e,
    recording: true,
    recording_hours: Math.max(e.recording ? e.recording_hours : 0, pack.hours),
    video_storage_gb: Math.max(e.recording ? e.video_storage_gb : 0, pack.storage_gb),
    video_retention_days: Math.max(e.recording ? e.video_retention_days : 0, pack.retention_days),
  };
}

export interface FoundingOffer {
  enabled: boolean;
  /** Real cap on founding agencies (counted from the database). */
  capacity: number;
  /** Discount per month in cents while it lasts (€249 → €199). */
  discountCents: number;
  months: number;
  /** Stripe coupon id created by `npm run stripe:setup`. */
  couponId: string;
}

export const DEFAULT_FOUNDING: FoundingOffer = { enabled: true, capacity: 20, discountCents: 5000, months: 12, couponId: "NOVUS_FOUNDING_AGENCY" };

/** Internal cost assumptions (EUR) — admin-editable, never shown to customers. */
export interface CostAssumptions {
  per_1m_input_tokens: number;
  per_1m_output_tokens: number;
  per_provider_request: number;
  per_live_hour: number;
  /** Server time of one recorded hour (ffmpeg copies the stream: no re-encoding). */
  per_recording_hour: number;
  /** Speech-to-text for subtitles, per hour of audio (ElevenLabs Scribe, EUR, upper bound). */
  per_transcribed_hour: number;
  /** Railway egress: every recorded gigabyte is uploaded once to storage ($0.05/GB). */
  per_video_gb_uploaded: number;
  /** Supabase Storage size beyond the Pro quota ($0.0213/GB-month). */
  per_storage_gb_month: number;
  /** Supabase egress when a video is watched or downloaded ($0.09/GB beyond the quota). */
  per_video_gb_served: number;
  per_1000_screenshots: number;
  /** Fixed monthly cost per paying workspace (support, hosting share…). */
  per_workspace_month: number;
  /** Flat monthly platform subscriptions in EUR, counted once (Euler Business + Premium Webcast
   *  Routes $100, Supabase Pro $25, Railway ≈ $5). Euler is flat-rate: requests inside the quota cost nothing more. */
  platform_month: number;
  /** EUR per US dollar, to convert the real Anthropic bill (billed in USD). */
  usd_to_eur: number;
}

// AI defaults follow the published claude-opus-5-5 rates ($4 / $20 per 1M tokens), converted to EUR.
// Provider: Euler Business ($50 / month for 10,000 requests a day ≈ $0.00017 a request).
export const DEFAULT_COSTS: CostAssumptions = {
  per_1m_input_tokens: 3.68,
  per_1m_output_tokens: 18.4,
  // Euler bills a flat plan (in platform_month); requests inside its daily quota cost nothing more.
  per_provider_request: 0,
  per_live_hour: 0.02,
  per_recording_hour: 0.003,
  per_transcribed_hour: 0.37,
  per_video_gb_uploaded: 0.046,
  per_storage_gb_month: 0.0196,
  per_video_gb_served: 0.083,
  per_1000_screenshots: 0.02,
  per_workspace_month: 1,
  platform_month: 120,
  usd_to_eur: 0.92,
};

export interface MarginThresholds {
  /** Healthy at or above this gross margin (%). */
  target: number;
  /** "Watch" between watch and target; "At risk" below watch. */
  watch: number;
}

export const DEFAULT_MARGINS: MarginThresholds = { target: 70, watch: 45 };

/** Everything the admin can change without a deploy. */
export interface BillingConfig {
  plans: Record<PlanId, PlanDef & { available: boolean }>;
  video: Record<VideoPackId, VideoPack & { available: boolean }>;
  founding: FoundingOffer;
  costs: CostAssumptions;
  margins: MarginThresholds;
}

export function defaultBillingConfig(): BillingConfig {
  const plans = Object.fromEntries(PLAN_IDS.map((id) => [id, { ...structuredClone(DEFAULT_PLANS[id]), available: true }])) as BillingConfig["plans"];
  const video = Object.fromEntries(VIDEO_PACK_IDS.map((id) => [id, { ...DEFAULT_VIDEO_PACKS[id], available: true }])) as BillingConfig["video"];
  return { plans, video, founding: { ...DEFAULT_FOUNDING }, costs: { ...DEFAULT_COSTS }, margins: { ...DEFAULT_MARGINS } };
}

/** Admin overrides merged over the defaults (unknown keys ignored). */
export function mergeBillingConfig(overrides: unknown): BillingConfig {
  const cfg = defaultBillingConfig();
  const o = (overrides ?? {}) as Partial<{ plans: Record<string, Partial<PlanDef & { available: boolean }>>; video: Record<string, Partial<VideoPack & { available: boolean }>>; founding: Partial<FoundingOffer>; costs: Partial<CostAssumptions>; margins: Partial<MarginThresholds> }>;
  for (const id of PLAN_IDS) {
    const p = o.plans?.[id];
    if (!p) continue;
    const cur = cfg.plans[id];
    cfg.plans[id] = {
      ...cur,
      ...(typeof p.available === "boolean" ? { available: p.available } : {}),
      ...(typeof p.trialDays === "number" ? { trialDays: p.trialDays } : {}),
      entitlements: { ...cur.entitlements, ...pickKnown(p.entitlements, cur.entitlements) },
      trial: { ...cur.trial, ...pickKnown(p.trial, cur.entitlements) },
    };
  }
  for (const id of VIDEO_PACK_IDS) {
    const v = o.video?.[id];
    if (v) cfg.video[id] = { ...cfg.video[id], ...pickKnown(v, cfg.video[id]), id };
  }
  if (o.founding) cfg.founding = { ...cfg.founding, ...pickKnown(o.founding, cfg.founding) };
  if (o.costs) cfg.costs = { ...cfg.costs, ...pickKnown(o.costs, cfg.costs) };
  if (o.margins) cfg.margins = { ...cfg.margins, ...pickKnown(o.margins, cfg.margins) };
  return cfg;
}

function pickKnown<T extends object>(src: unknown, shape: T): Partial<T> {
  const out: Partial<T> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) {
    if (k in shape && typeof v === typeof (shape as Record<string, unknown>)[k]) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Monthly-equivalent revenue in cents for a plan and cycle (before discounts). */
export function monthlyValue(plan: PlanDef, cycle: BillingCycle): number {
  if (cycle === "year") return plan.yearly !== null ? Math.round(plan.yearly / 12) : 0;
  return plan.monthly ?? 0;
}
