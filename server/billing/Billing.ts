import { createHash, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import {
  mergeBillingConfig,
  monthlyValue,
  PLAN_IDS,
  priceLookupKey,
  SELF_SERVE_PLANS,
  type BillingConfig,
  type BillingCycle,
  type PlanId,
} from "../../shared/plans";
import type { BillingMe, PublicPricing, UsageSnapshot, WorkspaceStatus } from "../../shared/types";
import { allowanceLeft, effectiveEntitlements, monthKey, UsageMeter, type EffectiveEntitlements, type Metric } from "./Entitlements";
import type { BillingEvent, BillingStore, Workspace } from "./Store";

/*
 * Plans, trials, Stripe billing, the founding offer, usage metering and SaaS metrics.
 *
 * Stripe (through verified webhooks) is the only source of truth for payment state:
 * nothing the browser sends can change a plan or a status. The founding offer's
 * scarcity is counted from stored workspaces — never invented.
 */

export class BillingError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

/** Subset of the Stripe client this service uses (replaced by a fake in tests). */
export interface StripeLike {
  customers: { create(p: Stripe.CustomerCreateParams): Promise<{ id: string }> };
  checkout: { sessions: { create(p: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>; retrieve(id: string): Promise<Stripe.Checkout.Session> } };
  billingPortal: { sessions: { create(p: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
  prices: { list(p: Stripe.PriceListParams): Promise<{ data: { id: string; lookup_key: string | null }[] }> };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(id: string, p: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
    deleteDiscount(id: string): Promise<unknown>;
  };
  webhooks: { constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event };
}

/** Conversion events the browser may report (anything else is ignored). */
export const CLIENT_EVENTS = ["pricing_viewed", "billing_cycle_changed", "plan_viewed", "plan_selected", "founding_offer_selected", "upgrade_prompt_shown", "upgrade_prompt_clicked"] as const;

const PLAN_RANK: Record<PlanId, number> = { moderator_pro: 1, creator_pro: 2, agency: 3, agency_pro: 4, enterprise: 5 };
const FOUNDING_HOLD_MS = 45 * 60_000;
const YEAR_MS = 365 * 24 * 3600 * 1000;

export const hashFounderCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");
const RECOVERY_TTL_MS = 30 * 60_000;
const RECOVERY_RESEND_MS = 2 * 60_000;

const newFounderCode = () => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (const b of randomBytes(16)) s += alphabet[b % alphabet.length];
  return `novus-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
};

export interface BillingDeps {
  store: BillingStore;
  stripe?: StripeLike;
  webhookSecret?: string;
  now?: () => number;
  log?: (m: string) => void;
}

export class BillingService {
  config: BillingConfig = mergeBillingConfig(null);
  private workspaces = new Map<string, Workspace>();
  readonly meter = new UsageMeter();
  private pendingEvents: BillingEvent[] = [];
  private priceIds = new Map<string, string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** Called when a workspace's access changes (to start or stop its monitoring). */
  onChange: (workspaceId: string) => void = () => undefined;

  constructor(private deps: BillingDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  get stripeEnabled(): boolean {
    return Boolean(this.deps.stripe);
  }

  async init(): Promise<void> {
    this.config = mergeBillingConfig(await this.deps.store.loadConfig());
    for (const ws of await this.deps.store.listWorkspaces()) this.workspaces.set(ws.id, ws);
    const now = this.now();
    this.meter.load(await this.deps.store.loadUsage([monthKey(now), monthKey(now - 32 * 24 * 3600 * 1000), "trial"]));
  }

  start(flushMs = 60_000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => void this.flush(), flushMs);
    this.flushTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
  }

  /** Persist usage counters and events (batched). */
  async flush(): Promise<void> {
    const rows = this.meter.takeDirty();
    const events = this.pendingEvents.splice(0);
    try {
      await this.deps.store.saveUsage(rows);
    } catch (e) {
      this.meter.restore(rows);
      this.deps.log?.(`[billing] usage save failed: ${e instanceof Error ? e.message : e}`);
    }
    try {
      await this.deps.store.addEvents(events);
    } catch (e) {
      this.pendingEvents.unshift(...events);
      this.deps.log?.(`[billing] event save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private record(ev: Omit<BillingEvent, "at">): void {
    this.pendingEvents.push({ ...ev, at: this.now() });
  }

  // ---------------------------------------------------------------- workspaces

  workspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  all(): Workspace[] {
    return [...this.workspaces.values()];
  }

  private async save(ws: Workspace): Promise<void> {
    ws.updatedAt = this.now();
    this.workspaces.set(ws.id, ws);
    await this.deps.store.saveWorkspace(ws);
  }

  /** Spaces defined by the server's own access codes (owner, testers) are complimentary. */
  async ensureComped(id: string, name: string, plan: PlanId): Promise<Workspace> {
    const existing = this.workspaces.get(id);
    if (existing) return existing;
    const now = this.now();
    const ws: Workspace = { id, name, plan, cycle: "month", status: "comped", cancelAtPeriodEnd: false, founding: false, trialUsed: false, createdAt: now, updatedAt: now };
    await this.save(ws);
    return ws;
  }

  /** Self-serve workspace whose founder code matches (constant work per workspace). */
  findByFounderCode(code: string): Workspace | undefined {
    const h = hashFounderCode(code);
    let found: Workspace | undefined;
    for (const ws of this.workspaces.values()) if (ws.founderCodeHash && ws.founderCodeHash === h) found = ws;
    return found;
  }

  /** The founder renames their workspace (shown in the app and the admin dashboard). */
  async rename(id: string, name: string): Promise<void> {
    const ws = this.workspaces.get(id);
    if (!ws) throw new BillingError("workspace_not_found", 404);
    ws.name = name;
    await this.save(ws);
  }

  // ---------------------------------------------------------------- founder code (lost / rotated)

  /**
   * New founder code for a self-serve workspace: the old code and every session opened with
   * it stop working (sessions are signed over the code hash). Shown once to the caller.
   */
  async resetFounderCode(id: string, by: "founder" | "admin" | "recovery"): Promise<{ workspace: Workspace; code: string }> {
    const ws = this.workspaces.get(id);
    if (!ws) throw new BillingError("workspace_not_found", 404);
    // Owner and tester spaces open with the server's own access codes (env), not a stored one.
    if (!ws.founderCodeHash) throw new BillingError("code_managed_by_server", 409);
    const code = newFounderCode();
    ws.founderCodeHash = hashFounderCode(code);
    delete ws.recoveryHash;
    delete ws.recoveryExpiresAt;
    await this.save(ws);
    this.record({ type: "founder_code_reset", workspaceId: id, source: by });
    return { workspace: ws, code };
  }

  /**
   * One-time recovery tokens (valid 30 min) for the self-serve workspaces of this e-mail.
   * At most one e-mail per workspace every 2 minutes. Unknown e-mails get nothing (and the
   * caller answers the same way, so nobody learns which e-mails have a workspace).
   */
  async startRecovery(email: string): Promise<{ workspace: Workspace; token: string }[]> {
    const now = this.now();
    const out: { workspace: Workspace; token: string }[] = [];
    for (const ws of this.all()) {
      if (!ws.founderCodeHash || ws.ownerEmail !== email.trim().toLowerCase()) continue;
      if (ws.recoverySentAt && now - ws.recoverySentAt < RECOVERY_RESEND_MS) continue;
      const token = randomBytes(32).toString("base64url");
      ws.recoveryHash = hashFounderCode(token);
      ws.recoveryExpiresAt = now + RECOVERY_TTL_MS;
      ws.recoverySentAt = now;
      await this.save(ws);
      this.record({ type: "founder_code_recovery_requested", workspaceId: ws.id });
      out.push({ workspace: ws, token });
    }
    return out;
  }

  /** Redeem an e-mailed recovery token: a new founder code (the token works once). */
  async completeRecovery(token: string): Promise<{ workspace: Workspace; code: string }> {
    const h = hashFounderCode(token);
    const ws = this.all().find((w) => w.recoveryHash && w.recoveryHash === h);
    if (!ws || !ws.recoveryExpiresAt || ws.recoveryExpiresAt < this.now()) throw new BillingError("recovery_invalid", 400);
    return this.resetFounderCode(ws.id, "recovery");
  }

  effective(id: string): EffectiveEntitlements {
    const ws = this.workspaces.get(id);
    // A space without a billing record (tests, open access) keeps every feature.
    if (!ws) return effectiveEntitlements({ id, name: id, plan: "enterprise", cycle: "month", status: "comped", cancelAtPeriodEnd: false, founding: false, trialUsed: false, createdAt: 0, updatedAt: 0 }, this.config, this.now());
    return effectiveEntitlements(ws, this.config, this.now());
  }

  usage(id: string): UsageSnapshot {
    return this.meter.snapshot(id, this.effective(id).period);
  }

  /** Count usage against the month and, while trialing, the trial. */
  meterAdd(id: string, metric: Metric, n = 1): void {
    const eff = this.effective(id);
    const periods = [monthKey(this.now())];
    if (eff.period === "trial") periods.push("trial");
    this.meter.add(id, periods, metric, n);
  }

  /** May this workspace spend AI / monitoring / an export right now? */
  allowed(id: string, what: "ai" | "live" | "export"): boolean {
    const eff = this.effective(id);
    if (eff.access === "restricted" && what !== "export") return false;
    return allowanceLeft(eff, this.usage(id), what);
  }

  me(id: string, opts: { creators: number; seats: number; isFounder: boolean }): BillingMe {
    const ws = this.workspaces.get(id);
    const eff = this.effective(id);
    const trialQuota = eff.access === "trial" && !allowanceLeft(eff, this.usage(id), "live");
    return {
      workspaceId: id,
      name: ws?.name ?? id,
      email: opts.isFounder ? ws?.ownerEmail : undefined,
      plan: ws?.plan ?? "enterprise",
      cycle: ws?.cycle ?? "month",
      status: ws?.status ?? "comped",
      access: eff.access,
      reason: eff.reason ?? (trialQuota ? "trial_quota" : undefined),
      trialEndsAt: ws?.trialEndsAt,
      currentPeriodEnd: ws?.currentPeriodEnd,
      cancelAtPeriodEnd: ws?.cancelAtPeriodEnd ?? false,
      founding: ws?.founding ?? false,
      foundingUntil: ws?.foundingUntil,
      comped: !ws || ws.status === "comped",
      canManageBilling: opts.isFounder && Boolean(ws?.stripeCustomerId) && this.stripeEnabled,
      ownCode: opts.isFounder && Boolean(ws?.founderCodeHash),
      entitlements: eff.entitlements,
      usage: this.usage(id),
      creators: opts.creators,
      seats: opts.seats,
    };
  }

  // ---------------------------------------------------------------- founding offer

  /** Real remaining founding slots: capacity − founding agencies − live checkout holds. */
  foundingRemaining(): number {
    const f = this.config.founding;
    const now = this.now();
    const used = this.all().filter((w) => w.founding || (w.foundingHoldUntil && w.foundingHoldUntil > now)).length;
    return Math.max(0, f.capacity - used);
  }

  foundingAvailable(): boolean {
    return this.config.founding.enabled && this.config.plans.agency.available && this.foundingRemaining() > 0;
  }

  publicPricing(): PublicPricing {
    const plans = PLAN_IDS.map((id) => {
      const p = this.config.plans[id];
      return { id, monthly: p.monthly, yearly: p.yearly, trialDays: p.trialDays, available: p.available, entitlements: p.entitlements };
    });
    const f = this.config.founding;
    const agencyMonthly = this.config.plans.agency.monthly ?? 0;
    return {
      currency: "EUR",
      plans,
      founding: { available: this.foundingAvailable(), capacity: f.capacity, remaining: f.enabled ? this.foundingRemaining() : null, monthly: agencyMonthly - f.discountCents, months: f.months },
      checkoutEnabled: this.stripeEnabled,
    };
  }

  // ---------------------------------------------------------------- signup & checkout

  /**
   * Create a customer workspace (pending until Stripe confirms the subscription) and its
   * founder access code, shown once to the customer.
   */
  async signup(input: { name: string; email: string; plan: PlanId }): Promise<{ workspace: Workspace; code: string }> {
    if (!SELF_SERVE_PLANS.includes(input.plan) || !this.config.plans[input.plan].available) throw new BillingError("plan_unavailable", 400);
    const now = this.now();
    const code = newFounderCode();
    const ws: Workspace = {
      id: `w${randomBytes(6).toString("hex")}`,
      name: input.name,
      ownerEmail: input.email.toLowerCase(),
      founderCodeHash: hashFounderCode(code),
      plan: input.plan,
      cycle: "month",
      status: "pending",
      cancelAtPeriodEnd: false,
      founding: false,
      trialUsed: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.save(ws);
    this.record({ type: "workspace_created", workspaceId: ws.id, plan: ws.plan });
    return { workspace: ws, code };
  }

  private async priceId(plan: PlanId, cycle: BillingCycle): Promise<string> {
    const key = priceLookupKey(plan, cycle);
    const cached = this.priceIds.get(key);
    if (cached) return cached;
    const res = await this.deps.stripe!.prices.list({ lookup_keys: [key], active: true, limit: 1 });
    const id = res.data[0]?.id;
    if (!id) throw new BillingError("price_not_configured", 503);
    this.priceIds.set(key, id);
    return id;
  }

  /** A trial is offered once per email, only on plans that have one. */
  private trialDaysFor(ws: Workspace, plan: PlanId): number {
    const days = this.config.plans[plan].trialDays;
    if (!days || ws.trialUsed || ws.stripeSubscriptionId) return 0;
    const email = ws.ownerEmail;
    if (email && this.all().some((w) => w.id !== ws.id && w.ownerEmail === email && (w.trialUsed || w.stripeSubscriptionId))) return 0;
    return days;
  }

  async startCheckout(
    id: string,
    input: { plan: PlanId; cycle: BillingCycle; founding: boolean; origin: string; source?: string; anonId?: string },
  ): Promise<{ url: string }> {
    const stripe = this.deps.stripe;
    if (!stripe) throw new BillingError("billing_not_configured", 503);
    const ws = this.workspaces.get(id);
    if (!ws) throw new BillingError("workspace_not_found", 404);
    if (ws.stripeSubscriptionId && !["canceled", "pending"].includes(ws.status)) throw new BillingError("already_subscribed", 409);
    const plan = this.config.plans[input.plan];
    if (!SELF_SERVE_PLANS.includes(input.plan) || !plan.available) throw new BillingError("plan_unavailable", 400);
    // Founding pricing: Agency, monthly, while real slots remain.
    const founding = input.founding && input.plan === "agency" && input.cycle === "month";
    if (founding && !this.foundingAvailable() && !(ws.foundingHoldUntil && ws.foundingHoldUntil > this.now())) throw new BillingError("founding_sold_out", 409);

    if (!ws.stripeCustomerId) {
      const customer = await stripe.customers.create({ email: ws.ownerEmail, name: ws.name, metadata: { workspace_id: ws.id } });
      ws.stripeCustomerId = customer.id;
    }
    const trialDays = this.trialDaysFor(ws, input.plan);
    const meta = { workspace_id: ws.id, plan: input.plan, cycle: input.cycle, founding: founding ? "1" : "0" };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: ws.stripeCustomerId,
      client_reference_id: ws.id,
      line_items: [{ price: await this.priceId(input.plan, input.cycle), quantity: 1 }],
      subscription_data: { metadata: meta, ...(trialDays ? { trial_period_days: trialDays } : {}) },
      ...(founding ? { discounts: [{ coupon: this.config.founding.couponId }] } : {}),
      payment_method_collection: "always",
      billing_address_collection: "auto",
      metadata: meta,
      success_url: `${input.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.origin}/pricing?checkout=canceled`,
    });
    if (founding) ws.foundingHoldUntil = this.now() + FOUNDING_HOLD_MS;
    ws.plan = input.plan;
    ws.cycle = input.cycle;
    await this.save(ws);
    this.record({ type: "checkout_started", workspaceId: ws.id, plan: input.plan, cycle: input.cycle, source: input.source, anonId: input.anonId, meta: { founding, trialDays } });
    if (!session.url) throw new BillingError("checkout_failed", 502);
    return { url: session.url };
  }

  async portal(id: string, returnUrl: string): Promise<{ url: string }> {
    const stripe = this.deps.stripe;
    const ws = this.workspaces.get(id);
    if (!stripe) throw new BillingError("billing_not_configured", 503);
    if (!ws?.stripeCustomerId) throw new BillingError("no_billing_account", 409);
    return stripe.billingPortal.sessions.create({ customer: ws.stripeCustomerId, return_url: returnUrl });
  }

  /**
   * Upgrade / downgrade an existing subscription with Stripe proration. Entitlements
   * follow only once Stripe's webhook confirms the new subscription state.
   */
  async changePlan(id: string, plan: PlanId, cycle: BillingCycle): Promise<void> {
    const stripe = this.deps.stripe;
    const ws = this.workspaces.get(id);
    if (!stripe) throw new BillingError("billing_not_configured", 503);
    if (!ws?.stripeSubscriptionId || ["canceled", "pending", "comped"].includes(ws.status)) throw new BillingError("no_subscription", 409);
    if (!SELF_SERVE_PLANS.includes(plan) || !this.config.plans[plan].available) throw new BillingError("plan_unavailable", 400);
    if (plan === ws.plan && cycle === ws.cycle) return;
    const sub = await stripe.subscriptions.retrieve(ws.stripeSubscriptionId);
    const item = sub.items.data[0];
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: await this.priceId(plan, cycle) }],
      proration_behavior: "create_prorations",
      metadata: { ...sub.metadata, plan, cycle },
    });
    // The founding discount only applies to Agency monthly.
    if (ws.founding && (plan !== "agency" || cycle !== "month")) await stripe.subscriptions.deleteDiscount(sub.id).catch(() => undefined);
  }

  // ---------------------------------------------------------------- webhooks

  /** Verified, idempotent, retry-safe Stripe webhook handling. */
  async handleWebhook(raw: Buffer, signature: string | undefined): Promise<{ duplicate: boolean }> {
    const stripe = this.deps.stripe;
    if (!stripe || !this.deps.webhookSecret) throw new BillingError("billing_not_configured", 503);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(raw, signature ?? "", this.deps.webhookSecret);
    } catch {
      throw new BillingError("invalid_signature", 400);
    }
    if (!(await this.deps.store.claimStripeEvent(event.id, event.type))) return { duplicate: true };
    try {
      await this.apply(event);
      await this.flush();
    } catch (e) {
      // Let Stripe retry this event later.
      await this.deps.store.releaseStripeEvent(event.id).catch(() => undefined);
      throw e;
    }
    return { duplicate: false };
  }

  private findForStripe(obj: { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null; metadata?: Stripe.Metadata | null; subscription?: unknown }): Workspace | undefined {
    const wsId = obj.metadata?.workspace_id;
    if (wsId && this.workspaces.has(wsId)) return this.workspaces.get(wsId);
    const customer = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
    return this.all().find((w) => customer && w.stripeCustomerId === customer);
  }

  private async apply(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const ws = this.findForStripe({ customer: s.customer, metadata: s.metadata });
        if (!ws) return;
        if (typeof s.customer === "string") ws.stripeCustomerId = s.customer;
        if (typeof s.subscription === "string") ws.stripeSubscriptionId = s.subscription;
        if (s.metadata?.founding === "1" && !ws.founding) {
          ws.founding = true;
          ws.foundingUntil = this.now() + this.config.founding.months * (YEAR_MS / 12);
          this.record({ type: "founding_offer_redeemed", workspaceId: ws.id, plan: "agency" });
        }
        ws.foundingHoldUntil = undefined;
        await this.save(ws);
        this.record({ type: "checkout_completed", workspaceId: ws.id, plan: s.metadata?.plan, cycle: s.metadata?.cycle });
        // The subscription itself arrives in customer.subscription.* events; fetch it now too.
        if (ws.stripeSubscriptionId && this.deps.stripe) await this.syncSubscription(await this.deps.stripe.subscriptions.retrieve(ws.stripeSubscriptionId));
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        return;
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const ws = this.findForStripe({ customer: inv.customer, metadata: inv.metadata });
        if (!ws) return;
        ws.pastDueSince ??= this.now();
        await this.save(ws);
        this.record({ type: "payment_failed", workspaceId: ws.id, plan: ws.plan, cycle: ws.cycle });
        return;
      }
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        const ws = this.findForStripe({ customer: inv.customer, metadata: inv.metadata });
        if (!ws) return;
        if (ws.pastDueSince) {
          ws.pastDueSince = undefined;
          await this.save(ws);
          this.record({ type: "payment_recovered", workspaceId: ws.id, plan: ws.plan, cycle: ws.cycle });
        }
        return;
      }
      default:
        return;
    }
  }

  /** Mirror a Stripe subscription into its workspace (the only way plans and statuses change). */
  async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const ws = this.findForStripe({ customer: sub.customer, metadata: sub.metadata });
    if (!ws) {
      this.deps.log?.(`[billing] subscription ${sub.id} has no workspace`);
      return;
    }
    const before = { status: ws.status, plan: ws.plan, cycle: ws.cycle, cancel: ws.cancelAtPeriodEnd };
    const item = sub.items?.data?.[0];
    const lookup = item?.price?.lookup_key ?? "";
    const m = /^novus_(.+)_(month|year)$/.exec(lookup);
    if (m && (PLAN_IDS as readonly string[]).includes(m[1])) {
      ws.plan = m[1] as PlanId;
      ws.cycle = m[2] as BillingCycle;
    }
    const s = sub as Stripe.Subscription & { current_period_start?: number; current_period_end?: number };
    const itemPeriod = item as (typeof item & { current_period_start?: number; current_period_end?: number }) | undefined;
    const start = itemPeriod?.current_period_start ?? s.current_period_start;
    const end = itemPeriod?.current_period_end ?? s.current_period_end;
    ws.stripeSubscriptionId = sub.id;
    if (typeof sub.customer === "string") ws.stripeCustomerId = sub.customer;
    ws.currentPeriodStart = start ? start * 1000 : ws.currentPeriodStart;
    ws.currentPeriodEnd = end ? end * 1000 : ws.currentPeriodEnd;
    ws.trialEndsAt = sub.trial_end ? sub.trial_end * 1000 : undefined;
    ws.cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
    ws.status = mapStatus(sub.status);
    if (ws.status === "trialing") ws.trialUsed = true;
    if (ws.status === "past_due") ws.pastDueSince ??= this.now();
    else if (ws.status === "active") ws.pastDueSince = undefined;
    if (ws.status === "active" && !ws.paidSince) ws.paidSince = this.now();
    if (ws.status === "canceled") ws.canceledAt ??= this.now();
    await this.save(ws);

    const ev = { workspaceId: ws.id, plan: ws.plan, cycle: ws.cycle };
    if (ws.status === "trialing" && before.status !== "trialing") this.record({ type: "trial_started", ...ev });
    if (ws.status === "active" && !["active", "past_due"].includes(before.status)) this.record({ type: "subscription_started", ...ev, meta: { fromTrial: before.status === "trialing" } });
    if (["active", "trialing", "past_due"].includes(before.status) && ws.plan !== before.plan) {
      this.record({ type: PLAN_RANK[ws.plan] > PLAN_RANK[before.plan] ? "subscription_upgraded" : "subscription_downgraded", ...ev, meta: { from: before.plan } });
    }
    if ((ws.status === "canceled" && before.status !== "canceled") || (ws.cancelAtPeriodEnd && !before.cancel)) this.record({ type: "subscription_cancelled", ...ev, meta: { atPeriodEnd: ws.cancelAtPeriodEnd } });
    if (before.status !== ws.status) this.onChange(ws.id);
  }

  // ---------------------------------------------------------------- analytics & admin

  track(ev: { type: string; plan?: string; cycle?: string; source?: string; anonId?: string; workspaceId?: string }): void {
    if (!(CLIENT_EVENTS as readonly string[]).includes(ev.type)) return;
    this.record({ type: ev.type, plan: ev.plan, cycle: ev.cycle, source: ev.source?.slice(0, 40), anonId: ev.anonId?.slice(0, 40), workspaceId: ev.workspaceId });
  }

  /** Enterprise contact request, kept for the admin (only what the prospect typed). */
  async recordLead(lead: { name: string; email: string; company: string; creators: number; message?: string }): Promise<void> {
    this.record({ type: "enterprise_lead_detail", source: "pricing", meta: lead });
    await this.flush();
  }

  async events(sinceMs: number): Promise<BillingEvent[]> {
    await this.flush();
    return this.deps.store.listEvents(sinceMs);
  }

  async updateConfig(patch: unknown): Promise<BillingConfig> {
    // Stored as the admin's overrides; merged over the catalog defaults.
    const current = (await this.deps.store.loadConfig()) as Record<string, unknown> | null;
    const merged = deepMerge(current ?? {}, (patch ?? {}) as Record<string, unknown>);
    this.config = mergeBillingConfig(merged);
    await this.deps.store.saveConfig(merged);
    for (const ws of this.all()) this.onChange(ws.id);
    return this.config;
  }

  /** Monthly recurring revenue in cents for a workspace (0 unless paying). */
  mrr(ws: Workspace): number {
    if (!["active", "past_due"].includes(ws.status)) return 0;
    const plan = this.config.plans[ws.plan];
    let value = monthlyValue(plan, ws.cycle);
    if (ws.founding && ws.plan === "agency" && ws.cycle === "month" && ws.foundingUntil && ws.foundingUntil > this.now()) value -= this.config.founding.discountCents;
    return Math.max(0, value);
  }
}

function mapStatus(s: Stripe.Subscription.Status): WorkspaceStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "pending";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "restricted";
  }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") out[k] = deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}
