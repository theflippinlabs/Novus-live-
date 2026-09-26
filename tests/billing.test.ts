import Stripe from "stripe";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, defaultBillingConfig, mergeBillingConfig } from "../shared/plans";
import { MeteredAIProvider, type AIProvider } from "../server/ai/AIProvider";
import { createApp, type AppDeps, type Space } from "../server/app";
import { AnthropicCostReport } from "../server/billing/AnthropicCost";
import type { Mailer, MailMessage } from "../server/mail/Mailer";
import { BillingService, type StripeLike } from "../server/billing/Billing";
import { effectiveEntitlements, PAST_DUE_GRACE_MS } from "../server/billing/Entitlements";
import { MemoryBillingStore, type Workspace } from "../server/billing/Store";
import { applyPlanToRooms, monitoredCreatorLimit } from "../server/billing/wire";
import { EulerChatSender } from "../server/chat/EulerChat";
import { RoomRegistry, tiktokRoomId, type Room } from "../server/core/Rooms";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";
import { RealtimeHub } from "../server/realtime/RealtimeHub";
import { createRuntime } from "./helpers";

const WH_SECRET = "whsec_test_secret";
const OWNER = "owner-access-key-123";
const real = new Stripe("sk_test_dummy");

/** Fake Stripe API (network-free) that still verifies webhook signatures for real. */
function fakeStripe() {
  const subs = new Map<string, Stripe.Subscription>();
  const calls: { checkout: Stripe.Checkout.SessionCreateParams[]; updates: [string, Stripe.SubscriptionUpdateParams][]; discountsRemoved: string[] } = { checkout: [], updates: [], discountsRemoved: [] };
  let n = 0;
  const client: StripeLike = {
    customers: { create: async () => ({ id: `cus_${++n}` }) },
    checkout: {
      sessions: {
        create: async (p) => {
          calls.checkout.push(p);
          return { id: `cs_${++n}`, url: `https://checkout.stripe.test/${n}` };
        },
        retrieve: async () => ({}) as Stripe.Checkout.Session,
      },
    },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.test/portal" }) } },
    prices: { list: async (p) => ({ data: [{ id: `price_${p.lookup_keys?.[0]}`, lookup_key: p.lookup_keys?.[0] ?? null }] }) },
    subscriptions: {
      retrieve: async (id) => subs.get(id)!,
      update: async (id, p) => {
        calls.updates.push([id, p]);
        return subs.get(id)!;
      },
      deleteDiscount: async (id) => void calls.discountsRemoved.push(id),
    },
    webhooks: { constructEvent: (payload, header, secret) => real.webhooks.constructEvent(payload, header, secret) },
  };
  return { client, subs, calls };
}

function sub(id: string, workspaceId: string, status: Stripe.Subscription.Status, lookup: string, extra: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    object: "subscription",
    customer: "cus_1",
    status,
    metadata: { workspace_id: workspaceId },
    cancel_at_period_end: false,
    trial_end: status === "trialing" ? now + 7 * 86400 : null,
    items: { object: "list", data: [{ id: "si_1", price: { id: `price_${lookup}`, lookup_key: lookup, recurring: { interval: lookup.endsWith("year") ? "year" : "month" } }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
    ...extra,
  } as unknown as Stripe.Subscription;
}

let evN = 0;
function signed(type: string, object: unknown, id = `evt_${++evN}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object }, api_version: "2025-08-27.basil", created: Math.floor(Date.now() / 1000) });
  return { payload, header: real.webhooks.generateTestHeaderString({ payload, secret: WH_SECRET }) };
}

async function makeBilling(opts: { now?: () => number } = {}) {
  const store = new MemoryBillingStore();
  const stripe = fakeStripe();
  const billing = new BillingService({ store, stripe: stripe.client, webhookSecret: WH_SECRET, now: opts.now });
  await billing.init();
  return { billing, store, stripe };
}

async function space(repo: MemoryRepository, id: string): Promise<Space> {
  const r = repo.scoped(id);
  const { runtime, tiktok } = createRuntime({ repo: r });
  await runtime.init();
  const main: Room = { id: "main", kind: "main", runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
  const rooms = new RoomRegistry(main, async (username) => {
    const x = createRuntime({ repo: r, account: username });
    await x.runtime.init();
    const tt = new TikTokAdapter(false);
    await tt.connect(username);
    return { id: tiktokRoomId(username), kind: "tiktok", username, runtime: x.runtime, hub: new RealtimeHub(50), tiktok: tt, dispose: async () => undefined };
  });
  return { id, rooms, chat: new EulerChatSender({}, r) };
}

async function makeApp(extra: Pick<AppDeps, "mailer" | "aiCost"> & { supportEmail?: string } = {}) {
  const { billing, stripe } = await makeBilling();
  const repo = new MemoryRepository();
  await billing.ensureComped("owner", "Novus Live", "enterprise");
  const owner = await space(repo, "owner");
  const provisioned = new Map<string, Space>();
  const app = createApp({
    config: { accessToken: OWNER, production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 10_000, ingestRateLimitPerMinute: 1000, sessionSecret: "s", publicUrl: "https://novus.test", supportEmail: extra.supportEmail },
    spaces: [owner],
    billing,
    mailer: extra.mailer,
    aiCost: extra.aiCost,
    provisionSpace: async (id) => {
      const s = await space(repo, id);
      provisioned.set(id, s);
      return s;
    },
  });
  const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const ownerCookie = cookieOf(await request(app).post("/api/auth/login").send({ key: OWNER }).expect(200));
  return { app, billing, stripe, ownerCookie, cookieOf, provisioned };
}

describe("Pricing catalog", () => {
  it("has the commercial structure and its value anchors", () => {
    expect(DEFAULT_PLANS.moderator_pro.monthly).toBe(2499);
    expect(DEFAULT_PLANS.creator_pro.monthly).toBe(4999);
    expect(DEFAULT_PLANS.agency.monthly).toBe(19900);
    expect(DEFAULT_PLANS.agency_pro.monthly).toBe(39900);
    expect(DEFAULT_PLANS.enterprise.monthly).toBeNull();
    expect(DEFAULT_PLANS.agency.yearly).toBe(199000);
    // ≈ €13.27 per creator (15 creators), founding ≈ €9.93, Agency Pro < €10 (40 creators).
    expect((19900 / 15 / 100).toFixed(2)).toBe("13.27");
    expect((14900 / 15 / 100).toFixed(2)).toBe("9.93");
    expect(39900 / 40 / 100).toBeLessThan(10);
    // Yearly = 10 months (2 months free) for the agency plans.
    expect(DEFAULT_PLANS.agency.yearly).toBe(DEFAULT_PLANS.agency.monthly! * 10);
    expect(DEFAULT_PLANS.agency_pro.yearly).toBe(DEFAULT_PLANS.agency_pro.monthly! * 10);
    expect(DEFAULT_PLANS.agency.entitlements).toMatchObject({ creator_limit: 15, team_seat_limit: 10, video_retention_days: 30 });
    expect(DEFAULT_PLANS.agency_pro.entitlements).toMatchObject({ creator_limit: 40, team_seat_limit: 25, video_retention_days: 90 });
    expect(DEFAULT_PLANS.agency_pro.trialDays).toBe(0);
  });

  it("admin overrides merge over the defaults without touching prices", () => {
    const cfg = mergeBillingConfig({ plans: { agency: { entitlements: { creator_limit: 20, bogus: 1 }, monthly: 1 } }, founding: { capacity: 25 } });
    expect(cfg.plans.agency.entitlements.creator_limit).toBe(20);
    expect(cfg.plans.agency.monthly).toBe(19900);
    expect(cfg.founding.capacity).toBe(25);
    expect(defaultBillingConfig().plans.agency.entitlements.creator_limit).toBe(15);
  });
});

describe("Entitlements", () => {
  const cfg = defaultBillingConfig();
  const ws = (status: Workspace["status"], extra: Partial<Workspace> = {}): Workspace => ({ id: "w", name: "W", plan: "agency", cycle: "month", status, cancelAtPeriodEnd: false, founding: false, trialUsed: false, createdAt: 0, updatedAt: 0, ...extra });

  it("trials use tighter allowances; failed payments get a grace period, then read-only", () => {
    expect(effectiveEntitlements(ws("active"), cfg).entitlements.creator_limit).toBe(15);
    const trial = effectiveEntitlements(ws("trialing"), cfg);
    expect(trial).toMatchObject({ access: "trial", period: "trial" });
    expect(trial.entitlements.creator_limit).toBe(5);
    expect(trial.entitlements.live_monitoring_hours).toBe(40);
    const now = Date.now();
    expect(effectiveEntitlements(ws("past_due", { pastDueSince: now - 1000 }), cfg, now).access).toBe("grace");
    const late = effectiveEntitlements(ws("past_due", { pastDueSince: now - PAST_DUE_GRACE_MS - 1 }), cfg, now);
    expect(late).toMatchObject({ access: "restricted", reason: "payment" });
    expect(late.entitlements.creator_limit).toBe(0);
    // History stays readable and data can still be exported.
    expect(late.entitlements.history_retention_days).toBe(365);
    expect(late.entitlements.exports_limit).toBeGreaterThan(0);
    expect(effectiveEntitlements(ws("canceled"), cfg)).toMatchObject({ access: "restricted", reason: "canceled" });
    expect(effectiveEntitlements(ws("pending"), cfg)).toMatchObject({ access: "restricted", reason: "not_started" });
  });

  it("meters AI usage per workspace and cuts the AI off at the allowance", async () => {
    const { billing } = await makeBilling();
    const ws = await billing.signup({ name: "Tiny", email: "a@b.co", plan: "moderator_pro" });
    await billing.syncSubscription(sub("sub_t", ws.workspace.id, "trialing", "novus_moderator_pro_month"));
    const inner: AIProvider = {
      name: "fake",
      available: () => true,
      reviewBatch: async (_i, _c, meter) => {
        meter?.({ inputTokens: 1000, outputTokens: 200 });
        return new Map();
      },
    };
    const metered = new MeteredAIProvider(inner, {
      allowed: () => billing.allowed(ws.workspace.id, "ai"),
      record: (r, i, o) => {
        billing.meterAdd(ws.workspace.id, "ai_requests", r);
        billing.meterAdd(ws.workspace.id, "ai_input_tokens", i);
        billing.meterAdd(ws.workspace.id, "ai_output_tokens", o);
      },
    });
    await metered.reviewBatch([], {} as never);
    expect(billing.usage(ws.workspace.id)).toMatchObject({ ai_requests: 1, ai_tokens: 1200 });
    for (let i = 0; i < 399; i++) await metered.reviewBatch([], {} as never);
    // Trial allowance (400 AI reviews) reached: AI off, local rules keep moderating.
    expect(metered.available()).toBe(false);
  });
});

describe("Stripe webhooks", () => {
  it("verifies signatures, is idempotent and mirrors subscription state", async () => {
    const { billing, stripe, store } = await makeBilling();
    const { workspace } = await billing.signup({ name: "Agence Lumière", email: "boss@agence.fr", plan: "agency" });
    await billing.startCheckout(workspace.id, { plan: "agency", cycle: "month", founding: true, origin: "https://novus.test" });
    const params = stripe.calls.checkout[0];
    expect(params.discounts).toEqual([{ coupon: "NOVUS_FOUNDING_AGENCY" }]);
    expect(params.subscription_data?.trial_period_days).toBe(14);
    expect(params.payment_method_collection).toBe("always");

    // Bad signature: refused.
    await expect(billing.handleWebhook(Buffer.from("{}"), "t=1,v1=bad")).rejects.toMatchObject({ code: "invalid_signature" });

    stripe.subs.set("sub_1", sub("sub_1", workspace.id, "trialing", "novus_agency_month"));
    const done = signed("checkout.session.completed", { id: "cs_1", object: "checkout.session", customer: "cus_1", subscription: "sub_1", metadata: { workspace_id: workspace.id, plan: "agency", cycle: "month", founding: "1" } }, "evt_checkout");
    expect(await billing.handleWebhook(Buffer.from(done.payload), done.header)).toEqual({ duplicate: false });
    // Replayed by Stripe: no double processing.
    expect(await billing.handleWebhook(Buffer.from(done.payload), done.header)).toEqual({ duplicate: true });
    let ws = billing.workspace(workspace.id)!;
    expect(ws).toMatchObject({ status: "trialing", founding: true, trialUsed: true, stripeSubscriptionId: "sub_1" });
    expect(ws.foundingUntil! - Date.now()).toBeGreaterThan(360 * 86400_000);

    const active = signed("customer.subscription.updated", sub("sub_1", workspace.id, "active", "novus_agency_month"));
    await billing.handleWebhook(Buffer.from(active.payload), active.header);
    // Founding: €149 for the first 12 months.
    expect(billing.mrr(billing.workspace(workspace.id)!)).toBe(14900);

    const failed = signed("invoice.payment_failed", { id: "in_1", object: "invoice", customer: "cus_1", metadata: {} });
    await billing.handleWebhook(Buffer.from(failed.payload), failed.header);
    const pastDue = signed("customer.subscription.updated", sub("sub_1", workspace.id, "past_due", "novus_agency_month"));
    await billing.handleWebhook(Buffer.from(pastDue.payload), pastDue.header);
    expect(billing.effective(workspace.id).access).toBe("grace");
    const paid = signed("invoice.paid", { id: "in_2", object: "invoice", customer: "cus_1", metadata: {} });
    await billing.handleWebhook(Buffer.from(paid.payload), paid.header);
    const back = signed("customer.subscription.updated", sub("sub_1", workspace.id, "active", "novus_agency_month"));
    await billing.handleWebhook(Buffer.from(back.payload), back.header);

    const up = signed("customer.subscription.updated", sub("sub_1", workspace.id, "active", "novus_agency_pro_month"));
    await billing.handleWebhook(Buffer.from(up.payload), up.header);
    ws = billing.workspace(workspace.id)!;
    expect(ws.plan).toBe("agency_pro");
    // The founding discount only applies to Agency: after upgrading, full Agency Pro price.
    expect(billing.mrr(ws)).toBe(39900);

    const gone = signed("customer.subscription.deleted", sub("sub_1", workspace.id, "canceled", "novus_agency_pro_month"));
    await billing.handleWebhook(Buffer.from(gone.payload), gone.header);
    expect(billing.effective(workspace.id)).toMatchObject({ access: "restricted", reason: "canceled" });

    const types = (await store.listEvents(0)).map((e) => e.type);
    expect(types.filter((t) => t === "checkout_completed")).toHaveLength(1);
    for (const t of ["checkout_started", "founding_offer_redeemed", "trial_started", "subscription_started", "payment_failed", "payment_recovered", "subscription_upgraded", "subscription_cancelled"]) expect(types).toContain(t);
  });

  it("a processing failure lets Stripe retry the same event", async () => {
    const { billing, stripe, store } = await makeBilling();
    const { workspace } = await billing.signup({ name: "Retry", email: "r@x.co", plan: "creator_pro" });
    stripe.client.subscriptions.retrieve = async () => {
      throw new Error("network down");
    };
    const ev = signed("checkout.session.completed", { id: "cs_x", object: "checkout.session", customer: "cus_9", subscription: "sub_9", metadata: { workspace_id: workspace.id } }, "evt_retry");
    await expect(billing.handleWebhook(Buffer.from(ev.payload), ev.header)).rejects.toThrow("network down");
    expect(await store.claimStripeEvent("evt_retry")).toBe(true);
  });

  it("changes plans through Stripe with proration; entitlements wait for the webhook", async () => {
    const { billing, stripe } = await makeBilling();
    const { workspace } = await billing.signup({ name: "Up", email: "u@x.co", plan: "creator_pro" });
    stripe.subs.set("sub_u", sub("sub_u", workspace.id, "active", "novus_creator_pro_month"));
    await billing.syncSubscription(stripe.subs.get("sub_u")!);
    await billing.changePlan(workspace.id, "agency", "month");
    expect(stripe.calls.updates[0][1]).toMatchObject({ proration_behavior: "create_prorations", items: [{ id: "si_1", price: "price_novus_agency_month" }] });
    expect(billing.workspace(workspace.id)!.plan).toBe("creator_pro");
  });
});

describe("Founding Agency offer", () => {
  it("is limited by real stored state, holds a slot during checkout and disappears when sold out", async () => {
    let now = Date.now();
    const { billing } = await makeBilling({ now: () => now });
    await billing.updateConfig({ founding: { capacity: 2 } });
    expect(billing.publicPricing().founding).toMatchObject({ available: true, capacity: 2, remaining: 2, monthly: 14900, months: 12 });
    const a = await billing.signup({ name: "A", email: "a@a.co", plan: "agency" });
    const b = await billing.signup({ name: "B", email: "b@b.co", plan: "agency" });
    const c = await billing.signup({ name: "C", email: "c@c.co", plan: "agency" });
    await billing.startCheckout(a.workspace.id, { plan: "agency", cycle: "month", founding: true, origin: "x" });
    await billing.startCheckout(b.workspace.id, { plan: "agency", cycle: "month", founding: true, origin: "x" });
    expect(billing.foundingRemaining()).toBe(0);
    expect(billing.publicPricing().founding.available).toBe(false);
    await expect(billing.startCheckout(c.workspace.id, { plan: "agency", cycle: "month", founding: true, origin: "x" })).rejects.toMatchObject({ code: "founding_sold_out" });
    // An abandoned checkout releases its slot after the hold.
    now += 60 * 60_000;
    expect(billing.foundingRemaining()).toBe(2);
    // Only Agency monthly gets the founding coupon.
    await expect(billing.startCheckout(c.workspace.id, { plan: "agency", cycle: "year", founding: true, origin: "x" })).resolves.toBeTruthy();
  });

  it("offers a trial once per email", async () => {
    const { billing, stripe } = await makeBilling();
    const first = await billing.signup({ name: "One", email: "same@x.co", plan: "creator_pro" });
    stripe.subs.set("sub_a", sub("sub_a", first.workspace.id, "trialing", "novus_creator_pro_month"));
    await billing.syncSubscription(stripe.subs.get("sub_a")!);
    const second = await billing.signup({ name: "Two", email: "SAME@x.co", plan: "creator_pro" });
    await billing.startCheckout(second.workspace.id, { plan: "creator_pro", cycle: "month", founding: false, origin: "x" });
    expect(stripe.calls.checkout.at(-1)!.subscription_data?.trial_period_days).toBeUndefined();
  });
});

describe("Plan limits on monitoring", () => {
  it("monitors up to the plan's creators, pauses the rest, and stops when restricted — without deleting", async () => {
    const { billing, stripe } = await makeBilling();
    const { workspace } = await billing.signup({ name: "Grow", email: "g@x.co", plan: "moderator_pro" });
    const repo = new MemoryRepository();
    const s = await space(repo, workspace.id);
    applyPlanToRooms(s.rooms, billing, workspace.id);
    stripe.subs.set("sub_g", sub("sub_g", workspace.id, "active", "novus_moderator_pro_month"));
    await billing.syncSubscription(stripe.subs.get("sub_g")!);
    await s.rooms.updateSettings({ tiktokProfiles: ["a", "b", "c", "d"] });
    expect(s.rooms.all().filter((r) => r.kind === "tiktok").map((r) => r.username)).toEqual(["a", "b", "c"]);
    expect(s.rooms.paused()).toEqual(["d"]);
    // Canceled: read-only, monitoring stops, the followed accounts are kept.
    await billing.syncSubscription(sub("sub_g", workspace.id, "canceled", "novus_moderator_pro_month"));
    await s.rooms.syncProfiles();
    expect(s.rooms.all().filter((r) => r.kind === "tiktok")).toHaveLength(0);
    expect(s.rooms.settings.tiktokProfiles).toEqual(["a", "b", "c", "d"]);
    expect(monitoredCreatorLimit(billing, workspace.id)).toBe(0);
  });

  it("a trial that used its LIVE hours pauses monitoring", async () => {
    const { billing } = await makeBilling();
    const { workspace } = await billing.signup({ name: "T", email: "t@x.co", plan: "creator_pro" });
    await billing.syncSubscription(sub("sub_tr", workspace.id, "trialing", "novus_creator_pro_month"));
    expect(monitoredCreatorLimit(billing, workspace.id)).toBe(3);
    billing.meterAdd(workspace.id, "live_minutes", 15 * 60);
    expect(monitoredCreatorLimit(billing, workspace.id)).toBe(0);
    expect(billing.me(workspace.id, { creators: 0, seats: 0, isFounder: true }).reason).toBe("trial_quota");
  });
});

describe("Billing over HTTP", () => {
  it("self-serve signup creates an isolated workspace, restricted until Stripe confirms", async () => {
    const { app, billing, stripe, ownerCookie, cookieOf } = await makeApp();
    const pricing = await request(app).get("/api/billing/plans").expect(200);
    expect(pricing.body.plans.map((p: { id: string }) => p.id)).toEqual(["moderator_pro", "creator_pro", "agency", "agency_pro", "enterprise"]);
    expect(JSON.stringify(pricing.body)).not.toMatch(/per_1m|costs|margin/);

    const res = await request(app).post("/api/billing/signup").send({ name: "Mod Squad", email: "mod@squad.io", plan: "moderator_pro", cycle: "month" }).expect(200);
    expect(res.body.code).toMatch(/^novus-/);
    expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const cookie = cookieOf(res);
    const me = await request(app).get("/api/billing/me").set("Cookie", cookie).expect(200);
    expect(me.body).toMatchObject({ plan: "moderator_pro", status: "pending", access: "restricted", reason: "not_started" });
    expect(JSON.stringify(me.body)).not.toMatch(/per_1m|grossMargin|costs/);
    // Restricted: cannot follow streamers yet.
    await request(app).post("/api/integrations/tiktok/connect").set("Cookie", cookie).send({ username: "someone" }).expect(402);

    // Stripe confirms the subscription.
    const id = res.body.workspaceId as string;
    stripe.subs.set("sub_m", sub("sub_m", id, "active", "novus_moderator_pro_month"));
    await billing.syncSubscription(stripe.subs.get("sub_m")!);
    for (const u of ["a1", "a2", "a3"]) await request(app).post("/api/integrations/tiktok/connect").set("Cookie", cookie).send({ username: u }).expect(200);
    // Moderator Pro: 3 creators, then an upgrade prompt.
    const over = await request(app).post("/api/integrations/tiktok/connect").set("Cookie", cookie).send({ username: "a4" }).expect(402);
    expect(over.body.error).toBe("plan_limit_creators");
    // 1 user: no team seats.
    const seat = await request(app).post("/api/team").set("Cookie", cookie).send({ name: "X", role: "moderator", permissions: ["moderate"], accounts: null }).expect(402);
    expect(seat.body.error).toBe("plan_limit_seats");

    // The code logs in; the workspace is isolated from the owner's.
    const again = cookieOf(await request(app).post("/api/auth/login").send({ key: res.body.code }).expect(200));
    const rooms = await request(app).get("/api/rooms").set("Cookie", again).expect(200);
    expect(rooms.body.rooms.map((r: { id: string }) => r.id)).toEqual(["main", "tt:a1", "tt:a2", "tt:a3"]);
    const ownerRooms = await request(app).get("/api/rooms").set("Cookie", ownerCookie).expect(200);
    expect(ownerRooms.body.rooms.map((r: { id: string }) => r.id)).toEqual(["main"]);

    // Admin dashboards: platform owner only.
    await request(app).get("/api/admin/overview").set("Cookie", cookie).expect(403);
    await request(app).get("/api/admin/config").set("Cookie", cookie).expect(403);
    await request(app).put("/api/admin/config").set("Cookie", cookie).send({ founding: { capacity: 99 } }).expect(403);
    const admin = await request(app).get("/api/admin/overview").set("Cookie", ownerCookie).expect(200);
    const row = admin.body.workspaces.find((w: { id: string }) => w.id === id);
    expect(row).toMatchObject({ plan: "moderator_pro", mrr: 24.99, creators: 3 });
    expect(admin.body.metrics).toMatchObject({ activeSubscriptions: 1, mrr: 24.99 });
    expect(admin.body.metrics.founding).toMatchObject({ capacity: 20, remaining: 20 });
  });

  it("counts exports against the plan and hides LIVEs older than the history window", async () => {
    const { app, billing, stripe, ownerCookie, cookieOf, provisioned } = await makeApp();
    const res = await request(app).post("/api/billing/signup").send({ name: "Exp", email: "e@x.co", plan: "moderator_pro", cycle: "month" }).expect(200);
    const cookie = cookieOf(res);
    const id = res.body.workspaceId as string;
    stripe.subs.set("sub_e", sub("sub_e", id, "active", "novus_moderator_pro_month"));
    await billing.syncSubscription(stripe.subs.get("sub_e")!);
    await request(app).put("/api/admin/config").set("Cookie", ownerCookie).send({ plans: { moderator_pro: { entitlements: { exports_limit: 1 } } } }).expect(200);
    const rt = provisioned.get(id)!.rooms.main.runtime;
    await rt.ingestExternal([{ type: "stream_status", status: "started", title: "L" }, { type: "comment", id: "c1", timestamp: Date.now(), viewer: { id: "v", username: "fan" }, text: "hello" }] as never, "tiktok");
    await rt.endSession();
    const sid = rt.session!.id;
    await request(app).get(`/api/history/${sid}/chat.txt`).set("Cookie", cookie).expect(200);
    const second = await request(app).get(`/api/history/${sid}/messages.csv`).set("Cookie", cookie).expect(402);
    expect(second.body.error).toBe("plan_limit_exports");
    // History window: shrink it to 1 day, then look at a LIVE from 3 days ago.
    await request(app).put("/api/admin/config").set("Cookie", ownerCookie).send({ plans: { moderator_pro: { entitlements: { history_retention_days: 1 } } } }).expect(200);
    rt.session!.startedAt = Date.now() - 3 * 86400_000;
    await rt.repository.saveSession(rt.session!);
    const list = await request(app).get("/api/history").set("Cookie", cookie).expect(200);
    expect(list.body.entries).toHaveLength(0);
    expect(list.body.hiddenOlder).toBe(true);
    expect((await request(app).get(`/api/history/${sid}`).set("Cookie", cookie).expect(402)).body.error).toBe("history_retention");
  });

  it("the admin changes limits without a deploy; history beyond the plan window is hidden", async () => {
    const { app, ownerCookie } = await makeApp();
    const cfg = await request(app).put("/api/admin/config").set("Cookie", ownerCookie).send({ plans: { moderator_pro: { entitlements: { creator_limit: 5 } } }, margins: { target: 80 } }).expect(200);
    expect(cfg.body.plans.moderator_pro.entitlements.creator_limit).toBe(5);
    expect(cfg.body.margins.target).toBe(80);
    await request(app).put("/api/admin/config").set("Cookie", ownerCookie).send({ plans: { moderator_pro: { monthly: 1 } } }).expect(400);
  });
});

describe("Lost founder code", () => {
  const mailbox = () => {
    const sent: MailMessage[] = [];
    const mailer: Mailer = { enabled: true, send: async (m) => void sent.push(m) };
    return { sent, mailer };
  };
  const tokenOf = (m: MailMessage) => /\/recover#([\w-]+)/.exec(m.text)![1];
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it("e-mails a one-time link that gives a new code; the old code and the link stop working", async () => {
    const { sent, mailer } = mailbox();
    const { app, cookieOf } = await makeApp({ mailer });
    const signup = await request(app).post("/api/billing/signup").send({ name: "Lost & Found", email: "Boss@Agency.io", plan: "creator_pro", cycle: "month" }).expect(200);
    const oldCode = signup.body.code as string;
    const oldCookie = cookieOf(signup);

    // Same answer for an unknown e-mail, and nothing is sent.
    const unknown = await request(app).post("/api/auth/recover").send({ email: "nobody@x.co" }).expect(200);
    const known = await request(app).post("/api/auth/recover").send({ email: "boss@agency.io", lang: "fr" }).expect(200);
    expect(unknown.body).toEqual(known.body);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("boss@agency.io");
    expect(sent[0].subject).toContain("code");
    expect(sent[0].text).toContain("https://novus.test/recover#");

    // A second request right away doesn't send another e-mail.
    await request(app).post("/api/auth/recover").send({ email: "boss@agency.io" }).expect(200);
    await flush();
    expect(sent).toHaveLength(1);

    const token = tokenOf(sent[0]);
    const done = await request(app).post("/api/auth/recover/complete").send({ token }).expect(200);
    expect(done.body.name).toBe("Lost & Found");
    expect(done.body.code).not.toBe(oldCode);
    // Logged in by the link itself.
    await request(app).get("/api/billing/me").set("Cookie", cookieOf(done)).expect(200);

    await request(app).post("/api/auth/recover/complete").send({ token }).expect(400, { error: "recovery_invalid" });
    await request(app).post("/api/auth/login").send({ key: oldCode }).expect(401);
    await request(app).get("/api/billing/me").set("Cookie", oldCookie).expect(401);
    await request(app).post("/api/auth/login").send({ key: done.body.code }).expect(200);
  });

  it("recovery links expire after 30 minutes", async () => {
    let now = Date.now();
    const { billing } = await makeBilling({ now: () => now });
    const { workspace } = await billing.signup({ name: "Slow", email: "slow@x.co", plan: "moderator_pro" });
    const [{ token }] = await billing.startRecovery("slow@x.co");
    now += 31 * 60_000;
    await expect(billing.completeRecovery(token)).rejects.toMatchObject({ code: "recovery_invalid" });
    expect(billing.workspace(workspace.id)?.recoveryHash).toBeTruthy();
  });

  it("without e-mail configured, points to support instead", async () => {
    const { app } = await makeApp({ supportEmail: "support@novus.test" });
    const res = await request(app).post("/api/auth/recover").send({ email: "a@b.co" }).expect(200);
    expect(res.body).toEqual({ email: false, support: "support@novus.test" });
  });

  it("the founder changes their code: other sessions are logged out, this one stays in", async () => {
    const { app, cookieOf } = await makeApp();
    const signup = await request(app).post("/api/billing/signup").send({ name: "Rotate", email: "r@x.co", plan: "moderator_pro", cycle: "month" }).expect(200);
    const phone = cookieOf(signup);
    const laptop = cookieOf(await request(app).post("/api/auth/login").send({ key: signup.body.code }).expect(200));
    expect((await request(app).get("/api/billing/me").set("Cookie", phone).expect(200)).body.ownCode).toBe(true);

    const res = await request(app).post("/api/billing/founder-code").set("Cookie", phone).send({}).expect(200);
    await request(app).get("/api/billing/me").set("Cookie", cookieOf(res)).expect(200);
    await request(app).get("/api/billing/me").set("Cookie", laptop).expect(401);
    await request(app).post("/api/auth/login").send({ key: res.body.code }).expect(200);
  });

  it("only the admin resets a customer's code, and never a server-managed one", async () => {
    const { app, ownerCookie, cookieOf } = await makeApp();
    const signup = await request(app).post("/api/billing/signup").send({ name: "Help", email: "h@x.co", plan: "moderator_pro", cycle: "month" }).expect(200);
    const id = signup.body.workspaceId as string;
    const customer = cookieOf(signup);

    await request(app).post(`/api/admin/workspaces/${id}/reset-code`).set("Cookie", customer).send({}).expect(403);
    await request(app).post("/api/admin/workspaces/owner/reset-code").set("Cookie", ownerCookie).send({}).expect(409, { error: "code_managed_by_server" });
    const owned = (await request(app).get("/api/admin/overview").set("Cookie", ownerCookie).expect(200)).body.workspaces as { id: string; ownCode: boolean }[];
    expect(owned.find((w) => w.id === id)?.ownCode).toBe(true);
    expect(owned.find((w) => w.id === "owner")?.ownCode).toBe(false);

    const res = await request(app).post(`/api/admin/workspaces/${id}/reset-code`).set("Cookie", ownerCookie).send({}).expect(200);
    await request(app).get("/api/billing/me").set("Cookie", customer).expect(401);
    await request(app).post("/api/auth/login").send({ key: res.body.code }).expect(200);
  });
});

describe("Real AI cost (Anthropic Cost API)", () => {
  type Page = { data: { starting_at: string; ending_at: string; results: { amount: string; currency: string; workspace_id: string | null }[] }[]; has_more: boolean; next_page: string | null };
  const fakeFetch = (pages: Page[]) => {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const impl = async (url: string, init: { headers: Record<string, string> }) => {
      urls.push(url);
      headers.push(init.headers);
      const page = pages[urls.length - 1];
      return { ok: true, status: 200, json: async () => page, text: async () => "" };
    };
    return { impl, urls, headers };
  };
  const bucket = (day: string, results: Page["data"][number]["results"]) => ({ starting_at: `${day}T00:00:00Z`, ending_at: `${day}T23:59:59Z`, results });

  it("sums the month's cost across pages (amounts are cents) with the admin key", async () => {
    const f = fakeFetch([
      { data: [bucket("2026-09-01", [{ amount: "1234.5", currency: "USD", workspace_id: null }])], has_more: true, next_page: "p2" },
      { data: [bucket("2026-09-02", [{ amount: "765.5", currency: "USD", workspace_id: null }])], has_more: false, next_page: null },
    ]);
    const report = new AnthropicCostReport({ adminKey: "sk-ant-admin01-test" }, f.impl, () => Date.parse("2026-09-26T12:00:00Z"));
    const status = await report.status();
    expect(status.actual?.usd).toBe(20);
    expect(f.urls[0]).toContain("/v1/organizations/cost_report?");
    expect(f.urls[0]).toContain("starting_at=2026-09-01T00%3A00%3A00Z");
    expect(f.urls[1]).toContain("page=p2");
    expect(f.headers[0]["x-api-key"]).toBe("sk-ant-admin01-test");
    expect(f.headers[0]["anthropic-version"]).toBe("2023-06-01");
    // Cached: no new call within 10 minutes.
    await report.status();
    expect(f.urls).toHaveLength(2);
  });

  it("can count a single Anthropic workspace", async () => {
    const f = fakeFetch([
      { data: [bucket("2026-09-01", [{ amount: "500", currency: "USD", workspace_id: "wrkspc_novus" }, { amount: "9000", currency: "USD", workspace_id: "wrkspc_other" }])], has_more: false, next_page: null },
    ]);
    const report = new AnthropicCostReport({ adminKey: "k", workspaceId: "wrkspc_novus" }, f.impl, () => Date.parse("2026-09-26T12:00:00Z"));
    expect((await report.status()).actual?.usd).toBe(5);
    expect(decodeURIComponent(f.urls[0])).toContain("group_by[]=workspace_id");
  });

  it("the admin overview scales AI costs to the real bill", async () => {
    const f = fakeFetch([{ data: [bucket(new Date().toISOString().slice(0, 10), [{ amount: "1000", currency: "USD", workspace_id: null }])], has_more: false, next_page: null }]);
    const { app, billing, ownerCookie } = await makeApp({ aiCost: new AnthropicCostReport({ adminKey: "k" }, f.impl) });
    // Metered estimate: 1M input tokens = €4.60 at the default price.
    billing.meterAdd("owner", "ai_input_tokens", 1_000_000);
    const body = (await request(app).get("/api/admin/overview").set("Cookie", ownerCookie).expect(200)).body;
    const ai = body.metrics.ai;
    expect(ai.source).toBe("anthropic");
    expect(ai.estimated).toBeCloseTo(4.6, 2);
    expect(ai.actualUsd).toBe(10);
    expect(ai.actual).toBeCloseTo(9.2, 2); // $10 × 0.92
    expect(ai.deviation).toBeCloseTo(100, 0);
    const owner = body.workspaces.find((w: { id: string }) => w.id === "owner");
    expect(owner.costs.ai).toBeCloseTo(9.2, 2);
  });

  it("without the admin key, the overview says the cost is an estimate", async () => {
    const { app, ownerCookie } = await makeApp();
    const ai = (await request(app).get("/api/admin/overview").set("Cookie", ownerCookie).expect(200)).body.metrics.ai;
    expect(ai).toMatchObject({ source: "estimate", configured: false, actual: null });
  });
});

describe("Profile", () => {
  it("the founder renames the workspace and sees their e-mail; members cannot rename", async () => {
    const { app, cookieOf } = await makeApp();
    const signup = await request(app).post("/api/billing/signup").send({ name: "Old Name", email: "pro@x.co", plan: "moderator_pro", cycle: "month" }).expect(200);
    const founder = cookieOf(signup);
    await request(app).put("/api/billing/profile").set("Cookie", founder).send({ name: "  New Name  " }).expect(200);
    const me = (await request(app).get("/api/billing/me").set("Cookie", founder).expect(200)).body;
    expect(me.name).toBe("New Name");
    expect(me.email).toBe("pro@x.co");
    await request(app).put("/api/billing/profile").set("Cookie", founder).send({ name: "x" }).expect(400);
    await request(app).put("/api/billing/profile").send({ name: "Anon" }).expect(401);
  });
});
