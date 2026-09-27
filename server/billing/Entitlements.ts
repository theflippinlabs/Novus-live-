import { withVideoPack, type BillingConfig, type Entitlements } from "../../shared/plans";
import type { AccessLevel, UsageSnapshot } from "../../shared/types";
import type { UsageRow, Workspace } from "./Store";

/*
 * The one authoritative answer to "what may this workspace do right now?".
 * Every server-side check goes through here; the app's own plan checks are UX only.
 */

/** A payment that keeps failing past this grace period restricts the workspace. */
export const PAST_DUE_GRACE_MS = 14 * 24 * 3600 * 1000;

/** What a restricted workspace keeps: reading its history and taking its data out. */
const RESTRICTED: Partial<Entitlements> = {
  creator_limit: 0,
  ai_requests: 0,
  ai_tokens: 0,
  live_monitoring_hours: 0,
  recording_hours: 0,
  screenshot_limit: 0,
  recording: false,
  screenshots: false,
  exports_limit: 20,
};

export interface EffectiveEntitlements {
  access: AccessLevel;
  reason?: "payment" | "canceled" | "not_started" | "trial_quota";
  entitlements: Entitlements;
  /** Usage period counters apply to: "trial" or the UTC month. */
  period: string;
}

export const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);

export function effectiveEntitlements(ws: Workspace, cfg: BillingConfig, now = Date.now()): EffectiveEntitlements {
  const plan = cfg.plans[ws.plan];
  const pack = ws.videoPack ? cfg.video[ws.videoPack] : undefined;
  const withPack = withVideoPack(plan.entitlements, pack);
  const full = ws.limits ? { ...withPack, ...ws.limits } : withPack;
  const month = monthKey(now);
  switch (ws.status) {
    case "comped":
    case "active":
      return { access: "full", entitlements: full, period: month };
    case "trialing":
      return { access: "trial", entitlements: { ...full, ...plan.trial }, period: "trial" };
    case "past_due":
      if (ws.pastDueSince && now - ws.pastDueSince > PAST_DUE_GRACE_MS) return restricted(full, "payment", month);
      return { access: "grace", entitlements: full, period: month };
    case "canceled":
      return restricted(full, "canceled", month);
    case "pending":
      return restricted(full, "not_started", month);
    default:
      return restricted(full, "payment", month);
  }
}

function restricted(full: Entitlements, reason: EffectiveEntitlements["reason"], period: string): EffectiveEntitlements {
  return { access: "restricted", reason, entitlements: { ...full, ...RESTRICTED, history_retention_days: full.history_retention_days }, period };
}

// ---------------------------------------------------------------- usage

export const METRICS = [
  "ai_requests",
  "ai_input_tokens",
  "ai_output_tokens",
  "live_minutes",
  "live_sessions",
  "provider_calls",
  "exports",
  "recording_minutes",
  /** Video megabytes uploaded to storage this month (the pack's storage cap). */
  "video_mb_uploaded",
  /** Video megabytes watched or downloaded (storage egress). */
  "video_mb_served",
  "screenshots",
  "chat_messages_sent",
] as const;
export type Metric = (typeof METRICS)[number];

/**
 * Usage counters, kept in memory and flushed in batches (a few rows per workspace per
 * minute instead of one write per event). Each workspace counts both its UTC month and,
 * while trialing, its trial.
 */
export class UsageMeter {
  private values = new Map<string, number>();
  private dirty = new Set<string>();

  static key(ws: string, period: string, metric: string) {
    return `${ws}|${period}|${metric}`;
  }

  load(rows: UsageRow[]): void {
    for (const r of rows) this.values.set(UsageMeter.key(r.workspaceId, r.period, r.metric), r.value);
  }

  add(workspaceId: string, periods: string[], metric: Metric, n = 1): void {
    if (!n) return;
    for (const p of new Set(periods)) {
      const k = UsageMeter.key(workspaceId, p, metric);
      this.values.set(k, (this.values.get(k) ?? 0) + n);
      this.dirty.add(k);
    }
  }

  get(workspaceId: string, period: string, metric: Metric): number {
    return this.values.get(UsageMeter.key(workspaceId, period, metric)) ?? 0;
  }

  /** Rows changed since the last call. */
  takeDirty(): UsageRow[] {
    const rows = [...this.dirty].map((k) => {
      const [workspaceId, period, metric] = k.split("|");
      return { workspaceId, period, metric, value: this.values.get(k) ?? 0 };
    });
    this.dirty.clear();
    return rows;
  }

  /** Put rows back after a failed save so they are retried. */
  restore(rows: UsageRow[]): void {
    for (const r of rows) this.dirty.add(UsageMeter.key(r.workspaceId, r.period, r.metric));
  }

  snapshot(workspaceId: string, period: string): UsageSnapshot {
    const g = (m: Metric) => this.get(workspaceId, period, m);
    return {
      ai_requests: g("ai_requests"),
      ai_tokens: g("ai_input_tokens") + g("ai_output_tokens"),
      live_monitoring_hours: Math.round((g("live_minutes") / 60) * 10) / 10,
      exports: g("exports"),
      provider_calls: g("provider_calls"),
      recording_hours: Math.round((g("recording_minutes") / 60) * 10) / 10,
      video_gb: Math.round((g("video_mb_uploaded") / 1024) * 100) / 100,
      screenshots: g("screenshots"),
    };
  }
}

/** Which allowance a metered action draws on, and whether any is left. */
export function allowanceLeft(eff: EffectiveEntitlements, usage: UsageSnapshot, what: "ai" | "live" | "export" | "video"): boolean {
  const e = eff.entitlements;
  // Video stops at either cap (hours or gigabytes): never an overage.
  if (what === "video") return e.recording && usage.recording_hours < e.recording_hours && usage.video_gb < e.video_storage_gb;
  if (what === "ai") return usage.ai_requests < e.ai_requests && usage.ai_tokens < e.ai_tokens;
  if (what === "live") return usage.live_monitoring_hours < e.live_monitoring_hours;
  return usage.exports < e.exports_limit;
}
