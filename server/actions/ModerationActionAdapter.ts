import type { ActionStatus, ActionType, ViewerRef } from "../../shared/types";

// Every moderation action goes through an adapter. An adapter must NEVER report
// success for something it could not actually do on the platform: when there is
// no authorized API, it returns `manual_required` with exact in-app steps.

export interface ActionTarget {
  viewer: ViewerRef;
  alertText?: string;
  reasons?: string[];
  language: "en" | "fr";
}

export interface ActionResult {
  status: ActionStatus;
  message: string;
  instructions?: string[];
  suggestedMessage?: string;
}

export type ActionCapability = "automated" | "simulated" | "manual" | "local";

export interface ModerationActionAdapter {
  readonly id: string;
  capabilities(): Record<ActionType, ActionCapability>;
  watch(target: ActionTarget): Promise<ActionResult>;
  warn(target: ActionTarget): Promise<ActionResult>;
  mute(target: ActionTarget): Promise<ActionResult>;
  block(target: ActionTarget): Promise<ActionResult>;
  report(target: ActionTarget): Promise<ActionResult>;
  dismiss(target: ActionTarget): Promise<ActionResult>;
}

export async function runAction(adapter: ModerationActionAdapter, action: ActionType, target: ActionTarget): Promise<ActionResult> {
  try {
    switch (action) {
      case "watch":
        return await adapter.watch(target);
      case "warn":
        return await adapter.warn(target);
      case "mute":
        return await adapter.mute(target);
      case "block":
        return await adapter.block(target);
      case "report":
        return await adapter.report(target);
      case "dismiss":
        return await adapter.dismiss(target);
    }
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : "Action failed" };
  }
}

export function warningMessage(username: string, language: "en" | "fr"): string {
  return language === "fr"
    ? `@${username} merci de rester respectueux dans le chat. Prochaine fois : mute.`
    : `@${username} please keep the chat respectful. Next time is a mute.`;
}
