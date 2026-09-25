import { createApp } from "./app";
import { loadConfig } from "./config";
import { NullAIProvider, type AIProvider } from "./ai/AIProvider";
import { AnthropicProvider } from "./ai/AnthropicProvider";
import { NovusRuntime } from "./core/NovusRuntime";
import { MemoryRepository } from "./persistence/MemoryRepository";
import type { Repository } from "./persistence/Repository";
import type { LiveEvent } from "../shared/types";
import { SupabaseRepository } from "./persistence/SupabaseRepository";
import { MockLiveAdapter } from "./platform/MockLiveAdapter";
import { TikTokAdapter } from "./platform/TikTokAdapter";
import { defaultConnectionFactory, TikTokLiveWatcher } from "./platform/TikTokLiveWatcher";
import { RealtimeHub } from "./realtime/RealtimeHub";
import { MAIN_ROOM, RoomRegistry, tiktokRoomId, type Room } from "./core/Rooms";
import { EulerChatSender } from "./chat/EulerChat";

async function main() {
  const config = loadConfig();

  const ai: AIProvider = config.anthropicApiKey
    ? new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.anthropicModel, effort: config.anthropicEffort })
    : new NullAIProvider();

  let repo: Repository = new MemoryRepository(config.dataDir);
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    const supa = new SupabaseRepository(config.supabaseUrl, config.supabaseServiceRoleKey);
    try {
      await supa.init();
      repo = supa;
    } catch (err) {
      console.error(`[novus] Supabase unavailable, falling back to memory: ${err instanceof Error ? err.message : err}`);
    }
  }

  const aiQueueOptions = { batchSize: config.aiBatchSize, flushMs: 1200, maxCallsPerMinute: config.aiMaxCallsPerMinute, maxQueue: 64 };

  /** Build one room: its own runtime, realtime hub and TikTok status. */
  const buildRoom = async (tiktok: TikTokAdapter, mock?: MockLiveAdapter, account?: string) => {
    let runtime: NovusRuntime | null = null;
    const hub = new RealtimeHub(200, () => {
      if (!runtime) return {};
      return { stats: runtime.stats(), ai: runtime.aiQueue.status(), demo: mock?.status(), tiktok: tiktok.status() };
    });
    runtime = new NovusRuntime({ repo, ai, tiktok, mock, hub, aiQueueOptions, account });
    await runtime.init();
    hub.start();
    return { runtime, hub };
  };

  // Main room: Demo LIVE + token-protected connector ingestion.
  const mainTikTok = new TikTokAdapter(Boolean(config.ingestToken));
  const mock = new MockLiveAdapter();
  const main = await buildRoom(mainTikTok, mock);
  mock.onAutoStop = () => void main.runtime.endSession();
  const mainRoom: Room = {
    id: MAIN_ROOM,
    kind: "main",
    runtime: main.runtime,
    hub: main.hub,
    tiktok: mainTikTok,
    dispose: async () => {
      main.hub.stop();
      await main.runtime.endSession().catch(() => undefined);
      await main.runtime.shutdown();
    },
  };

  // One room per followed TikTok account, all watched at the same time with the optional
  // unofficial, read-only live connector (TIKTOK_LIVE_CONNECTOR=off disables watching).
  const createTikTokRoom = async (username: string): Promise<Room> => {
    const id = tiktokRoomId(username);
    const tiktok = new TikTokAdapter(false);
    tiktok.unofficialLiveConnector = config.tiktokLiveConnector;
    await tiktok.connect(username);
    const { runtime, hub } = await buildRoom(tiktok, undefined, username);
    let watcher: TikTokLiveWatcher | null = null;
    if (config.tiktokLiveConnector) {
      watcher = new TikTokLiveWatcher(
        defaultConnectionFactory(config.eulerApiKey, (m) => console.log(m)),
        {
          push: async (events) => {
            // Only one session per LIVE: a late "started" marker must not reset a running session.
            const live = runtime.session?.status === "live" && runtime.session.source === "tiktok";
            const batch = (events as unknown as LiveEvent[]).filter((e) => !(live && e.type === "stream_status" && e.status === "started"));
            if (batch.length) await runtime.ingestExternal(batch, "tiktok");
            hub.pushExtras({ tiktok: tiktok.status() });
          },
          waiting: (detail) => {
            tiktok.noteWaiting(detail);
            hub.pushExtras({ tiktok: tiktok.status() });
          },
          error: (message) => {
            tiktok.fail(message);
            hub.pushExtras({ tiktok: tiktok.status() });
          },
          alive: () => tiktok.noteHeartbeat(),
        },
        { pollMs: 60_000, errorBackoffMs: 180_000, log: (m) => console.log(m) },
      );
      watcher.watch(username);
      console.log(`[novus] TikTok live connector watching @${username}`);
    }
    return {
      id,
      kind: "tiktok",
      username,
      runtime,
      hub,
      tiktok,
      liveRoomId: () => watcher?.roomId,
      dispose: async () => {
        watcher?.stop();
        await runtime.endSession().catch(() => undefined);
        await runtime.shutdown();
        hub.stop();
        console.log(`[novus] stopped following @${username}`);
      },
    };
  };

  const rooms = new RoomRegistry(mainRoom, createTikTokRoom);
  // Older installs stored a single followed account; fold it into the profile list.
  const legacy = main.runtime.settings.tiktokUsername;
  const profiles = main.runtime.settings.tiktokProfiles ?? [];
  if (legacy && !profiles.includes(legacy)) await main.runtime.updateSettings({ tiktokProfiles: [...profiles, legacy], tiktokUsername: "" });
  else if (legacy) await main.runtime.updateSettings({ tiktokUsername: "" });
  await rooms.syncProfiles();
  rooms.start();

  const chat = new EulerChatSender(
    { apiKey: config.eulerApiKey, clientId: config.eulerClientId, clientSecret: config.eulerClientSecret, authorizeUrl: config.eulerOAuthAuthorizeUrl },
    repo,
  );
  const app = createApp({ config, rooms, chat });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[novus] NOVUS LIVE listening on http://${config.host}:${config.port}`);
    console.log(`[novus] AI: ${ai.available() ? `${ai.name} (${ai.model})` : "local heuristics only (no ANTHROPIC_API_KEY)"}`);
    console.log(`[novus] Persistence: ${repo.kind}${repo.kind === "memory" && config.dataDir ? ` (+ ${config.dataDir})` : ""}`);
    console.log(`[novus] Access token: ${config.accessToken || config.accessTokens?.length ? `required (${[config.accessToken, ...(config.accessTokens ?? [])].filter(Boolean).length} key(s))` : "NOT SET (open access — set APP_ACCESS_TOKEN before exposing publicly)"}`);
    console.log(`[novus] Send in chat: ${chat.configured ? "Euler OAuth configured" : "off (set EULER_CLIENT_ID / EULER_CLIENT_SECRET)"}`);
    console.log(`[novus] Connector ingestion: ${config.ingestToken ? "enabled" : "disabled (set INGEST_TOKEN)"}`);
  });

  const shutdown = async () => {
    console.log("[novus] shutting down…");
    await rooms.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[novus] fatal", err);
  process.exit(1);
});
