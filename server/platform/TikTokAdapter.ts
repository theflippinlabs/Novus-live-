import type { CapabilityInfo, LiveEvent, TikTokIntegrationState, TikTokIntegrationStatus } from "../../shared/types";
import type { LiveEventHandler, LivePlatformAdapter } from "./LivePlatformAdapter";

/*
 * TikTok LIVE adapter.
 *
 * We are not aware of a generally available, documented TikTok API that streams
 * LIVE chat to third-party apps or lets them mute/block on a moderator's behalf.
 *
 * Event sources (isolated from the rest of the app):
 *  1. Authorized connector push: an approved process POSTs normalized events to
 *     /api/ingest/events with the INGEST_TOKEN.
 *  2. Optional UNOFFICIAL read-only live connector (TikTokLiveWatcher, using the
 *     community `tiktok-live-connector` library), enabled by the owner's choice and
 *     switchable off with TIKTOK_LIVE_CONNECTOR=off.
 *  3. Future approved access: implement TikTokEventSource (docs/TIKTOK_INTEGRATION.md).
 * Moderation actions are never automated: they stay MANUAL ACTION REQUIRED.
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

/** Capabilities when the unofficial live connector is enabled. */
export const TIKTOK_CAPABILITIES_UNOFFICIAL: CapabilityInfo[] = TIKTOK_CAPABILITIES.map((c) =>
  c.capability.startsWith("Reading LIVE comments")
    ? {
        capability: "Reading LIVE comments, gifts, joins, follows, viewer count",
        status: "implemented",
        detail: "Via the UNOFFICIAL tiktok-live-connector library (read-only, no login). Not authorized by TikTok: it can break at any time and may conflict with TikTok's Terms.",
      }
    : c,
);

const CONNECTED_TIMEOUT_MS = 150_000;

export class TikTokAdapter implements LivePlatformAdapter {
  readonly platform = "tiktok" as const;
  readonly displayName = "TikTok LIVE";
  private running = false;
  private username?: string;
  private lastEventAt?: number;
  private liveState: "none" | "live" | "ended" = "none";
  private error?: string;
  private detail?: string;
  unofficialLiveConnector = false;

  constructor(
    private connectorConfigured: boolean,
    private source?: TikTokEventSource,
  ) {}

  /** The live connector reached TikTok; the account is not live right now. */
  noteWaiting(detail: string): void {
    this.lastEventAt = Date.now();
    this.error = undefined;
    this.detail = detail;
    if (this.liveState === "live") this.liveState = "ended";
    else this.liveState = "none";
  }

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
    this.detail = undefined;
    this.error = undefined;
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
    this.detail = undefined;
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
    if (this.connectorConfigured || this.source || this.unofficialLiveConnector) return "CONNECTOR_AVAILABLE";
    return "NOT_CONNECTED";
  }

  status(): TikTokIntegrationStatus {
    return {
      state: this.state(),
      username: this.username,
      connectorConfigured: this.connectorConfigured || Boolean(this.source) || this.unofficialLiveConnector,
      lastEventAt: this.lastEventAt,
      error: this.error,
      detail: this.detail,
      source: this.unofficialLiveConnector ? "unofficial_live_connector" : this.connectorConfigured ? "connector_push" : undefined,
      capabilities: this.unofficialLiveConnector ? TIKTOK_CAPABILITIES_UNOFFICIAL : TIKTOK_CAPABILITIES,
    };
  }
}
