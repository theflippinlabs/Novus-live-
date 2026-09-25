import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import {
  actionRequestSchema,
  catchUpRequestSchema,
  demoSpeedSchema,
  demoStartSchema,
  flagRequestSchema,
  ingestBatchSchema,
  loginSchema,
  settingsPatchSchema,
  tiktokConnectSchema,
} from "../shared/schemas";
import type { ActionType, DemoSpeed, LiveEvent, Settings, ViewerFlag } from "../shared/types";
import type { Config } from "./config";
import { MAIN_ROOM, tiktokRoomId, type Room, type RoomRegistry } from "./core/Rooms";
import { chatCsv, HistoryService } from "./history/History";
import { buildReportPdf } from "./reports/pdf";
import { AUTH_COOKIE, isAuthenticated, rateLimit, requireJson, safeEqual, securityHeaders, sessionCookieValue } from "./http/security";

export interface AppDeps {
  config: Pick<Config, "accessToken" | "ingestToken" | "production" | "webDir" | "trustProxy" | "apiRateLimitPerMinute" | "ingestRateLimitPerMinute"> &
    Partial<Pick<Config, "reportTimeZone">>;
  rooms: RoomRegistry;
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

export function createApp({ config, rooms }: AppDeps) {
  const snapshotOf = (room: Room) => ({ ...room.runtime.snapshot(), room: room.id, rooms: rooms.summaries() });
  const { runtime, tiktok } = rooms.main;
  const history = new HistoryService(runtime.repository, rooms);
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
  const langOf = (req: Request): "en" | "fr" => (req.query.lang === "fr" || req.query.lang === "en" ? req.query.lang : rooms.settings.language);
  /** ASCII file name from a LIVE title and its start date. */
  const fileName = (title: string, startedAt: number, ext: string) => {
    const slug = title.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "live";
    return `novus-live-${slug}-${new Date(startedAt).toISOString().slice(0, 10)}.${ext}`;
  };
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(securityHeaders);

  const api = express.Router();
  api.use(rateLimit("api", config.apiRateLimitPerMinute));
  api.use(requireJson);
  api.use(express.json({ limit: "64kb", strict: true }));

  // ---------------------------------------------------------------- public
  api.get("/health", h(() => ({ ok: true, session: runtime.session?.status ?? "idle", ai: runtime.aiQueue.status().state })));

  api.get("/auth/status", h((req) => ({ required: Boolean(config.accessToken), authenticated: isAuthenticated(req, config.accessToken) })));

  api.post(
    "/auth/login",
    rateLimit("login", 10),
    h((req, res) => {
      const { key } = parse(loginSchema, req.body);
      if (!config.accessToken) return { ok: true };
      if (!safeEqual(key, config.accessToken)) throw new HttpError(401, "invalid_key");
      res.cookie(AUTH_COOKIE, sessionCookieValue(config.accessToken), {
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
  api.use((req, _res, next) => {
    if (!isAuthenticated(req, config.accessToken)) return next(new HttpError(401, "unauthorized"));
    next();
  });

  api.get("/state", h((req) => snapshotOf(roomOf(rooms, req))));

  api.get("/stream", (req, res, next) => {
    try {
      const room = roomOf(rooms, req);
      room.hub.addClient(res, snapshotOf(room));
    } catch (err) {
      next(err);
    }
  });

  api.post(
    "/demo/start",
    h(async (req) => {
      const { speed } = parse(demoStartSchema, req.body);
      const session = await mainOnly(roomOf(rooms, req)).runtime.startDemo((speed ?? 1) as DemoSpeed);
      return { session };
    }),
  );
  api.post(
    "/demo/speed",
    h((req) => {
      const { speed } = parse(demoSpeedSchema, req.body);
      mainOnly(roomOf(rooms, req)).runtime.setDemoSpeed(speed as DemoSpeed);
      return { ok: true };
    }),
  );
  api.post(
    "/session/end",
    h(async (req) => {
      const { runtime } = roomOf(rooms, req);
      const report = await runtime.endSession();
      return { session: runtime.session, report };
    }),
  );

  api.get(
    "/alerts",
    h((req) => ({ alerts: roomOf(rooms, req).runtime.sortedAlerts() })),
  );
  api.post(
    "/alerts/:id/action",
    h(async (req) => {
      const { runtime } = roomOf(rooms, req);
      const { action, note } = parse(actionRequestSchema, req.body);
      const out = await runtime.actOnAlert(param(req, "id"), action as ActionType, note);
      if (!out) throw new HttpError(404, "alert_not_found");
      return out;
    }),
  );
  api.post(
    "/actions/:id/confirm",
    h((req) => {
      const record = roomOf(rooms, req).runtime.confirmManualAction(param(req, "id"));
      if (!record) throw new HttpError(404, "manual_action_not_found");
      return { record };
    }),
  );

  api.get(
    "/viewers",
    h((req) => {
      const q = typeof req.query.q === "string" ? req.query.q.slice(0, 64) : undefined;
      const sort = ["risk", "messages", "recent"].includes(String(req.query.sort)) ? (req.query.sort as "risk") : "risk";
      const filter = ["trusted", "watchlist", "ignored", "flagged", "all"].includes(String(req.query.filter)) ? (req.query.filter as "all") : "all";
      return { viewers: roomOf(rooms, req).runtime.viewerList({ q, sort, filter }) };
    }),
  );
  api.get(
    "/viewers/:id",
    h((req) => {
      const { runtime } = roomOf(rooms, req);
      const id = param(req, "id");
      const profile = runtime.viewerProfile(id);
      if (!profile) throw new HttpError(404, "viewer_not_found");
      return { profile, alerts: runtime.viewerAlerts(id) };
    }),
  );
  api.post(
    "/viewers/:id/flag",
    h(async (req) => {
      const { flag } = parse(flagRequestSchema, req.body);
      const profile = await roomOf(rooms, req).runtime.setViewerFlag(param(req, "id"), flag as ViewerFlag | null);
      if (!profile) throw new HttpError(404, "viewer_not_found");
      return { profile };
    }),
  );
  api.post(
    "/viewers/:id/action",
    h(async (req) => {
      const { runtime } = roomOf(rooms, req);
      const { action, note } = parse(actionRequestSchema, req.body);
      const record = await runtime.actOnViewer(param(req, "id"), action as ActionType, note);
      if (!record) throw new HttpError(404, "viewer_not_found");
      return { record, profile: runtime.viewerProfile(param(req, "id")) };
    }),
  );

  api.get("/assistant/pulse", h((req) => roomOf(rooms, req).runtime.pulse()));
  api.post(
    "/assistant/catchup",
    h(async (req) => {
      const { runtime } = roomOf(rooms, req);
      const { since, lang } = parse(catchUpRequestSchema, req.body);
      const fallback = runtime.session?.startedAt ?? Date.now() - 10 * 60_000;
      return runtime.catchUp(since ?? fallback, lang ?? rooms.settings.language);
    }),
  );
  api.post(
    "/assistant/questions/:id/answered",
    h((req) => {
      const answered = req.body?.answered !== false;
      if (!roomOf(rooms, req).runtime.markQuestionAnswered(param(req, "id"), answered)) throw new HttpError(404, "question_not_found");
      return { ok: true };
    }),
  );

  api.get("/analytics", h((req) => roomOf(rooms, req).runtime.analyticsSummary()));
  api.get("/report", h((req) => roomOf(rooms, req).runtime.report()));

  api.get("/settings", h(() => rooms.settings));
  api.put(
    "/settings",
    h(async (req) => {
      const patch = parse(settingsPatchSchema, req.body) as Partial<Settings>;
      return rooms.updateSettings(patch);
    }),
  );

  api.get("/rooms", h(() => ({ rooms: rooms.summaries() })));

  // ---------------------------------------------------------------- LIVE history & exports
  api.get(
    "/history",
    h(async (req) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
      return { entries: await history.list(limit) };
    }),
  );
  api.get(
    "/history/:id",
    h(async (req) => {
      const detail = await history.detail(param(req, "id"));
      if (!detail) throw new HttpError(404, "session_not_found");
      return detail;
    }),
  );
  api.get(
    "/history/:id/messages.csv",
    h(async (req, res) => {
      const id = param(req, "id");
      const detail = await history.detail(id);
      if (!detail) throw new HttpError(404, "session_not_found");
      const csv = chatCsv(await history.chat(id), timeZone, langOf(req));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName(detail.entry.title, detail.entry.startedAt, "csv")}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    }),
  );
  api.get(
    "/history/:id/report.pdf",
    rateLimit("pdf", 20),
    h(async (req, res) => {
      const id = param(req, "id");
      const detail = await history.detail(id);
      if (!detail) throw new HttpError(404, "session_not_found");
      const pdf = await buildReportPdf({
        entry: detail.entry,
        analytics: detail.analytics,
        chat: await history.chat(id),
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

  api.get("/integrations/tiktok", h((req) => roomOf(rooms, req).tiktok.status()));
  api.post(
    "/integrations/tiktok/connect",
    h(async (req) => {
      // Adds the account to the followed profiles; it gets its own room, watched alongside the others.
      const username = parse(tiktokConnectSchema, req.body).username.replace(/^@/, "");
      const profiles = rooms.settings.tiktokProfiles ?? [];
      if (!profiles.some((p) => p.toLowerCase() === username.toLowerCase())) await rooms.updateSettings({ tiktokProfiles: [...profiles, username].slice(-20) });
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
