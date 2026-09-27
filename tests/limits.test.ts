import { describe, expect, it } from "vitest";
import { defaultBillingConfig } from "../shared/plans";
import { effectiveEntitlements } from "../server/billing/Entitlements";
import type { Workspace } from "../server/billing/Store";

describe("Per-workspace limits", () => {
  it("merges the admin's allowances over the plan's", () => {
    const ws: Workspace = { id: "beta", name: "Testers", plan: "agency", cycle: "month", status: "comped", cancelAtPeriodEnd: false, founding: false, trialUsed: false, createdAt: 0, updatedAt: 0 };
    const planLimit = effectiveEntitlements(ws, defaultBillingConfig()).entitlements.creator_limit;
    expect(planLimit).toBe(15);
    const raised = effectiveEntitlements({ ...ws, limits: { creator_limit: 50 } }, defaultBillingConfig()).entitlements;
    expect(raised.creator_limit).toBe(50);
    expect(raised.team_seat_limit).toBe(effectiveEntitlements(ws, defaultBillingConfig()).entitlements.team_seat_limit);
  });
});
