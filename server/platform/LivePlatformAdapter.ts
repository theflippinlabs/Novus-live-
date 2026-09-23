import type { LiveEvent, PlatformId } from "../../shared/types";

// A platform adapter's only job is to produce *normalized* LiveEvents.
// The moderation engine, assistant and UI never see platform-specific payloads.

export type LiveEventHandler = (event: LiveEvent) => void;

export interface LivePlatformAdapter {
  readonly platform: PlatformId;
  readonly displayName: string;
  /** Begin emitting events for the given session. */
  start(sessionId: string, emit: LiveEventHandler): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
