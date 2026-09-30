import { createApp, type Space } from "./app";
import { accessKeys } from "./http/security";
import { loadConfig } from "./config";
import Stripe from "stripe";
import { MeteredAIProvider, NullAIProvider, type AIProvider } from "./ai/AIProvider";
import { BillingService, type StripeLike } from "./billing/Billing";
import { applyPlanToRooms } from "./billing/wire";
import { AnthropicCostReport } from "./billing/AnthropicCost";
import { ResendMailer } from "./mail/Mailer";
import { MemoryBillingStore, SupabaseBillingStore, type BillingStore } from "./billing/Store";
import { AnthropicProvider } from "./ai/AnthropicProvider";
import { NovusRuntime, type RuntimeEvents } from "./core/NovusRuntime";
import { AlertThrottle, PushService } from "./push/Push";
import { criticalAlertMessage, liveEndedMessage, liveStartedMessage } from "./push/messages";
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
import { EulerActionAdapter } from "./actions/EulerActionAdapter";
import type { ModerationActionAdapter } from "./actions/ModerationActionAdapter";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomVideo } from "./video/RoomVideo";
import { BulkLiveChecker } from "./platform/BulkLiveChecker";
import { LocalVideoStore, SupabaseVideoStore, type VideoStore } from "./video/VideoStore";

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
  const billing = new BillingService({ store: billingStore, stripe, webhookSecret: config.stripeWebhookSecret, portalConfiguration: config.stripePortalConfiguration, stripeLiveMode: stripe ? /^(sk|rk)_live_/.test(config.stripeSecretKey ?? "") : undefined, log: (m) => console.log(m) });
  try {
    await billing.init();
  } catch (err) {
    console.error(`[novus] billing tables unavailable (run the billing migration): ${err instanceof Error ? err.message : err}`);
  }
  billing.start();

  // ---------------------------------------------------------------- LIVE video (option)
  // ffmpeg copies TikTok's stream into storage; without it (or with VIDEO_RECORDING=off) video stays off.
  const ffmpegOk = process.env.VIDEO_RECORDING !== "off" && spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  const videoStore: VideoStore =
    repo.kind === "supabase" && config.supabaseUrl && config.supabaseServiceRoleKey
      ? new SupabaseVideoStore(createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }))
      : new LocalVideoStore(join(config.dataDir ?? tmpdir(), "videos"));
  const videoKit = { ready: ffmpegOk, store: videoStore, tmp: join(tmpdir(), "novus-video") };
  // Recorded seconds and bytes, counted in whole minutes / megabytes against the option's caps.
  const videoCarry = new Map<string, { sec: number; mb: number }>();
  const meterVideo = (tenant: string, seconds: number, bytes: number) => {
    const c = videoCarry.get(tenant) ?? { sec: 0, mb: 0 };
    c.sec += seconds;
    c.mb += bytes / 1_048_576;
    const minutes = Math.floor(c.sec / 60);
    const mb = Math.floor(c.mb);
    if (minutes) billing.meterAdd(tenant, "recording_minutes", minutes);
    if (mb) billing.meterAdd(tenant, "video_mb_uploaded", mb);
    c.sec -= minutes * 60;
    c.mb -= mb;
    videoCarry.set(tenant, c);
  };
  // Retention: videos past their pack's retention are deleted from storage (hourly).
  setInterval(() => {
    void (async () => {
      for (const { tenant, record } of await videoStore.expired(Date.now())) {
        await videoStore.remove(record.segments.map((s) => s.path));
        await videoStore.deleteRecord(tenant, record.sessionId);
        console.log(`[video] deleted @${record.account}'s video of ${new Date(record.startedAt).toISOString().slice(0, 10)} (retention over)`);
      }
    })().catch((e) => console.warn(`[video] cleanup: ${e instanceof Error ? e.message : e}`));
  }, 3600_000).unref();

  // ---------------------------------------------------------------- bulk LIVE check (Euler quota)
  // One request tells whether 50 followed accounts are LIVE, with the platform's connected
  // TikTok account (the owner's). Watchers ask it before connecting.
  let platformChat: EulerChatSender | null = null;
  const followersOf = new Map<string, Set<string>>();
  const liveChecker = new BulkLiveChecker({
    apiKey: config.eulerApiKey,
    token: async () => platformChat?.bulkToken() ?? null,
    loadIds: async () => ((await repo.scoped(OWNER_TENANT).loadSecret("tiktok_numeric_ids")) as Record<string, string> | null) ?? {},
    saveIds: (ids) => repo.scoped(OWNER_TENANT).saveSecret("tiktok_numeric_ids", ids),
    meter: (usernames, requests) => {
      const tenants = new Set(usernames.flatMap((u) => [...(followersOf.get(u) ?? [])]));
      for (const t of tenants) billing.meterAdd(t, "provider_calls", requests);
    },
    log: (m) => console.log(m),
  });

  // ---------------------------------------------------------------- push notifications
  const push = new PushService({
    serverRepo: repo.scoped(OWNER_TENANT),
    spaceRepo: (tenant) => repo.scoped(tenant),
    subject: config.publicUrl ?? (config.supportEmail ? `mailto:${config.supportEmail}` : "https://novus-live-production.up.railway.app"),
    log: (m) => console.warn(m),
  });
  await push.init().catch((e) => console.error(`[novus] push notifications unavailable: ${e instanceof Error ? e.message : e}`));
  const alertThrottle = new AlertThrottle();

  const aiQueueOptions = { batchSize: config.aiBatchSize, flushMs: 1200, maxCallsPerMinute: config.aiMaxCallsPerMinute, maxQueue: 64 };

  /**
   * One space per access key: its own followed accounts, settings, LIVE history and
   * "Send in chat" account. All spaces keep watching their accounts at the same time.
   */
  const buildSpace = async (tenant: string): Promise<Space> => {
    const isOwner = tenant === OWNER_TENANT;
    const spaceRepo = repo.scoped(tenant);
    // The space's TikTok moderator account (Euler OAuth): "Send in chat", mute, remove, comments on/off.
    const spaceChat = new EulerChatSender(
      { apiKey: config.eulerApiKey, clientId: config.eulerClientId, clientSecret: config.eulerClientSecret, authorizeUrl: config.eulerOAuthAuthorizeUrl },
      spaceRepo,
    );
    if (isOwner) platformChat = spaceChat;
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
    const buildRoom = async (tiktok: TikTokAdapter, mock?: MockLiveAdapter, account?: string, actions?: ModerationActionAdapter) => {
      let runtime: NovusRuntime | null = null;
      const hub = new RealtimeHub(200, () => {
        if (!runtime) return {};
        return { stats: runtime.stats(), ai: runtime.aiQueue.status(), demo: mock?.status(), tiktok: tiktok.status() };
      });
      // Push notifications for followed TikTok accounts (not for the demo room).
      const lang = () => runtime?.settings.language ?? "fr";
      const notify = (msg: Parameters<typeof push.notify>[1]) =>
        void push.notify(tenant, msg).catch((e) => console.warn(`[push] ${e instanceof Error ? e.message : e}`));
      const events: RuntimeEvents | undefined = account
        ? {
            liveStarted: () => notify(liveStartedMessage(account, lang())),
            liveEnded: (session, report) => notify(liveEndedMessage(account, session, report, lang())),
            criticalAlert: (alert) => {
              const grouped = alertThrottle.take(`${tenant}:${account}`);
              if (grouped) notify(criticalAlertMessage(account, alert, grouped, lang()));
            },
          }
        : undefined;
      runtime = new NovusRuntime({ repo: spaceRepo, ai: spaceAi, tiktok, mock, hub, aiQueueOptions, account, events, actions });
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
      let video: RoomVideo | null = null;
      let videoOn = false;
      let runtimeRef: NovusRuntime | null = null;
      /** Record the LIVE in video while it is recorded, the account has video on and the option has room left. */
      const syncVideo = () => {
        const s = runtimeRef?.session;
        if (!video) return;
        if (s && s.status === "live" && s.source === "tiktok" && videoOn && watcher?.isLive) void video.ensure(s.id).catch((e) => console.warn(`[video] ${e instanceof Error ? e.message : e}`));
        else if (video.sessionId) void video.stop("done").catch((e) => console.warn(`[video] ${e instanceof Error ? e.message : e}`));
      };
      const id = tiktokRoomId(username);
      const tiktok = new TikTokAdapter(false);
      tiktok.unofficialLiveConnector = config.tiktokLiveConnector;
      await tiktok.connect(username);
      // Mute / remove from the LIVE through Euler, as the space's connected moderator account.
      const actions = new EulerActionAdapter({ chat: () => spaceChat, roomId: () => watcher?.roomId });
      const { runtime, hub } = await buildRoom(tiktok, undefined, username, actions);
      runtimeRef = runtime;
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
              syncVideo();
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
          {
            pollMs: 60_000,
            errorBackoffMs: 180_000,
            log: (m) => console.log(m),
            liveGate: (u) => {
              const key = u.toLowerCase();
              followersOf.set(key, (followersOf.get(key) ?? new Set()).add(tenant));
              return liveChecker.isLive(u);
            },
          },
        );
        watcher.watch(username);
        if (videoKit.ready)
          video = new RoomVideo({
            tenant,
            account: username,
            store: videoKit.store,
            tmpRoot: videoKit.tmp,
            streamUrl: (fresh) => watcher?.streamUrl(fresh) ?? Promise.resolve(null),
            allowed: () => billing.allowed(tenant, "video"),
            retentionDays: () => billing.effective(tenant).entitlements.video_retention_days || 30,
            meter: (seconds, bytes) => meterVideo(tenant, seconds, bytes),
            changed: () => onRoomsChanged(),
            log: (m) => console.log(m),
          });
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
        setRecording: async (on) => {
          await recorder.setRecording(on);
          syncVideo();
        },
        video: () => ({ on: videoOn, recording: Boolean(video?.recording) }),
        applySettings: (settings) => {
          recorder.apply((settings.tiktokManual ?? []).includes(username.toLowerCase()));
          videoOn = (settings.tiktokVideo ?? []).includes(username.toLowerCase());
          syncVideo();
        },
        syncVideo,
        dispose: async () => {
          await video?.stop("done").catch(() => undefined);
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
    applyPlanToRooms(rooms, billing, tenant);
    // Room badges (LIVE detected, recording) refresh right away when a LIVE starts or ends.
    onRoomsChanged = () => rooms.broadcastSummaries();
    // Older installs stored a single followed account; fold it into the profile list.
    const legacy = main.runtime.settings.tiktokUsername;
    const profiles = main.runtime.settings.tiktokProfiles ?? [];
    if (legacy && !profiles.includes(legacy)) await main.runtime.updateSettings({ tiktokProfiles: [...profiles, legacy], tiktokUsername: "" });
    else if (legacy) await main.runtime.updateSettings({ tiktokUsername: "" });
    await rooms.syncProfiles();
    rooms.start();

    return { id: tenant, rooms, chat: spaceChat };
  };

  const connectionFactory = defaultConnectionFactory(config.eulerApiKey, (m) => console.log(m));
  const tenants = [...new Set(accessKeys(config.accessToken, config.accessTokens, OWNER_TENANT).map((k) => k.tenant))];
  if (!tenants.includes(OWNER_TENANT)) tenants.unshift(OWNER_TENANT);
  // Spaces opened by the server's own codes are complimentary: the owner as Enterprise, testers as Agency.
  for (const tenant of tenants) await billing.ensureComped(tenant, tenant === OWNER_TENANT ? "Novus Live" : tenant, tenant === OWNER_TENANT ? "enterprise" : "agency").catch(() => undefined);
  const spaces: Space[] = [];
  for (const tenant of tenants) spaces.push(await buildSpace(tenant));
  // Self-serve customer workspaces.
  // (Signups never paid for over 7 days are not loaded: their code cannot log in any more.)
  const staleSignup = Date.now() - 7 * 24 * 3600 * 1000;
  for (const ws of billing.all()) {
    if (!ws.founderCodeHash || tenants.includes(ws.id)) continue;
    if (ws.status === "pending" && ws.createdAt < staleSignup) continue;
    spaces.push(await buildSpace(ws.id));
  }
  const byTenant = new Map(spaces.map((x) => [x.id, x]));
  const owner = spaces[0];
  const chat = owner.chat;

  // A subscription starts, ends or changes plan: start or stop monitoring accordingly.
  billing.onChange = (id) => {
    const space = byTenant.get(id);
    void space?.rooms.syncProfiles().then(() => space.rooms.all().forEach((r) => r.syncVideo?.()));
  };
  // Video resumes after a dropped stream and stops when the option runs out (every 20 s).
  if (videoKit.ready) setInterval(() => byTenant.forEach((space) => space.rooms.all().forEach((r) => r.syncVideo?.())), 20_000).unref();
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

  const mailer = new ResendMailer({ apiKey: config.resendApiKey, from: config.mailFrom });
  const aiCost = new AnthropicCostReport({ adminKey: config.anthropicAdminKey, workspaceId: config.anthropicCostWorkspace });
  const app = createApp({
    config,
    spaces,
    video: { ready: videoKit.ready, store: videoStore },
    billing,
    mailer,
    aiCost,
    push,
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
    console.log(`[novus] Real AI cost: ${aiCost.configured ? "Anthropic Cost API on" : "estimate only (set ANTHROPIC_ADMIN_KEY)"} · Code recovery e-mail: ${mailer.enabled ? "on" : "off (set RESEND_API_KEY / MAIL_FROM)"}`);
    console.log(`[novus] Billing: ${billing.stripeEnabled ? `Stripe on${config.stripeWebhookSecret ? "" : " (STRIPE_WEBHOOK_SECRET missing)"}` : "Stripe off (set STRIPE_SECRET_KEY)"} · ${billing.all().length} workspace(s)`);
    console.log(`[novus] LIVE video: ${videoKit.ready ? `on (${videoStore.kind} storage)` : "off (ffmpeg not found or VIDEO_RECORDING=off)"}`);
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
