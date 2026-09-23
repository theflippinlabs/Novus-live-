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

  const tiktok = new TikTokAdapter(Boolean(config.ingestToken));
  const mock = new MockLiveAdapter();
  let runtime: NovusRuntime | null = null;
  const hub = new RealtimeHub(200, () => {
    if (!runtime) return {};
    return { stats: runtime.stats(), ai: runtime.aiQueue.status(), demo: mock.status(), tiktok: tiktok.status() };
  });
  runtime = new NovusRuntime({
    repo,
    ai,
    tiktok,
    mock,
    hub,
    aiQueueOptions: { batchSize: config.aiBatchSize, flushMs: 1200, maxCallsPerMinute: config.aiMaxCallsPerMinute, maxQueue: 64 },
  });
  await runtime.init();
  mock.onAutoStop = () => void runtime?.endSession();
  hub.start();

  // Optional unofficial, read-only TikTok LIVE connector (owner opted in; TIKTOK_LIVE_CONNECTOR=off disables it).
  let watcher: TikTokLiveWatcher | null = null;
  if (config.tiktokLiveConnector) {
    tiktok.unofficialLiveConnector = true;
    const rt = runtime;
    watcher = new TikTokLiveWatcher(
      defaultConnectionFactory(config.eulerApiKey, (m) => console.log(m)),
      {
        push: async (events) => {
          // Only one session per LIVE: a late "started" marker must not reset a running session.
          const live = rt.session?.status === "live" && rt.session.source === "tiktok";
          const batch = (events as unknown as LiveEvent[]).filter((e) => !(live && e.type === "stream_status" && e.status === "started"));
          if (batch.length) await rt.ingestExternal(batch, "tiktok");
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
    const saved = runtime.settings.tiktokUsername;
    if (saved) {
      await tiktok.connect(saved);
      watcher.watch(saved);
      console.log(`[novus] TikTok live connector watching @${saved}`);
    }
  }

  const onTikTokAccount = async (username: string | null) => {
    if (username) {
      const saved = runtime.settings.tiktokProfiles ?? [];
      const tiktokProfiles = saved.includes(username) ? saved : [...saved, username].slice(-20);
      await runtime.updateSettings({ tiktokUsername: username, streamerName: username, tiktokProfiles });
      watcher?.watch(username);
    } else {
      watcher?.stop();
      await runtime.updateSettings({ tiktokUsername: "" });
    }
  };

  const app = createApp({ config, runtime, hub, tiktok, onTikTokAccount });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[novus] NOVUS LIVE listening on http://${config.host}:${config.port}`);
    console.log(`[novus] AI: ${ai.available() ? `${ai.name} (${ai.model})` : "local heuristics only (no ANTHROPIC_API_KEY)"}`);
    console.log(`[novus] Persistence: ${repo.kind}${repo.kind === "memory" && config.dataDir ? ` (+ ${config.dataDir})` : ""}`);
    console.log(`[novus] Access token: ${config.accessToken ? "required" : "NOT SET (open access — set APP_ACCESS_TOKEN before exposing publicly)"}`);
    console.log(`[novus] Connector ingestion: ${config.ingestToken ? "enabled" : "disabled (set INGEST_TOKEN)"}`);
  });

  const shutdown = async () => {
    console.log("[novus] shutting down…");
    watcher?.stop();
    hub.stop();
    await runtime?.endSession().catch(() => undefined);
    await runtime?.shutdown();
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
