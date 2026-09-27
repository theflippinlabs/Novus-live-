import { describe, expect, it } from "vitest";
import { DEFAULT_COSTS, DEFAULT_PLANS, DEFAULT_VIDEO_PACKS, VIDEO_PACK_IDS, withVideoPack, defaultBillingConfig } from "../shared/plans";
import { allowanceLeft, effectiveEntitlements } from "../server/billing/Entitlements";
import type { Workspace } from "../server/billing/Store";

/** Stripe's European card fee: 1.5 % + €0.25 per invoice. */
const stripeFee = (cents: number) => cents / 100 * 0.015 + 0.25;

/** Monthly cost (EUR) of a pack used up to its caps. */
function packCost(hours: number, gbUploaded: number, gbServed: number) {
  const c = DEFAULT_COSTS;
  return hours * c.per_recording_hour + gbUploaded * (c.per_video_gb_uploaded + c.per_storage_gb_month) + gbServed * c.per_video_gb_served;
}

describe("Video option pricing", () => {
  it("every pack stays profitable, even used to the last gigabyte and fully watched", () => {
    for (const id of VIDEO_PACK_IDS) {
      const p = DEFAULT_VIDEO_PACKS[id];
      const price = p.monthly / 100;
      // Worst case: storage cap reached (a high bitrate) and every gigabyte downloaded once.
      const worst = packCost(p.hours, p.storage_gb, p.storage_gb) + stripeFee(p.monthly);
      // Typical: 480p ≈ 0.6 GB per hour, a fifth of it watched again.
      const typical = packCost(p.hours, p.hours * 0.6, p.hours * 0.6 * 0.2) + stripeFee(p.monthly);
      expect(1 - worst / price, `${id} worst-case margin`).toBeGreaterThan(0.55);
      expect(1 - typical / price, `${id} typical margin`).toBeGreaterThan(0.8);
      // Two months free on the yearly price, like the plans.
      expect(p.yearly).toBe(p.monthly * 10);
    }
  });

  it("a pack adds recording to any plan, with hard caps", () => {
    const e = withVideoPack(DEFAULT_PLANS.creator_pro.entitlements, DEFAULT_VIDEO_PACKS.video_50);
    expect(e).toMatchObject({ recording: true, recording_hours: 50, video_storage_gb: 40, video_retention_days: 30 });
    const ws: Workspace = { id: "w", name: "W", plan: "agency", cycle: "month", status: "active", cancelAtPeriodEnd: false, founding: false, trialUsed: false, createdAt: 0, updatedAt: 0 };
    const cfg = defaultBillingConfig();
    const usage = { ai_requests: 0, ai_tokens: 0, live_monitoring_hours: 0, exports: 0, provider_calls: 0, recording_hours: 0, video_gb: 0, screenshots: 0 };
    expect(allowanceLeft(effectiveEntitlements(ws, cfg), usage, "video")).toBe(false);
    const withPack = effectiveEntitlements({ ...ws, videoPack: "video_150" }, cfg);
    expect(allowanceLeft(withPack, usage, "video")).toBe(true);
    // Recording stops at either cap: hours or gigabytes.
    expect(allowanceLeft(withPack, { ...usage, recording_hours: 150 }, "video")).toBe(false);
    expect(allowanceLeft(withPack, { ...usage, video_gb: 120 }, "video")).toBe(false);
  });
});
