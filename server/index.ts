import { createApp } from "./app";
import { loadConfig } from "./config";
import { NullAIProvider, type AIProvider } from "./ai/AIProvider";
import { AnthropicProvider } from "./ai/AnthropicProvider";
import { NovusRuntime } from "./core/NovusRuntime";
import { MemoryRepository } from "./persistence/MemoryRepository";
import type { Repository } from "./persistence/Repository";
import { SupabaseRepository } from "./persistence/SupabaseRepository";
import { MockLiveAdapter } from "./platform/MockLiveAdapter";
import { TikTokAdapter } from "./platform/TikTokAdapter";
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
  hub.start();

  const app = createApp({ config, runtime, hub, tiktok });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[novus] NOVUS LIVE listening on http://${config.host}:${config.port}`);
    console.log(`[novus] AI: ${ai.available() ? `${ai.name} (${ai.model})` : "local heuristics only (no ANTHROPIC_API_KEY)"}`);
    console.log(`[novus] Persistence: ${repo.kind}${repo.kind === "memory" && config.dataDir ? ` (+ ${config.dataDir})` : ""}`);
    console.log(`[novus] Access token: ${config.accessToken ? "required" : "NOT SET (open access — set APP_ACCESS_TOKEN before exposing publicly)"}`);
    console.log(`[novus] Connector ingestion: ${config.ingestToken ? "enabled" : "disabled (set INGEST_TOKEN)"}`);
  });

  const shutdown = async () => {
    console.log("[novus] shutting down…");
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
