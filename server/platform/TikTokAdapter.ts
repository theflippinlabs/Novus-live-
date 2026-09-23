import type { CapabilityInfo, LiveEvent, TikTokIntegrationState, TikTokIntegrationStatus } from "../../shared/types";
import type { LiveEventHandler, LivePlatformAdapter } from "./LivePlatformAdapter";

/*
 * TikTok LIVE adapter.
 *
 * Novus does NOT call any TikTok endpoint itself: we are not aware of a generally
 * available, documented TikTok API that streams LIVE chat to third-party apps or
 * lets them mute/block on a moderator's behalf. We do not reverse-engineer or
 * invent one.
 *
 * Instead the adapter exposes ONE isolated integration point, `TikTokEventSource`.
 * Today the only implementation is the authorized connector bridge: an external,
 * approved process POSTs *normalized* events to /api/ingest/events with the
 * INGEST_TOKEN. When approved TikTok access exists, implement TikTokEventSource
 * (see docs/TIKTOK_INTEGRATION.md) and nothing else in the app changes.
 */

export interface TikTokEventSource {
  readonly id: string;
  connect(username: string, emit: (event: Omit<LiveEvent, "sessionId">) => void): Promise<void>;
  disconnect(): Promise<void>;
}

export const TIKTOK_CAPABILITIES: CapabilityInfo[] = [
  { capability: "Normalized event model (comments, viewers, gifts, follows, joins)", status: "implemented", detail: "LiveEvent types + validation; TikTok data enters only through this model." },
  { capability: "Authorized connector ingestion (POST /api/ingest/events)", status: "implemented", detail: "Token-protected, rate-limited, validated. Any approved TikTok LIVE source can push events here." },
  { capability: "Connection/live state tracking", status: "implemented", detail: "NOT CONNECTED → CONNECTOR AVAILABLE → CONNECTED → LIVE DETECTED → LIVE ENDED / ERROR." },
  { capability: "Reading LIVE comments directly from TikTok", status: "requires_authorized_connector", detail: "No public documented TikTok API used. Requires approved TikTok access implemented as a TikTokEventSource." },
  { capability: "Warn a viewer", status: "manual_only", detail: "Novus prepares the exact message; the moderator posts it in TikTok." },
  { capability: "Mute a viewer", status: "manual_only", detail: "Moderator mutes in the TikTok app; Novus gives exact steps and logs the resolution." },
  { capability: "Block / remove a viewer", status: "manual_only", detail: "Moderator blocks in the TikTok app; Novus gives exact steps and logs the resolution." },
  { capability: "Report a viewer", status: "manual_only", detail: "Moderator reports in the TikTok app; Novus suggests the category." },
  { capability: "Automated platform actions", status: "not_available", detail: "Would require an authorized TikTok moderation API. Plug in via ModerationActionAdapter." },
];

const CONNECTED_TIMEOUT_MS = 90_000;

export class TikTokAdapter implements LivePlatformAdapter {
  readonly platform = "tiktok" as const;
  readonly displayName = "TikTok LIVE";
  private running = false;
  private username?: string;
  private lastEventAt?: number;
  private liveState: "none" | "live" | "ended" = "none";
  private error?: string;

  constructor(
    private connectorConfigured: boolean,
    private source?: TikTokEventSource,
  ) {}

  /** Store the target account. The connector (or a future TikTokEventSource) does the actual connection. */
  async connect(username: string): Promise<void> {
    this.username = username.replace(/^@/, "");
    this.error = undefined;
  }

  async disconnect(): Promise<void> {
    await this.stop();
    this.username = undefined;
    this.liveState = "none";
    this.lastEventAt = undefined;
  }

  async start(sessionId: string, emit: LiveEventHandler): Promise<void> {
    this.running = true;
    if (this.source && this.username) {
      try {
        await this.source.connect(this.username, (e) => emit({ ...e, sessionId } as LiveEvent));
      } catch (err) {
        this.fail(err instanceof Error ? err.message : "TikTok source failed");
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.source) await this.source.disconnect().catch(() => undefined);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Called by the ingestion pipeline for every event that arrives from the TikTok connector. */
  noteEvent(event: LiveEvent): void {
    this.lastEventAt = Date.now();
    this.error = undefined;
    if (event.type === "stream_status") this.liveState = event.status === "started" ? "live" : "ended";
    else if (event.type === "comment" || event.type === "viewer_count" || event.type === "gift") {
      if (this.liveState !== "ended") this.liveState = "live";
    }
  }

  noteHeartbeat(): void {
    this.lastEventAt = Date.now();
    this.error = undefined;
  }

  fail(message: string): void {
    this.error = message.slice(0, 300);
  }

  state(now = Date.now()): TikTokIntegrationState {
    if (this.error) return "ERROR";
    const fresh = this.lastEventAt !== undefined && now - this.lastEventAt < CONNECTED_TIMEOUT_MS;
    if (this.liveState === "ended" && this.lastEventAt !== undefined) return "LIVE_ENDED";
    if (fresh && this.liveState === "live") return "LIVE_DETECTED";
    if (fresh) return "CONNECTED";
    if (this.connectorConfigured || this.source) return "CONNECTOR_AVAILABLE";
    return "NOT_CONNECTED";
  }

  status(): TikTokIntegrationStatus {
    return {
      state: this.state(),
      username: this.username,
      connectorConfigured: this.connectorConfigured || Boolean(this.source),
      lastEventAt: this.lastEventAt,
      error: this.error,
      capabilities: TIKTOK_CAPABILITIES,
    };
  }
}
