import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { createHmac, randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import {
  actionRequestSchema,
  catchUpRequestSchema,
  demoSpeedSchema,
  demoStartSchema,
  flagRequestSchema,
  ingestBatchSchema,
  loginSchema,
  MAX_PROFILES,
  memberCreateSchema,
  memberUpdateSchema,
  trackSchema,
  signupSchema,
  checkoutSchema,
  changePlanSchema,
  leadSchema,
  adminConfigSchema,
  recordingSchema,
  sendChatSchema,
  settingsPatchSchema,
  tiktokConnectSchema,
} from "../shared/schemas";
import { PERMISSIONS, type ActionType, type DemoSpeed, type LiveEvent, type Me, type Permission, type Settings, type ViewerFlag } from "../shared/types";
import type { Config } from "./config";
import { RecordingError } from "./core/LiveRecorder";
import { MAIN_ROOM, tiktokRoomId, type Room, type RoomRegistry } from "./core/Rooms";
import { ChatSendError, EulerChatSender } from "./chat/EulerChat";
import { chatCsv, chatTxt, HistoryService } from "./history/History";
import { buildReportPdf } from "./reports/pdf";
import { OWNER_TENANT } from "./persistence/Repository";
import { BillingError, BillingService } from "./billing/Billing";
import { MemoryBillingStore } from "./billing/Store";
import { funnel, saasMetrics, workspaceEconomics } from "./billing/Metrics";
import { accessKeys, AUTH_COOKIE, authKey, matchKey, rateLimit, readCookie, requireJson, safeEqual, securityHeaders, sessionCookieValue } from "./http/security";
import { can, canSeeAccount, TeamError, TeamStore, type MemberInput, type Principal } from "./team/Team";

export interface AppDeps {
  config: Pick<Config, "accessToken" | "ingestToken" | "production" | "webDir" | "trustProxy" | "apiRateLimitPerMinute" | "ingestRateLimitPerMinute"> &
    Partial<Pick<Config, "reportTimeZone" | "publicUrl" | "accessTokens" | "sessionSecret">>;
  /** Single-space mode (tests, open access): every key opens these rooms. */
  rooms?: RoomRegistry;
  /** "Send in chat" through Euler Stream OAuth (optional). */
  chat?: EulerChatSender;
  /** One separate space per access key: the owner's first. Overrides `rooms`/`chat`. */
  spaces?: Space[];
  /** Plans, subscriptions, entitlements and usage (defaults to an in-memory, unrestricted setup). */
  billing?: BillingService;
  /** Build the space of a new self-serve workspace (signup). */
  provisionSpace?: (id: string) => Promise<Space>;
}

/** One person's Novus: their own followed accounts, settings, history and "Send in chat" account. */
export interface Space {
  id: string;
  rooms: RoomRegistry;
  chat: EulerChatSender;
  /** Agency team (members with their own access codes and permissions). */
  team?: TeamStore;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, "invalid_input", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res))
    .then((body) => {
      if (!res.headersSent) res.json(body ?? { ok: true });
    })
    .catch(next);
};

const param = (req: Request, name: string): string => {
  const v = req.params[name];
  if (typeof v !== "string" || v.length > 200) throw new HttpError(400, "invalid_param");
  return v;
};

/** Which room a request targets: `X-Novus-Room` header (API) or `?room=` (EventSource). */
function roomOf(rooms: RoomRegistry, req: Request): Room {
  const raw = req.headers["x-novus-room"] ?? req.query.room;
  const id = typeof raw === "string" && raw.length <= 80 ? raw : MAIN_ROOM;
  const room = rooms.get(id);
  if (!room) throw new HttpError(404, "room_not_found");
  return room;
}

const mainOnly = (room: Room): Room => {
  if (room.kind !== "main") throw new HttpError(409, "demo_main_room_only");
  return room;
};

export function createApp({ config, rooms: singleRooms, chat: singleChat, spaces: spaceList, billing: billingDep, provisionSpace }: AppDeps) {
  // The hashed app bundle currently served (e.g. "index-0YX36Sc8.js"): lets installed apps notice a new version.
  const build = (() => {
    try {
      return /\/assets\/(index-[\w-]+\.js)/.exec(readFileSync(join(resolve(config.webDir), "index.html"), "utf8"))?.[1];
    } catch {
      return undefined;
    }
  })();
  const spaces: Space[] =
    spaceList ??
    (singleRooms ? [{ id: OWNER_TENANT, rooms: singleRooms, chat: singleChat ?? new EulerChatSender({}, singleRooms.main.runtime.repository) }] : []);
  if (!spaces.length) throw new Error("createApp needs rooms or spaces");
  const owner = spaces[0];
  const keys = accessKeys(config.accessToken, config.accessTokens, owner.id);
  // Team sessions are signed with a server secret (never sent to the browser).
  const sessionSecret = config.sessionSecret ?? (config.accessToken ? sessionCookieValue(`team:${config.accessToken}`) : randomUUID());
  const billing = billingDep ?? new BillingService({ store: new MemoryBillingStore() });
  const ctxFor = (s: Space) => ({ ...s, team: s.team ?? new TeamStore(s.id, s.rooms.main.runtime.repository, sessionSecret), history: new HistoryService(s.rooms.main.runtime.repository, s.rooms) });
  type SpaceCtx = ReturnType<typeof ctxFor>;
  const byId = new Map<string, SpaceCtx>(spaces.map((s) => [s.id, ctxFor(s)]));
  // Teams load once; auth waits for them so members are not logged out right after a restart.
  const teamsReady = Promise.all([...byId.values()].map((s) => s.team.init())).catch((e) => console.error("[novus] team load failed", e));
  /** A self-serve workspace's space, created at signup. */
  const addSpace = async (space: Space) => {
    const c = ctxFor(space);
    await c.team.init();
    byId.set(space.id, c);
    return c;
  };
  /** Founder session of a self-serve workspace: signed over its founder code hash. */
  const workspaceCookie = (id: string, codeHash: string) => `w.${id}.${createHmac("sha256", sessionSecret).update(`novus-ws-v1:${id}:${codeHash}`).digest("base64url")}`;

  /** Who is logged in and in which space (null: not logged in). */
  const whoIs = (req: Request): { space: SpaceCtx; principal: Principal } | null => {
    if (!keys.length) {
      const space = byId.get(owner.id)!;
      return { space, principal: { kind: "founder", spaceId: space.id } };
    }
    const key = authKey(req, keys);
    if (key) {
      // In single-space mode every key opens the owner's space.
      const space = spaceList ? byId.get(key.tenant) : byId.get(owner.id);
      return space ? { space, principal: { kind: "founder", spaceId: space.id } } : null;
    }
    const cookie = readCookie(req, AUTH_COOKIE);
    if (cookie?.startsWith("w.")) {
      const id = cookie.split(".")[1] ?? "";
      const ws = billing.workspace(id);
      const space = byId.get(id);
      if (ws?.founderCodeHash && space && safeEqual(cookie, workspaceCookie(id, ws.founderCodeHash))) return { space, principal: { kind: "founder", spaceId: id } };
      return null;
    }
    if (cookie?.startsWith("m.")) {
      const space = byId.get(cookie.split(".")[1] ?? "");
      const member = space?.team.memberFromCookie(cookie);
      if (space && member) return { space, principal: { kind: "member", spaceId: space.id, member } };
    }
    return null;
  };
  const ctx = (req: Request) => {
    const c = (req.res?.locals as { who?: ReturnType<typeof whoIs> } | undefined)?.who ?? whoIs(req);
    if (!c) throw new HttpError(401, "unauthorized");
    return c;
  };
  /** The space of the logged-in person. */
  const sp = (req: Request) => ctx(req).space;
  const principal = (req: Request) => ctx(req).principal;
  /** Refuse unless the logged-in person has this permission. */
  const need = (req: Request, perm: Permission) => {
    if (!can(principal(req), perm)) throw new HttpError(403, "forbidden");
  };
  /** The platform owner (the server's own APP_ACCESS_TOKEN): admin dashboards and config. */
  const isAdmin = (req: Request) => {
    const c = ctx(req);
    return c.principal.kind === "founder" && c.space.id === owner.id;
  };
  const adminOnly = (req: Request) => {
    if (!isAdmin(req)) throw new HttpError(403, "forbidden");
  };
  const founderOnly = (req: Request) => {
    if (principal(req).kind !== "founder") throw new HttpError(403, "forbidden");
  };
  /** The requested room, if this person may see it (a member can be limited to some streamers). */
  const roomIn = (req: Request): Room => {
    const room = roomOf(sp(req).rooms, req);
    if (room.kind === "tiktok" && !canSeeAccount(principal(req), room.username)) throw new HttpError(404, "room_not_found");
    return room;
  };
  const visibleRooms = (req: Request) => {
    const p = principal(req);
    return sp(req).rooms.summaries().filter((r) => r.kind !== "tiktok" || canSeeAccount(p, r.username));
  };
  const snapshotOf = (room: Room, req: Request) => ({ ...room.runtime.snapshot(), room: room.id, rooms: visibleRooms(req), build });
  /** Adding or removing followed accounts: needs "manage_accounts" over every streamer. */
  const needAllAccounts = (req: Request) => {
    need(req, "manage_accounts");
    const p = principal(req);
    if (p.kind === "member" && p.member.accounts) throw new HttpError(403, "forbidden");
  };
  /** Which permission a settings change needs (the language alone is free). */
  const checkSettingsPatch = (req: Request, patch: Partial<Settings>) => {
    const keys = Object.keys(patch) as (keyof Settings)[];
    const accountKeys: (keyof Settings)[] = ["tiktokProfiles", "tiktokGroups", "tiktokUsername"];
    if (keys.some((k) => accountKeys.includes(k))) needAllAccounts(req);
    if (patch.tiktokManual) {
      need(req, "manage_accounts");
      // A member limited to some streamers may only switch the mode of those.
      const p = principal(req);
      if (p.kind === "member" && p.member.accounts) {
        const before = new Set(sp(req).rooms.settings.tiktokManual ?? []);
        const after = new Set(patch.tiktokManual.map((u) => u.toLowerCase()));
        const changed = [...new Set([...before, ...after])].filter((u) => before.has(u) !== after.has(u));
        if (changed.some((u) => !canSeeAccount(p, u))) throw new HttpError(403, "forbidden");
      }
    }
    if (keys.some((k) => k !== "language" && k !== "tiktokManual" && !accountKeys.includes(k))) need(req, "settings");
  };
  /** A LIVE of the history, if this person may see its streamer (and it is within the plan's history window). */
  const historyDetail = async (req: Request, id: string) => {
    const detail = await sp(req).history.detail(id);
    if (!detail || !canSeeAccount(principal(req), detail.entry.account)) return null;
    if (detail.entry.startedAt < historyCutoff(req)) throw planLimit("history_retention");
    return detail;
  };
  const billingError = (e: unknown) => (e instanceof BillingError ? new HttpError(e.status, e.code) : e);
  /** 402 with the reason, so the app can show the right upgrade prompt. */
  const planLimit = (code: string) => new HttpError(402, code);
  const effective = (req: Request) => billing.effective(sp(req).id);
  /** Adding followed accounts beyond the plan's creator limit is refused (existing ones are kept). */
  const checkCreatorCount = (req: Request, next: number) => {
    const current = sp(req).rooms.settings.tiktokProfiles?.length ?? 0;
    if (next > current && next > effective(req).entitlements.creator_limit) throw planLimit(effective(req).access === "restricted" ? "workspace_restricted" : "plan_limit_creators");
  };
  /** An export (PDF, CSV, conversation): counted against the plan's monthly allowance. */
  const useExport = (req: Request) => {
    if (!billing.allowed(sp(req).id, "export")) throw planLimit("plan_limit_exports");
    billing.meterAdd(sp(req).id, "exports");
  };
  /** LIVEs older than the plan's history window are kept but not shown. */
  const historyCutoff = (req: Request) => Date.now() - effective(req).entitlements.history_retention_days * 24 * 3600 * 1000;
  const requestOrigin = (req: Request) => config.publicUrl ?? `${config.production ? "https" : req.protocol}://${req.get("host")}`;
  const teamError = (e: unknown) => (e instanceof TeamError ? new HttpError(e.status, e.code) : e);
  // The token-protected connector ingestion and /health belong to the owner's main room.
  const { runtime, tiktok } = owner.rooms.main;
  /** OAuth redirect back to this app: PUBLIC_URL when set, else the request's own origin. */
  const oauthRedirect = (req: Request) => {
    const origin = config.publicUrl ?? `${config.production ? "https" : req.protocol}://${req.get("host")}`;
    return `${origin}/api/chat-sender/callback`;
  };
  const chatError = (e: unknown) => (e instanceof ChatSendError ? new HttpError(e.status, e.code) : e);
  const timeZone = config.reportTimeZone ?? "Europe/Paris";
  let logo: Buffer | null | undefined;
  const reportLogo = () => {
    if (logo === undefined) {
      const file = join(resolve(config.webDir), "icons", "icon-192.png");
      logo = existsSync(file) ? readFileSync(file) : null;
    }
    return logo ?? undefined;
  };
  /** Language of an export: `?lang=` from the app, else the saved setting. */
  const langOf = (req: Request): "en" | "fr" => (req.query.lang === "fr" || req.query.lang === "en" ? req.query.lang : sp(req).rooms.settings.language);
  /** ASCII file name from a LIVE title and its start date. */
  const fileName = (title: string, startedAt: number, ext: string) => {
    const slug = title.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "live";
    return `novus-live-${slug}-${new Date(startedAt).toISOString().slice(0, 10)}.${ext}`;
  };
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(securityHeaders);

  // Stripe webhooks need the raw body for signature verification (before any JSON parser).
  app.post("/api/billing/webhook", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    billing
      .handleWebhook(req.body as Buffer, req.headers["stripe-signature"] as string | undefined)
      .then((r) => res.json({ received: true, duplicate: r.duplicate }))
      .catch((e) => {
        if (e instanceof BillingError) return res.status(e.status).json({ error: e.code });
        console.error("[billing] webhook failed", e);
        res.status(500).json({ error: "webhook_failed" });
      });
  });

  const api = express.Router();
  api.use(rateLimit("api", config.apiRateLimitPerMinute));
  api.use(requireJson);
  api.use(express.json({ limit: "64kb", strict: true }));

  // ---------------------------------------------------------------- public
  api.get("/health", h(() => ({ ok: true, build, session: runtime.session?.status ?? "idle", ai: runtime.aiQueue.status().state })));

  api.get(
    "/auth/status",
    h(async (req) => {
      await teamsReady;
      return { required: keys.length > 0, authenticated: Boolean(whoIs(req)) };
    }),
  );

  api.post(
    "/auth/login",
    rateLimit("login", 10),
    h(async (req, res) => {
      const { key } = parse(loginSchema, req.body);
      if (!keys.length) return { ok: true };
      await teamsReady;
      const matched = matchKey(key, keys);
      // A founder's code (server or self-serve workspace), or a team member's own code.
      let value = matched ? sessionCookieValue(matched.key) : undefined;
      if (!value) {
        const ws = billing.findByFounderCode(key);
        if (ws?.founderCodeHash && byId.has(ws.id)) value = workspaceCookie(ws.id, ws.founderCodeHash);
      }
      if (!value) {
        for (const s of byId.values()) {
          const member = s.team.findByCode(key);
          if (member) value = s.team.cookieFor(member);
        }
      }
      if (!value) throw new HttpError(401, "invalid_key");
      res.cookie(AUTH_COOKIE, value, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.production,
        maxAge: 30 * 24 * 3600 * 1000,
        path: "/",
      });
      return { ok: true };
    }),
  );

  api.post(
    "/auth/logout",
    h((_req, res) => {
      res.clearCookie(AUTH_COOKIE, { path: "/" });
      return { ok: true };
    }),
  );

  // OAuth return from Euler/TikTok. Public on purpose: the browser comes back from another
  // site, so the SameSite=Strict login cookie is absent. It is protected by the one-time,
  // unguessable `state` that only an authenticated /chat-sender/connect call can create.
  api.get("/chat-sender/callback", rateLimit("oauth", 20), async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code.slice(0, 2000) : "";
    const state = typeof req.query.state === "string" ? req.query.state.slice(0, 200) : "";
    let result = "connected";
    if (!code || !state) result = typeof req.query.error === "string" ? "denied" : "failed";
    else {
      try {
        // The one-time state tells which space started this connection.
        const space = spaces.find((x) => x.chat.hasState(state));
        if (!space) throw new ChatSendError("chat_session_expired", 400);
        await space.chat.complete(code, state);
      } catch (e) {
        console.warn(`[chat] OAuth callback failed: ${e instanceof Error ? e.message : e}`);
        result = e instanceof ChatSendError && e.code === "chat_session_expired" ? "expired" : "failed";
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(303, `/?chat=${result}`);
  });

  // ---------------------------------------------------------------- public billing (pricing page, signup)
  api.get("/billing/plans", h(() => billing.publicPricing()));
  api.post(
    "/billing/track",
    rateLimit("track", 120),
    h((req) => {
      const ev = parse(trackSchema, req.body);
      billing.track({ ...ev, workspaceId: whoIs(req)?.space.id });
      return { ok: true };
    }),
  );
  api.post(
    "/billing/signup",
    rateLimit("signup", 3),
    h(async (req, res) => {
      const input = parse(signupSchema, req.body);
      if (!provisionSpace || !billing.stripeEnabled) throw new HttpError(503, "billing_not_configured");
      if (input.founding && !(input.plan === "agency" && input.cycle === "month" && billing.foundingAvailable())) throw new HttpError(409, "founding_sold_out");
      let created;
      try {
        created = await billing.signup({ name: input.name, email: input.email, plan: input.plan });
      } catch (e) {
        throw billingError(e);
      }
      await addSpace(await provisionSpace(created.workspace.id));
      // Logged in right away as the founder; the code is shown once so they can log in elsewhere.
      res.cookie(AUTH_COOKIE, workspaceCookie(created.workspace.id, created.workspace.founderCodeHash!), { httpOnly: true, sameSite: "strict", secure: config.production, maxAge: 30 * 24 * 3600 * 1000, path: "/" });
      let url: string | undefined;
      try {
        url = (await billing.startCheckout(created.workspace.id, { plan: input.plan, cycle: input.cycle, founding: input.founding, origin: requestOrigin(req), source: input.source, anonId: input.anonId })).url;
      } catch (e) {
        throw billingError(e);
      }
      return { workspaceId: created.workspace.id, code: created.code, checkoutUrl: url };
    }),
  );
  api.post(
    "/billing/lead",
    rateLimit("lead", 3),
    h((req) => {
      const lead = parse(leadSchema, req.body);
      console.log(`[billing] enterprise lead from ${lead.company} (${lead.creators} creators)`);
      void billing.recordLead(lead);
      return { ok: true };
    }),
  );

  // ---------------------------------------------------------------- connector ingestion (token-protected)
  const ingest = express.Router();
  ingest.use(rateLimit("ingest", config.ingestRateLimitPerMinute));
  ingest.use((req, _res, next) => {
    if (!config.ingestToken) return next(new HttpError(503, "ingest_disabled"));
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !safeEqual(token, config.ingestToken)) return next(new HttpError(401, "invalid_ingest_token"));
    next();
  });
  ingest.post(
    "/events",
    h(async (req) => {
      const platformHeader = String(req.headers["x-novus-platform"] ?? "tiktok");
      const platform = platformHeader === "external" ? "external" : "tiktok";
      let body;
      try {
        body = parse(ingestBatchSchema, req.body);
      } catch (err) {
        if (platform === "tiktok") tiktok.fail("Connector sent invalid events");
        throw err;
      }
      const now = Date.now();
      const events = body.events.map((e) => ({
        ...e,
        id: e.id ? `${platform}:${e.id}` : `${platform}:${randomUUID()}`,
        // Never trust far-future/past timestamps from a connector.
        timestamp: e.timestamp && Math.abs(e.timestamp - now) < 10 * 60_000 ? e.timestamp : now,
      })) as unknown as LiveEvent[];
      const accepted = await runtime.ingestExternal(events, platform);
      return { accepted };
    }),
  );
  ingest.post(
    "/heartbeat",
    h(() => {
      tiktok.noteHeartbeat();
      return { ok: true, state: tiktok.state() };
    }),
  );
  api.use("/ingest", ingest);

  // ---------------------------------------------------------------- authenticated app API
  api.use((req, res, next) => {
    void teamsReady.then(() => {
      const who = whoIs(req);
      if (!who) return next(new HttpError(401, "unauthorized"));
      res.locals.who = who;
      next();
    });
  });

  // ---------------------------------------------------------------- who am I & team
  api.get(
    "/auth/me",
    h((req): Me => {
      const p = principal(req);
      return p.kind === "founder"
        ? { kind: "founder", teamEnabled: keys.length > 0, permissions: [...PERMISSIONS], accounts: null, admin: isAdmin(req) }
        : { kind: "member", teamEnabled: true, member: p.member, permissions: p.member.permissions, accounts: p.member.accounts };
    }),
  );
  const needTeam = (req: Request) => {
    if (!keys.length) throw new HttpError(409, "team_requires_access_code");
    need(req, "team");
  };
  api.get(
    "/team",
    h((req) => {
      needTeam(req);
      return { members: sp(req).team.list() };
    }),
  );
  api.post(
    "/team",
    h(async (req) => {
      needTeam(req);
      const input = parse(memberCreateSchema, req.body);
      const seats = sp(req).team.list().filter((m) => !m.disabled).length;
      if (seats >= effective(req).entitlements.team_seat_limit) throw planLimit("plan_limit_seats");
      try {
        return await sp(req).team.create(principal(req), input as MemberInput);
      } catch (e) {
        throw teamError(e);
      }
    }),
  );
  api.patch(
    "/team/:id",
    h(async (req) => {
      needTeam(req);
      const patch = parse(memberUpdateSchema, req.body);
      try {
        return { member: await sp(req).team.update(principal(req), param(req, "id"), patch as Partial<MemberInput>) };
      } catch (e) {
        throw teamError(e);
      }
    }),
  );
  api.post(
    "/team/:id/code",
    h(async (req) => {
      needTeam(req);
      try {
        return await sp(req).team.regenerate(principal(req), param(req, "id"));
      } catch (e) {
        throw teamError(e);
      }
    }),
  );
  api.delete(
    "/team/:id",
    h(async (req) => {
      needTeam(req);
      try {
        await sp(req).team.remove(principal(req), param(req, "id"));
        return { ok: true };
      } catch (e) {
        throw teamError(e);
      }
    }),
  );

  // ---------------------------------------------------------------- billing (customer)
  api.get(
    "/billing/me",
    h((req) => {
      const space = sp(req);
      const p = principal(req);
      return billing.me(space.id, { creators: space.rooms.settings.tiktokProfiles?.length ?? 0, seats: space.team.list().filter((m) => !m.disabled).length, isFounder: p.kind === "founder" });
    }),
  );
  api.post(
    "/billing/checkout",
    h(async (req) => {
      founderOnly(req);
      const input = parse(checkoutSchema, req.body);
      try {
        return await billing.startCheckout(sp(req).id, { ...input, origin: requestOrigin(req) });
      } catch (e) {
        throw billingError(e);
      }
    }),
  );
  api.post(
    "/billing/portal",
    h(async (req) => {
      founderOnly(req);
      try {
        return await billing.portal(sp(req).id, `${requestOrigin(req)}/?view=billing`);
      } catch (e) {
        throw billingError(e);
      }
    }),
  );
  api.post(
    "/billing/change-plan",
    h(async (req) => {
      founderOnly(req);
      const { plan, cycle } = parse(changePlanSchema, req.body);
      try {
        await billing.changePlan(sp(req).id, plan, cycle);
      } catch (e) {
        throw billingError(e);
      }
      return { ok: true };
    }),
  );

  // ---------------------------------------------------------------- admin (platform owner only)
  api.get(
    "/admin/overview",
    h(async (req) => {
      adminOnly(req);
      const sizes = (id: string) => {
        const s = byId.get(id);
        return { creators: s?.rooms.settings.tiktokProfiles?.length ?? 0, seats: s?.team.list().filter((m) => !m.disabled).length ?? 0 };
      };
      const economics = workspaceEconomics(billing, sizes);
      const events = await billing.events(Date.now() - 200 * 24 * 3600 * 1000);
      return {
        metrics: saasMetrics(billing, economics, events),
        workspaces: economics,
        funnel: funnel(billing, events.filter((e) => e.at >= Date.now() - 30 * 24 * 3600 * 1000)),
        leads: events.filter((e) => e.type === "enterprise_lead_detail").slice(-50).reverse().map((e) => ({ at: e.at, ...e.meta })),
        stripe: billing.stripeEnabled,
      };
    }),
  );
  api.get(
    "/admin/config",
    h((req) => {
      adminOnly(req);
      return billing.config;
    }),
  );
  api.put(
    "/admin/config",
    h(async (req) => {
      adminOnly(req);
      const patch = parse(adminConfigSchema, req.body);
      return billing.updateConfig(patch);
    }),
  );

  api.get("/state", h((req) => snapshotOf(roomIn(req), req)));

  api.get("/stream", (req, res, next) => {
    try {
      const room = roomIn(req);
      room.hub.addClient(res, snapshotOf(room, req));
    } catch (err) {
      next(err);
    }
  });

  api.post(
    "/demo/start",
    h(async (req) => {
      const { speed } = parse(demoStartSchema, req.body);
      const session = await mainOnly(roomIn(req)).runtime.startDemo((speed ?? 1) as DemoSpeed);
      return { session };
    }),
  );
  api.post(
    "/demo/speed",
    h((req) => {
      const { speed } = parse(demoSpeedSchema, req.body);
      mainOnly(roomIn(req)).runtime.setDemoSpeed(speed as DemoSpeed);
      return { ok: true };
    }),
  );
  api.post(
    "/session/end",
    h(async (req) => {
      need(req, roomIn(req).kind === "tiktok" ? "manage_accounts" : "moderate");
      const { runtime } = roomIn(req);
      const report = await runtime.endSession();
      return { session: runtime.session, report };
    }),
  );

  api.get(
    "/alerts",
    h((req) => ({ alerts: roomIn(req).runtime.sortedAlerts() })),
  );
  api.post(
    "/alerts/:id/action",
    h(async (req) => {
      need(req, "moderate");
      const { runtime } = roomIn(req);
      const { action, note } = parse(actionRequestSchema, req.body);
      const out = await runtime.actOnAlert(param(req, "id"), action as ActionType, note);
      if (!out) throw new HttpError(404, "alert_not_found");
      return out;
    }),
  );
  api.post(
    "/actions/:id/confirm",
    h((req) => {
      need(req, "moderate");
      const record = roomIn(req).runtime.confirmManualAction(param(req, "id"));
      if (!record) throw new HttpError(404, "manual_action_not_found");
      return { record };
    }),
  );

  // ---------------------------------------------------------------- "Send in chat" (Euler OAuth, one tap per message)
  api.get("/chat-sender", h((req) => sp(req).chat.status()));
  api.post(
    "/chat-sender/connect",
    h((req) => {
      founderOnly(req);
      try {
        return { url: sp(req).chat.authorizeUrl(oauthRedirect(req)).url };
      } catch (e) {
        throw chatError(e);
      }
    }),
  );
  api.post(
    "/chat-sender/disconnect",
    h(async (req) => {
      founderOnly(req);
      const { chat } = sp(req);
      await chat.disconnect();
      return chat.status();
    }),
  );
  api.post(
    "/actions/:id/send-chat",
    rateLimit("chat", 30),
    h(async (req) => {
      need(req, "send_chat");
      const room = roomIn(req);
      const { text } = parse(sendChatSchema, req.body);
      const id = param(req, "id");
      if (!room.runtime.manualAction(id)) throw new HttpError(404, "manual_action_not_found");
      const roomId = room.liveRoomId?.();
      if (!roomId) throw new HttpError(409, "chat_not_live");
      try {
        await sp(req).chat.send(roomId, text);
        billing.meterAdd(sp(req).id, "chat_messages_sent");
      } catch (e) {
        throw chatError(e);
      }
      return { record: room.runtime.markSentToChat(id) };
    }),
  );

  api.get(
    "/viewers",
    h((req) => {
      const q = typeof req.query.q === "string" ? req.query.q.slice(0, 64) : undefined;
      const sort = ["risk", "messages", "recent"].includes(String(req.query.sort)) ? (req.query.sort as "risk") : "risk";
      const filter = ["trusted", "watchlist", "ignored", "flagged", "all"].includes(String(req.query.filter)) ? (req.query.filter as "all") : "all";
      return { viewers: roomIn(req).runtime.viewerList({ q, sort, filter }) };
    }),
  );
  api.get(
    "/viewers/:id",
    h((req) => {
      const { runtime } = roomIn(req);
      const id = param(req, "id");
      const profile = runtime.viewerProfile(id);
      if (!profile) throw new HttpError(404, "viewer_not_found");
      return { profile, alerts: runtime.viewerAlerts(id) };
    }),
  );
  api.post(
    "/viewers/:id/flag",
    h(async (req) => {
      need(req, "moderate");
      const { flag } = parse(flagRequestSchema, req.body);
      const profile = await roomIn(req).runtime.setViewerFlag(param(req, "id"), flag as ViewerFlag | null);
      if (!profile) throw new HttpError(404, "viewer_not_found");
      return { profile };
    }),
  );
  api.post(
    "/viewers/:id/action",
    h(async (req) => {
      need(req, "moderate");
      const { runtime } = roomIn(req);
      const { action, note } = parse(actionRequestSchema, req.body);
      const record = await runtime.actOnViewer(param(req, "id"), action as ActionType, note);
      if (!record) throw new HttpError(404, "viewer_not_found");
      return { record, profile: runtime.viewerProfile(param(req, "id")) };
    }),
  );

  api.get("/assistant/pulse", h((req) => roomIn(req).runtime.pulse()));
  api.post(
    "/assistant/catchup",
    h(async (req) => {
      const { runtime } = roomIn(req);
      const { since, lang } = parse(catchUpRequestSchema, req.body);
      const fallback = runtime.session?.startedAt ?? Date.now() - 10 * 60_000;
      return runtime.catchUp(since ?? fallback, lang ?? sp(req).rooms.settings.language);
    }),
  );
  api.post(
    "/assistant/questions/:id/answered",
    h((req) => {
      need(req, "moderate");
      const answered = req.body?.answered !== false;
      if (!roomIn(req).runtime.markQuestionAnswered(param(req, "id"), answered)) throw new HttpError(404, "question_not_found");
      return { ok: true };
    }),
  );

  api.get("/analytics", h((req) => roomIn(req).runtime.analyticsSummary()));
  api.get("/report", h((req) => roomIn(req).runtime.report()));

  api.get("/settings", h((req) => sp(req).rooms.settings));
  api.put(
    "/settings",
    h(async (req) => {
      const patch = parse(settingsPatchSchema, req.body) as Partial<Settings>;
      checkSettingsPatch(req, patch);
      if (patch.tiktokProfiles) checkCreatorCount(req, patch.tiktokProfiles.length);
      return sp(req).rooms.updateSettings(patch);
    }),
  );

  api.get("/rooms", h((req) => ({ rooms: visibleRooms(req) })));
  // Start / stop recording the LIVE of a followed account (manual mode, or stopping early).
  api.post(
    "/rooms/recording",
    h(async (req) => {
      need(req, "manage_accounts");
      const { action } = parse(recordingSchema, req.body);
      const { rooms } = sp(req);
      const room = roomIn(req);
      if (!room.setRecording) throw new HttpError(409, "not_a_followed_account");
      try {
        await room.setRecording(action === "start");
      } catch (e) {
        if (e instanceof RecordingError) throw new HttpError(409, e.message);
        throw e;
      }
      rooms.broadcastSummaries(true);
      return { session: room.runtime.session, rooms: rooms.summaries() };
    }),
  );

  // ---------------------------------------------------------------- LIVE history & exports
  api.get(
    "/history",
    h(async (req) => {
      need(req, "history");
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
      const cutoff = historyCutoff(req);
      const entries = await sp(req).history.list(limit, roomIn(req));
      return { entries: entries.filter((e) => e.status === "live" || e.startedAt >= cutoff), hiddenOlder: entries.some((e) => e.status !== "live" && e.startedAt < cutoff) };
    }),
  );
  api.get(
    "/history/:id",
    h(async (req) => {
      need(req, "history");
      const detail = await historyDetail(req, param(req, "id"));
      if (!detail) throw new HttpError(404, "session_not_found");
      return detail;
    }),
  );
  api.get(
    "/history/:id/messages.csv",
    h(async (req, res) => {
      need(req, "history");
      const id = param(req, "id");
      const detail = await historyDetail(req, id);
      if (!detail) throw new HttpError(404, "session_not_found");
      useExport(req);
      const csv = chatCsv(await sp(req).history.chat(id), timeZone, langOf(req));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName(detail.entry.title, detail.entry.startedAt, "csv")}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    }),
  );
  // The whole conversation of a LIVE: plain text (keeps emoji) or PDF.
  api.get(
    "/history/:id/chat.txt",
    h(async (req, res) => {
      need(req, "history");
      const id = param(req, "id");
      const detail = await historyDetail(req, id);
      if (!detail) throw new HttpError(404, "session_not_found");
      useExport(req);
      const txt = chatTxt(detail.entry, await sp(req).history.chat(id), timeZone, langOf(req));
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName(`${detail.entry.title}-chat`, detail.entry.startedAt, "txt")}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(txt);
    }),
  );
  api.get(
    "/history/:id/chat.pdf",
    rateLimit("pdf-chat", 20),
    h(async (req, res) => {
      need(req, "history");
      const id = param(req, "id");
      const detail = await historyDetail(req, id);
      if (!detail) throw new HttpError(404, "session_not_found");
      useExport(req);
      const pdf = await buildReportPdf({
        entry: detail.entry,
        analytics: detail.analytics,
        chat: await sp(req).history.chat(id),
        lang: langOf(req),
        timeZone,
        logo: reportLogo(),
        kind: "transcript",
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName(`${detail.entry.title}-chat`, detail.entry.startedAt, "pdf")}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(pdf);
    }),
  );
  api.get(
    "/history/:id/report.pdf",
    rateLimit("pdf", 20),
    h(async (req, res) => {
      need(req, "history");
      const id = param(req, "id");
      const detail = await historyDetail(req, id);
      if (!detail) throw new HttpError(404, "session_not_found");
      useExport(req);
      const pdf = await buildReportPdf({
        entry: detail.entry,
        analytics: detail.analytics,
        chat: await sp(req).history.chat(id),
        lang: langOf(req),
        timeZone,
        logo: reportLogo(),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName(detail.entry.title, detail.entry.startedAt, "pdf")}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(pdf);
    }),
  );

  api.get("/integrations/tiktok", h((req) => roomIn(req).tiktok.status()));
  api.post(
    "/integrations/tiktok/connect",
    h(async (req) => {
      needAllAccounts(req);
      // Adds the account to the followed profiles; it gets its own room, watched alongside the others.
      const { rooms } = sp(req);
      const { tiktok } = rooms.main;
      const username = parse(tiktokConnectSchema, req.body).username.replace(/^@/, "");
      const profiles = rooms.settings.tiktokProfiles ?? [];
      if (!profiles.some((p) => p.toLowerCase() === username.toLowerCase())) checkCreatorCount(req, profiles.length + 1);
      if (!profiles.some((p) => p.toLowerCase() === username.toLowerCase())) await rooms.updateSettings({ tiktokProfiles: [...profiles, username].slice(-MAX_PROFILES) });
      const room = rooms.get(tiktokRoomId(username));
      if (room) return { ...room.tiktok.status(), room: room.id };
      // No live connector configured: the main room's connector follows this account instead.
      await tiktok.connect(username);
      rooms.main.hub.pushExtras({ tiktok: tiktok.status() });
      return { ...tiktok.status(), room: MAIN_ROOM };
    }),
  );
  api.post(
    "/integrations/tiktok/disconnect",
    h(async (req) => {
      needAllAccounts(req);
      const { rooms } = sp(req);
      const { tiktok } = rooms.main;
      const room = roomOf(rooms, req);
      if (room.kind === "tiktok" && room.username) {
        const name = room.username.toLowerCase();
        await rooms.updateSettings({ tiktokProfiles: (rooms.settings.tiktokProfiles ?? []).filter((p) => p.toLowerCase() !== name) });
        return { ...tiktok.status(), room: MAIN_ROOM };
      }
      await tiktok.disconnect();
      rooms.main.hub.pushExtras({ tiktok: tiktok.status() });
      return { ...tiktok.status(), room: MAIN_ROOM };
    }),
  );

  api.use((_req, _res, next) => next(new HttpError(404, "not_found")));

  app.use("/api", api);

  // ---------------------------------------------------------------- static PWA
  const webDir = resolve(config.webDir);
  if (existsSync(webDir)) {
    app.use(
      express.static(webDir, {
        index: false,
        setHeaders(res, path) {
          if (path.includes(`${join("assets", "")}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          else res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(join(webDir, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, details: err.details });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.parse.failed" || e?.type === "entity.too.large") {
      res.status(e.status ?? 400).json({ error: e.type === "entity.too.large" ? "payload_too_large" : "invalid_json" });
      return;
    }
    console.error("[novus] unhandled error", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
