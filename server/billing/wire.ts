import type { RoomRegistry } from "../core/Rooms";
import type { BillingService } from "./Billing";

/**
 * How many followed accounts a space may monitor right now: none when the workspace is
 * restricted or its trial used its LIVE hours, else the plan's creator limit. Accounts
 * beyond it stay saved, paused.
 */
export function monitoredCreatorLimit(billing: BillingService, workspaceId: string): number {
  const eff = billing.effective(workspaceId);
  if (eff.access === "restricted") return 0;
  if (eff.access === "trial" && !billing.allowed(workspaceId, "live")) return 0;
  return eff.entitlements.creator_limit;
}

export function applyPlanToRooms(rooms: RoomRegistry, billing: BillingService, workspaceId: string): void {
  rooms.creatorLimit = () => monitoredCreatorLimit(billing, workspaceId);
}
