import type { RoomSummary, Settings } from "../../shared/types";
import type { NovusRuntime } from "./NovusRuntime";
import type { TikTokAdapter } from "../platform/TikTokAdapter";
import type { RealtimeHub } from "../realtime/RealtimeHub";

/*
 * A room is one independent moderation space with its own runtime (session,
 * chat, alerts, viewers, report), realtime hub and TikTok status.
 *
 *  - "main": Demo LIVE and the token-protected connector ingestion.
 *  - "tt:<handle>": one per followed TikTok account, all watched at the same time.
 *
 * Settings are shared by every room; the main runtime is the one that saves them.
 */

export const MAIN_ROOM = "main";
export const tiktokRoomId = (username: string) => `tt:${username.toLowerCase()}`;

export interface Room {
  id: string;
  kind: "main" | "tiktok";
  username?: string;
  runtime: NovusRuntime;
  hub: RealtimeHub;
  tiktok: TikTokAdapter;
  /** TikTok room id of the account's current LIVE (followed accounts only). */
  liveRoomId?: () => string | undefined;
  /** The account is confirmed LIVE on TikTok (followed accounts only). */
  detected?: () => boolean;
  /** Recording mode of a followed account. */
  mode?: () => "auto" | "manual";
  /** Start / stop recording the current LIVE (manual mode, or to stop early). */
  setRecording?: (on: boolean) => Promise<void>;
  /** New settings for this room (recording mode…). */
  applySettings?: (settings: Settings) => void;
  /** Stop watchers/timers and close any running session. */
  dispose(): Promise<void>;
}

export type TikTokRoomFactory = (username: string) => Promise<Room>;

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private summaryTimer: ReturnType<typeof setInterval> | null = null;
  private lastSummary = "";
  private syncing: Promise<void> = Promise.resolve();

  constructor(
    readonly main: Room,
    private createTikTokRoom?: TikTokRoomFactory,
  ) {
    this.rooms.set(main.id, main);
  }

  get(id: string | undefined | null): Room | undefined {
    return id ? this.rooms.get(id) : undefined;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  get settings(): Settings {
    return this.main.runtime.settings;
  }

  summaries(): RoomSummary[] {
    return this.all().map((r) => {
      const stats = r.runtime.stats();
      return {
        id: r.id,
        kind: r.kind,
        username: r.username,
        live: r.runtime.session?.status === "live",
        detected: r.detected?.() ?? false,
        mode: r.mode?.(),
        state: r.tiktok.state(),
        openAlerts: stats.openAlerts,
        criticalAlerts: stats.criticalAlerts,
        viewerCount: stats.viewerCount,
      };
    });
  }

  /** Push room badges (live dot, alert counts) to every connected client when they change. */
  start(intervalMs = 2000): void {
    if (this.summaryTimer) return;
    this.summaryTimer = setInterval(() => this.broadcastSummaries(), intervalMs);
  }

  broadcastSummaries(force = false): void {
    const rooms = this.summaries();
    const key = JSON.stringify(rooms);
    if (!force && key === this.lastSummary) return;
    this.lastSummary = key;
    for (const r of this.all()) r.hub.pushExtras({ rooms });
  }

  /** Save settings once, share them with every room, then follow/unfollow TikTok accounts. */
  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    // Groups and manual-mode entries only keep accounts that are still followed.
    if (patch.tiktokProfiles || patch.tiktokGroups || patch.tiktokManual) {
      const followed = new Set((patch.tiktokProfiles ?? this.settings.tiktokProfiles ?? []).map((u) => u.toLowerCase()));
      patch = {
        ...patch,
        tiktokGroups: (patch.tiktokGroups ?? this.settings.tiktokGroups ?? []).map((g) => ({ ...g, members: g.members.filter((u) => followed.has(u)) })),
        tiktokManual: (patch.tiktokManual ?? this.settings.tiktokManual ?? []).filter((u) => followed.has(u)),
      };
    }
    const settings = await this.main.runtime.updateSettings(patch);
    for (const r of this.all()) {
      if (r !== this.main) r.runtime.adoptSettings(this.roomSettings(r, settings));
      r.applySettings?.(settings);
    }
    this.broadcastSummaries(true);
    if (patch.tiktokProfiles) await this.syncProfiles();
    return settings;
  }

  /** Each TikTok room names its own streamer (used by the assistant to spot questions to the host). */
  roomSettings(room: Room, settings: Settings = this.settings): Settings {
    return room.username ? { ...settings, streamerName: room.username } : settings;
  }

  /** Make the set of TikTok rooms match settings.tiktokProfiles. Serialized so rapid edits cannot race. */
  syncProfiles(): Promise<void> {
    this.syncing = this.syncing.then(() => this.doSync()).catch((e) => console.error("[novus] room sync failed", e));
    return this.syncing;
  }

  private async doSync(): Promise<void> {
    if (!this.createTikTokRoom) return;
    const wanted = new Map((this.settings.tiktokProfiles ?? []).map((u) => [tiktokRoomId(u), u]));
    for (const room of this.all()) {
      if (room.kind === "tiktok" && !wanted.has(room.id)) {
        this.rooms.delete(room.id);
        await room.dispose();
      }
    }
    for (const [id, username] of wanted) {
      if (this.rooms.has(id)) continue;
      const room = await this.createTikTokRoom(username);
      room.runtime.adoptSettings(this.roomSettings(room));
      room.applySettings?.(this.settings);
      this.rooms.set(id, room);
    }
    this.broadcastSummaries(true);
  }

  async shutdown(): Promise<void> {
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    for (const r of this.all()) await r.dispose();
  }
}
