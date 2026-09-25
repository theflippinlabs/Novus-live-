import Stripe from "stripe";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, defaultBillingConfig, mergeBillingConfig } from "../shared/plans";
import { MeteredAIProvider, type AIProvider } from "../server/ai/AIProvider";
import { createApp, type Space } from "../server/app";
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

async function makeApp() {
  const { billing, stripe } = await makeBilling();
  const repo = new MemoryRepository();
  await billing.ensureComped("owner", "Novus Live", "enterprise");
  const owner = await space(repo, "owner");
  const provisioned = new Map<string, Space>();
  const app = createApp({
    config: { accessToken: OWNER, production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 10_000, ingestRateLimitPerMinute: 1000, sessionSecret: "s", publicUrl: "https://novus.test" },
    spaces: [owner],
    billing,
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
