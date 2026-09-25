import { createApp, type Space } from "./app";
import { accessKeys } from "./http/security";
import { loadConfig } from "./config";
import Stripe from "stripe";
import { MeteredAIProvider, NullAIProvider, type AIProvider } from "./ai/AIProvider";
import { BillingService, type StripeLike } from "./billing/Billing";
import { MemoryBillingStore, SupabaseBillingStore, type BillingStore } from "./billing/Store";
import { AnthropicProvider } from "./ai/AnthropicProvider";
import { NovusRuntime } from "./core/NovusRuntime";
import { MemoryRepository } from "./persistence/MemoryRepository";
import { OWNER_TENANT, type Repository } from "./persistence/Repository";
import type { LiveEvent } from "../shared/types";
import { SupabaseRepository } from "./persistence/SupabaseRepository";
import { MockLiveAdapter } from "./platform/MockLiveAdapter";
import { TikTokAdapter } from "./platform/TikTokAdapter";
import { defaultConnectionFactory, TikTokLiveWatcher } from "./platform/TikTokLiveWatcher";
import { RealtimeHub } from "./realtime/RealtimeHub";
import { MAIN_ROOM, RoomRegistry, tiktokRoomId, type Room } from "./core/Rooms";
import { EulerChatSender } from "./chat/EulerChat";
import { LiveRecorder } from "./core/LiveRecorder";

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

  // ---------------------------------------------------------------- billing
  const billingStore: BillingStore =
    repo.kind === "supabase" && config.supabaseUrl && config.supabaseServiceRoleKey ? new SupabaseBillingStore(config.supabaseUrl, config.supabaseServiceRoleKey) : new MemoryBillingStore();
  const stripe = config.stripeSecretKey ? (new Stripe(config.stripeSecretKey) as unknown as StripeLike) : undefined;
  const billing = new BillingService({ store: billingStore, stripe, webhookSecret: config.stripeWebhookSecret, log: (m) => console.log(m) });
  try {
    await billing.init();
  } catch (err) {
    console.error(`[novus] billing tables unavailable (run the billing migration): ${err instanceof Error ? err.message : err}`);
  }
  billing.start();

  const aiQueueOptions = { batchSize: config.aiBatchSize, flushMs: 1200, maxCallsPerMinute: config.aiMaxCallsPerMinute, maxQueue: 64 };

  /**
   * One space per access key: its own followed accounts, settings, LIVE history and
   * "Send in chat" account. All spaces keep watching their accounts at the same time.
   */
  const buildSpace = async (tenant: string): Promise<Space> => {
    const isOwner = tenant === OWNER_TENANT;
    const spaceRepo = repo.scoped(tenant);
    // This space's share of the AI: counted, and cut off (local rules only) past its allowance.
    const spaceAi = new MeteredAIProvider(ai, {
      allowed: () => billing.allowed(tenant, "ai"),
      record: (requests, input, output) => {
        billing.meterAdd(tenant, "ai_requests", requests);
        billing.meterAdd(tenant, "ai_input_tokens", input);
        billing.meterAdd(tenant, "ai_output_tokens", output);
      },
    });
    /** Build one room: its own runtime, realtime hub and TikTok status. */
    const buildRoom = async (tiktok: TikTokAdapter, mock?: MockLiveAdapter, account?: string) => {
      let runtime: NovusRuntime | null = null;
      const hub = new RealtimeHub(200, () => {
        if (!runtime) return {};
        return { stats: runtime.stats(), ai: runtime.aiQueue.status(), demo: mock?.status(), tiktok: tiktok.status() };
      });
      runtime = new NovusRuntime({ repo: spaceRepo, ai: spaceAi, tiktok, mock, hub, aiQueueOptions, account });
      await runtime.init();
      hub.start();
      return { runtime, hub };
    };

    // Main room: Demo LIVE + token-protected connector ingestion.
    // Only the owner's space receives the token-protected connector ingestion.
    const mainTikTok = new TikTokAdapter(isOwner && Boolean(config.ingestToken));
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
    let onRoomsChanged = () => undefined as void;
    const createTikTokRoom = async (username: string): Promise<Room> => {
      const id = tiktokRoomId(username);
      const tiktok = new TikTokAdapter(false);
      tiktok.unofficialLiveConnector = config.tiktokLiveConnector;
      await tiktok.connect(username);
      const { runtime, hub } = await buildRoom(tiktok, undefined, username);
      const recorder = new LiveRecorder(username, runtime, {
        waiting: (detail) => {
          tiktok.noteWaiting(detail);
          hub.pushExtras({ tiktok: tiktok.status() });
        },
        changed: () => onRoomsChanged(),
      });
      let watcher: TikTokLiveWatcher | null = null;
      if (config.tiktokLiveConnector) {
        watcher = new TikTokLiveWatcher(
          // Every connection attempt is a provider (TikTok/Euler) call: metered for costs.
          async (u) => {
            billing.meterAdd(tenant, "provider_calls");
            return connectionFactory(u);
          },
          {
            push: async (events) => {
              await recorder.push(events as unknown as LiveEvent[]);
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
        console.log(`[novus] TikTok live connector watching @${username}${isOwner ? "" : ` (space ${tenant})`}`);
      }
      return {
        id,
        kind: "tiktok",
        username,
        runtime,
        hub,
        tiktok,
        liveRoomId: () => watcher?.roomId,
        detected: () => recorder.detected,
        mode: () => recorder.mode,
        setRecording: (on) => recorder.setRecording(on),
        applySettings: (settings) => recorder.apply((settings.tiktokManual ?? []).includes(username.toLowerCase())),
        dispose: async () => {
          watcher?.stop();
          await runtime.endSession().catch(() => undefined);
          await runtime.shutdown();
          hub.stop();
          console.log(`[novus] stopped following @${username}${isOwner ? "" : ` (space ${tenant})`}`);
        },
      };
    };

    const rooms = new RoomRegistry(mainRoom, createTikTokRoom);
    // Monitor only what the plan allows: none when restricted or when a trial used its LIVE hours.
    rooms.creatorLimit = () => {
      const eff = billing.effective(tenant);
      if (eff.access === "restricted") return 0;
      if (eff.access === "trial" && !billing.allowed(tenant, "live")) return 0;
      return eff.entitlements.creator_limit;
    };
    // Room badges (LIVE detected, recording) refresh right away when a LIVE starts or ends.
    onRoomsChanged = () => rooms.broadcastSummaries();
    // Older installs stored a single followed account; fold it into the profile list.
    const legacy = main.runtime.settings.tiktokUsername;
    const profiles = main.runtime.settings.tiktokProfiles ?? [];
    if (legacy && !profiles.includes(legacy)) await main.runtime.updateSettings({ tiktokProfiles: [...profiles, legacy], tiktokUsername: "" });
    else if (legacy) await main.runtime.updateSettings({ tiktokUsername: "" });
    await rooms.syncProfiles();
    rooms.start();

    const chat = new EulerChatSender(
      { apiKey: config.eulerApiKey, clientId: config.eulerClientId, clientSecret: config.eulerClientSecret, authorizeUrl: config.eulerOAuthAuthorizeUrl },
      spaceRepo,
    );
    return { id: tenant, rooms, chat };
  };

  const connectionFactory = defaultConnectionFactory(config.eulerApiKey, (m) => console.log(m));
  const tenants = [...new Set(accessKeys(config.accessToken, config.accessTokens, OWNER_TENANT).map((k) => k.tenant))];
  if (!tenants.includes(OWNER_TENANT)) tenants.unshift(OWNER_TENANT);
  // Spaces opened by the server's own codes are complimentary: the owner as Enterprise, testers as Agency.
  for (const tenant of tenants) await billing.ensureComped(tenant, tenant === OWNER_TENANT ? "Novus Live" : tenant, tenant === OWNER_TENANT ? "enterprise" : "agency").catch(() => undefined);
  const spaces: Space[] = [];
  for (const tenant of tenants) spaces.push(await buildSpace(tenant));
  // Self-serve customer workspaces.
  for (const ws of billing.all()) if (ws.founderCodeHash && !tenants.includes(ws.id)) spaces.push(await buildSpace(ws.id));
  const byTenant = new Map(spaces.map((x) => [x.id, x]));
  const owner = spaces[0];
  const chat = owner.chat;

  // A subscription starts, ends or changes plan: start or stop monitoring accordingly.
  billing.onChange = (id) => void byTenant.get(id)?.rooms.syncProfiles();
  // Count LIVE minutes per workspace; a trial that used its LIVE hours stops monitoring.
  const seenSessions = new Set<string>();
  setInterval(() => {
    for (const space of byTenant.values()) {
      let live = 0;
      for (const r of space.rooms.all()) {
        const s = r.runtime.session;
        if (r.kind !== "tiktok" || s?.status !== "live" || s.source !== "tiktok") continue;
        live++;
        if (seenSessions.size > 20_000) seenSessions.clear();
        if (!seenSessions.has(s.id)) {
          seenSessions.add(s.id);
          billing.meterAdd(space.id, "live_sessions");
        }
      }
      if (live) billing.meterAdd(space.id, "live_minutes", live);
      if (live && billing.effective(space.id).access === "trial" && !billing.allowed(space.id, "live")) void space.rooms.syncProfiles();
    }
  }, 60_000).unref();

  const app = createApp({
    config,
    spaces,
    billing,
    provisionSpace: async (id) => {
      const space = await buildSpace(id);
      byTenant.set(id, space);
      return space;
    },
  });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[novus] NOVUS LIVE listening on http://${config.host}:${config.port}`);
    console.log(`[novus] AI: ${ai.available() ? `${ai.name} (${ai.model})` : "local heuristics only (no ANTHROPIC_API_KEY)"}`);
    console.log(`[novus] Persistence: ${repo.kind}${repo.kind === "memory" && config.dataDir ? ` (+ ${config.dataDir})` : ""}`);
    console.log(`[novus] Access token: ${config.accessToken ? `required — spaces: ${spaces.map((x) => x.id).join(", ")}` : "NOT SET (open access — set APP_ACCESS_TOKEN before exposing publicly)"}`);
    console.log(`[novus] Send in chat: ${chat.configured ? "Euler OAuth configured" : "off (set EULER_CLIENT_ID / EULER_CLIENT_SECRET)"}`);
    console.log(`[novus] Billing: ${billing.stripeEnabled ? `Stripe on${config.stripeWebhookSecret ? "" : " (STRIPE_WEBHOOK_SECRET missing)"}` : "Stripe off (set STRIPE_SECRET_KEY)"} · ${billing.all().length} workspace(s)`);
    console.log(`[novus] Connector ingestion: ${config.ingestToken ? "enabled" : "disabled (set INGEST_TOKEN)"}`);
  });

  const shutdown = async () => {
    console.log("[novus] shutting down…");
    await Promise.all([...byTenant.values()].map((x) => x.rooms.shutdown()));
    await billing.stop();
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
