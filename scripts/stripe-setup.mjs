#!/usr/bin/env node
/*
 * One-time (idempotent) Stripe setup for Novus Live:
 *   - a product per plan with monthly + yearly EUR prices (lookup keys novus_<plan>_<cycle>)
 *   - the Founding Agency coupon (−€50/month for 12 months, Agency only)
 *   - a Customer Portal configuration (payment method, invoices, plan switch, cancel)
 *   - the webhook endpoint (its signing secret is written to .stripe-webhook-secret, never printed)
 *
 * Usage: STRIPE_SECRET_KEY=sk_... PUBLIC_URL=https://your-app node scripts/stripe-setup.mjs
 * Safe to run again: existing objects are found by lookup key / id and left as they are.
 */
import { writeFileSync } from "node:fs";
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const publicUrl = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
if (!key) throw new Error("STRIPE_SECRET_KEY is required");
if (!publicUrl) throw new Error("PUBLIC_URL is required (e.g. https://novus-live-production.up.railway.app)");
const stripe = new Stripe(key);

const PLANS = [
  { id: "moderator_pro", name: "Novus Live — Moderator Pro", month: 2499, year: 24900 },
  { id: "creator_pro", name: "Novus Live — Creator Pro", month: 4999, year: 49900 },
  { id: "agency", name: "Novus Live — Agency", month: 19900, year: 199000 },
  { id: "agency_pro", name: "Novus Live — Agency Pro", month: 39900, year: 399000 },
];
const COUPON = "NOVUS_FOUNDING_AGENCY";
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.payment_failed",
  "invoice.paid",
];

const log = (m) => console.log(`[stripe-setup] ${m}`);
const mode = key.startsWith("sk_live") ? "LIVE" : "TEST";
log(`mode: ${mode}`);

const products = {};
for (const p of PLANS) {
  const lookups = [`novus_${p.id}_month`, `novus_${p.id}_year`];
  const existing = await stripe.prices.list({ lookup_keys: lookups, active: true, expand: ["data.product"] });
  let productId = existing.data[0]?.product?.id;
  if (!productId) {
    const found = await stripe.products.search({ query: `metadata['novus_plan']:'${p.id}'` }).catch(() => ({ data: [] }));
    productId = found.data[0]?.id ?? (await stripe.products.create({ name: p.name, metadata: { novus_plan: p.id } })).id;
    log(`product ${p.id}: ${productId}`);
  }
  products[p.id] = { product: productId, prices: [] };
  for (const [interval, amount] of [["month", p.month], ["year", p.year]]) {
    const lookup = `novus_${p.id}_${interval}`;
    let price = existing.data.find((x) => x.lookup_key === lookup);
    if (!price) {
      price = await stripe.prices.create({ product: productId, currency: "eur", unit_amount: amount, recurring: { interval }, lookup_key: lookup, tax_behavior: "inclusive", metadata: { novus_plan: p.id } });
      log(`price ${lookup}: created`);
    } else if (price.unit_amount !== amount) {
      log(`price ${lookup}: exists at ${price.unit_amount} (expected ${amount}) — left unchanged`);
    }
    products[p.id].prices.push(price.id);
  }
}

try {
  await stripe.coupons.retrieve(COUPON);
  log(`coupon ${COUPON}: exists`);
} catch {
  await stripe.coupons.create({
    id: COUPON,
    name: "Founding Agency",
    amount_off: 5000,
    currency: "eur",
    duration: "repeating",
    duration_in_months: 12,
    applies_to: { products: [products.agency.product] },
  });
  log(`coupon ${COUPON}: created (−€50/month for 12 months, Agency only)`);
}

const portals = await stripe.billingPortal.configurations.list({ limit: 20 });
if (!portals.data.some((c) => c.metadata?.novus === "1" && c.active)) {
  await stripe.billingPortal.configurations.create({
    metadata: { novus: "1" },
    business_profile: { headline: "Novus Live — manage your subscription" },
    default_return_url: `${publicUrl}/?view=billing`,
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id", "name"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: PLANS.map((p) => ({ product: products[p.id].product, prices: products[p.id].prices })),
      },
    },
  });
  log("customer portal: configured");
} else log("customer portal: exists");

const url = `${publicUrl}/api/billing/webhook`;
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
if (hooks.data.some((h) => h.url === url)) log(`webhook ${url}: exists (secret unchanged)`);
else {
  const hook = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, description: "Novus Live billing" });
  writeFileSync(".stripe-webhook-secret", hook.secret ?? "", { mode: 0o600 });
  log(`webhook ${url}: created — signing secret written to .stripe-webhook-secret (set it as STRIPE_WEBHOOK_SECRET, then delete the file)`);
}
log("done");
