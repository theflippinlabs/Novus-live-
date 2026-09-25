import type { LiveEvent } from "../../shared/types";
import type { NovusRuntime } from "./NovusRuntime";

/*
 * Decides whether a followed account's confirmed LIVE is recorded.
 *
 *  - auto (default): every LIVE is recorded from start to end, app open or not.
 *  - manual: the LIVE is detected and shown, but recorded only after the moderator
 *    taps "Start recording"; the choice lasts until that LIVE ends.
 *
 * Either way the moderator can stop recording early. The watcher only sends a "started"
 * marker once the LIVE is confirmed by real room activity, and an "ended" marker when
 * TikTok ends it or the room goes silent.
 */

export class RecordingError extends Error {}

export class LiveRecorder {
  private manual = false;
  /** Manual mode: the moderator started recording this LIVE. */
  private armed = false;
  private onAir = false;

  constructor(
    private username: string,
    private runtime: NovusRuntime,
    private hooks: { waiting: (detail: string) => void; changed: () => void },
  ) {}

  get detected(): boolean {
    return this.onAir;
  }

  get mode(): "auto" | "manual" {
    return this.manual ? "manual" : "auto";
  }

  private get recording(): boolean {
    return this.runtime.session?.status === "live" && this.runtime.session.source === "tiktok";
  }

  /** Events from the watcher (already normalized). */
  async push(events: LiveEvent[]): Promise<void> {
    const started = events.some((e) => e.type === "stream_status" && e.status === "started");
    const ended = events.some((e) => e.type === "stream_status" && e.status === "ended");
    if (started) this.onAir = true;
    if (!this.manual || this.armed) {
      // Only one session per LIVE: a late "started" marker must not reset a running session.
      const live = this.recording;
      const batch = events.filter((e) => !(live && e.type === "stream_status" && e.status === "started"));
      if (batch.length) await this.runtime.ingestExternal(batch, "tiktok");
    } else if (ended && this.recording) {
      // Recording was stopped by hand but a session is still open: close it with the LIVE.
      await this.runtime.ingestExternal(events.filter((e) => e.type === "stream_status" && e.status === "ended"), "tiktok");
    }
    if (ended) {
      this.onAir = false;
      this.armed = false;
    }
    if (started && this.manual && !this.armed) this.hooks.waiting(`@${this.username} is LIVE — recording is manual`);
    if (started || ended) this.hooks.changed();
  }

  /** Moderator starts or stops recording the current LIVE. */
  async setRecording(on: boolean): Promise<void> {
    if (on) {
      if (!this.onAir) throw new RecordingError("not_live");
      this.armed = true;
      if (!this.recording) {
        const now = Date.now();
        await this.runtime.ingestExternal([{ id: `tt:start:${now}`, timestamp: now, type: "stream_status", status: "started", title: `@${this.username} LIVE` }] as unknown as LiveEvent[], "tiktok");
      }
    } else {
      // Stopped by hand: nothing more is recorded until the moderator restarts it or the next LIVE (auto mode).
      this.armed = false;
      await this.runtime.endSession();
    }
    this.hooks.changed();
  }

  /** Switch between auto and manual, applied immediately to a running LIVE. */
  apply(manual: boolean): void {
    if (manual === this.manual) return;
    this.manual = manual;
    // Now manual while a LIVE is being recorded: keep recording it until it ends.
    if (manual && this.recording) this.armed = true;
    // Now auto while a LIVE runs unrecorded: record it from now on.
    if (!manual && this.onAir && !this.recording) void this.setRecording(true).catch(() => undefined);
    this.hooks.changed();
  }
}
