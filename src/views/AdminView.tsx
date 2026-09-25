import { useEffect, useState } from "react";
import { PLAN_IDS, type BillingConfig, type Entitlements, type PlanId } from "../../shared/plans";
import { ApiError } from "../api";
import { billingApi, PLAN_NAMES, type AdminOverview } from "../billing";
import { Segmented } from "../components/ui";
import { errorText, useLang } from "../i18n";
import { navigate, toast } from "../store";

// Admin-only (platform owner): SaaS metrics, per-customer profitability, conversion
// funnel and live configuration. The server refuses these endpoints to anyone else.

type Tab = "overview" | "customers" | "funnel" | "config";
const eur = (v: number, lang: "en" | "fr") => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v);
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

const T = {
  en: {
    title: "Admin",
    back: "Back",
    tabs: { overview: "Overview", customers: "Customers", funnel: "Funnel", config: "Config" },
    mrr: "MRR",
    arr: "ARR",
    active: "Active subscriptions",
    trials: "Trials",
    trialToPaid: "Trial → paid",
    arpu: "ARPU",
    churn: "Churn (30 d)",
    pastDue: "Past due",
    cost: "Est. infra cost",
    profit: "Est. gross profit",
    margin: "Est. gross margin",
    founding: "Founding Agency",
    used: "used",
    left: "left",
    last30: "Last 30 days",
    newSubs: "New",
    upgrades: "Upgrades",
    downgrades: "Downgrades",
    cancels: "Cancellations",
    failed: "Payments failed",
    recovered: "Recovered",
    byPlan: "MRR by plan",
    trend: "New vs cancelled (6 months)",
    stripeOff: "Stripe is not configured: checkout is closed and payments are not processed.",
    health: { healthy: "HEALTHY", watch: "WATCH", at_risk: "AT RISK", "n/a": "N/A" },
    creators: "creators",
    seats: "seats",
    liveH: "LIVE h",
    aiReq: "AI reviews",
    costs: "Costs",
    estimate: "Estimates for the current month from metered usage × your cost assumptions. Never shown to customers.",
    leads: "Enterprise requests",
    noLeads: "No request yet.",
    funnelNote: "Last 30 days. Visitors = unique browsers on the pricing page.",
    steps: {
      visitors: "Visitors",
      pricing_views: "Pricing views",
      plan_selections: "Plan selections",
      checkout_starts: "Checkout starts",
      checkout_completions: "Checkout completions",
      trials: "Trials",
      paid: "Paid",
      retained_30d: "Retained 30 d+",
    } as Record<string, string>,
    save: "Save",
    saved: "Saved",
    configNote: "Changes apply immediately to every workspace. Prices are managed in Stripe.",
    available: "Available",
    trialDays: "Trial days",
    trialAllowance: "Trial",
    foundingEnabled: "Founding offer enabled",
    capacity: "Capacity",
    costTitle: "Internal cost assumptions (EUR)",
    marginTitle: "Margin thresholds (%)",
  },
  fr: {
    title: "Admin",
    back: "Retour",
    tabs: { overview: "Vue d'ensemble", customers: "Clients", funnel: "Entonnoir", config: "Réglages" },
    mrr: "MRR",
    arr: "ARR",
    active: "Abonnements actifs",
    trials: "Essais",
    trialToPaid: "Essai → payant",
    arpu: "ARPU",
    churn: "Churn (30 j)",
    pastDue: "Impayés",
    cost: "Coût infra estimé",
    profit: "Marge brute estimée",
    margin: "Taux de marge estimé",
    founding: "Founding Agency",
    used: "prises",
    left: "restantes",
    last30: "30 derniers jours",
    newSubs: "Nouveaux",
    upgrades: "Montées",
    downgrades: "Descentes",
    cancels: "Résiliations",
    failed: "Paiements échoués",
    recovered: "Récupérés",
    byPlan: "MRR par offre",
    trend: "Nouveaux vs résiliés (6 mois)",
    stripeOff: "Stripe n'est pas configuré : le paiement est fermé et aucun paiement n'est traité.",
    health: { healthy: "SAIN", watch: "À SURVEILLER", at_risk: "À RISQUE", "n/a": "N/A" },
    creators: "créateurs",
    seats: "membres",
    liveH: "h LIVE",
    aiReq: "analyses IA",
    costs: "Coûts",
    estimate: "Estimations du mois en cours : usage mesuré × vos hypothèses de coûts. Jamais visibles par les clients.",
    leads: "Demandes Enterprise",
    noLeads: "Aucune demande pour l'instant.",
    funnelNote: "30 derniers jours. Visiteurs = navigateurs uniques sur la page des offres.",
    steps: {
      visitors: "Visiteurs",
      pricing_views: "Vues des offres",
      plan_selections: "Offres choisies",
      checkout_starts: "Paiements démarrés",
      checkout_completions: "Paiements terminés",
      trials: "Essais",
      paid: "Payants",
      retained_30d: "Fidèles 30 j+",
    } as Record<string, string>,
    save: "Enregistrer",
    saved: "Enregistré",
    configNote: "Les changements s'appliquent tout de suite à tous les espaces. Les prix se gèrent dans Stripe.",
    available: "Disponible",
    trialDays: "Jours d'essai",
    trialAllowance: "Essai",
    foundingEnabled: "Offre fondateur active",
    capacity: "Capacité",
    costTitle: "Hypothèses de coûts internes (EUR)",
    marginTitle: "Seuils de marge (%)",
  },
};

export function AdminView() {
  const lang = useLang();
  const tx = T[lang];
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    billingApi
      .adminOverview()
      .then(setData)
      .catch((e) => setError(errorText(e instanceof ApiError ? e.code : "internal_error", lang)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scroll">
      <div className="narrow stack">
        <div className="row">
          <button className="btn sm ghost" onClick={() => navigate("settings")}>
            ← {tx.back}
          </button>
          <b style={{ flex: 1, fontSize: 18 }}>{tx.title}</b>
        </div>
        <Segmented label={tx.title} value={tab} gold onChange={setTab} options={(Object.keys(tx.tabs) as Tab[]).map((k) => ({ value: k, label: tx.tabs[k] }))} />
        {error ? <div className="card">{error}</div> : null}
        {!data && !error ? <div className="card muted">…</div> : null}
        {data && !data.stripe ? <div className="billing-banner bad">{tx.stripeOff}</div> : null}
        {data && tab === "overview" ? <Overview d={data} lang={lang} /> : null}
        {data && tab === "customers" ? <Customers d={data} lang={lang} /> : null}
        {data && tab === "funnel" ? <Funnel d={data} lang={lang} /> : null}
        {tab === "config" ? <Config lang={lang} onSaved={load} /> : null}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Overview({ d, lang }: { d: AdminOverview; lang: "en" | "fr" }) {
  const tx = T[lang];
  const m = d.metrics;
  return (
    <>
      <div className="admin-grid">
        <Kpi label={tx.mrr} value={eur(m.mrr, lang)} />
        <Kpi label={tx.arr} value={eur(m.arr, lang)} />
        <Kpi label={tx.active} value={m.activeSubscriptions} />
        <Kpi label={tx.trials} value={m.trials} />
        <Kpi label={tx.trialToPaid} value={pct(m.trialToPaid)} />
        <Kpi label={tx.arpu} value={eur(m.arpu, lang)} />
        <Kpi label={tx.churn} value={pct(m.churn30)} />
        <Kpi label={tx.pastDue} value={m.pastDue} />
        <Kpi label={tx.cost} value={eur(m.estimatedCost, lang)} />
        <Kpi label={tx.profit} value={eur(m.grossProfit, lang)} />
        <Kpi label={tx.margin} value={pct(m.grossMargin)} />
        <Kpi label={tx.founding} value={`${m.founding.used}/${m.founding.capacity} ${tx.used} · ${m.founding.remaining} ${tx.left}`} />
      </div>
      <div className="card">
        <div className="card-title">{tx.last30}</div>
        <div className="admin-grid">
          <Kpi label={tx.newSubs} value={m.last30.newSubscriptions} />
          <Kpi label={tx.upgrades} value={m.last30.upgrades} />
          <Kpi label={tx.downgrades} value={m.last30.downgrades} />
          <Kpi label={tx.cancels} value={m.last30.cancellations} />
          <Kpi label={tx.failed} value={m.last30.paymentsFailed} />
          <Kpi label={tx.recovered} value={m.last30.paymentsRecovered} />
        </div>
      </div>
      <div className="card">
        <div className="card-title">{tx.byPlan}</div>
        {PLAN_IDS.map((p) => (
          <div key={p} className="compare-row">
            <span>{PLAN_NAMES[p]}</span>
            <b>{eur(m.mrrByPlan[p] ?? 0, lang)}</b>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{tx.trend}</div>
        {m.trend.map((r) => (
          <div key={r.month} className="compare-row">
            <span>{r.month}</span>
            <b>
              +{r.newSubscriptions} / −{r.cancellations}
            </b>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{tx.leads}</div>
        {d.leads.length === 0 ? <div className="small muted">{tx.noLeads}</div> : null}
        {d.leads.map((l) => (
          <div key={l.at} className="member-row">
            <b>
              {l.company} · {l.creators} {tx.creators}
            </b>
            <div className="small">
              {l.name} — {l.email}
            </div>
            {l.message ? <div className="small muted">{l.message}</div> : null}
          </div>
        ))}
      </div>
    </>
  );
}

function Customers({ d, lang }: { d: AdminOverview; lang: "en" | "fr" }) {
  const tx = T[lang];
  const rows = [...d.workspaces].sort((a, b) => (a.grossMargin ?? 999) - (b.grossMargin ?? 999));
  return (
    <>
      <div className="small muted">{tx.estimate}</div>
      {rows.map((w) => (
        <div key={w.id} className="card">
          <div className="row wrap" style={{ gap: 8 }}>
            <b style={{ flex: 1 }}>{w.name}</b>
            <span className={`health ${w.health}`}>{tx.health[w.health]}</span>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {PLAN_NAMES[w.plan as PlanId]} · {w.cycle} · {w.status}
            {w.founding ? " · Founding" : ""} · {w.creators} {tx.creators} · {w.seats} {tx.seats}
          </div>
          <div className="admin-grid" style={{ marginTop: 8 }}>
            <Kpi label={tx.mrr} value={eur(w.mrr, lang)} />
            <Kpi label={tx.costs} value={eur(w.costs.total, lang)} />
            <Kpi label={tx.profit} value={eur(w.grossProfit, lang)} />
            <Kpi label={tx.margin} value={pct(w.grossMargin)} />
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {w.liveHours} {tx.liveH} · {w.aiRequests} {tx.aiReq} · IA {eur(w.costs.ai, lang)} · provider {eur(w.costs.provider, lang)} · LIVE {eur(w.costs.live, lang)} · fixe {eur(w.costs.fixed, lang)}
          </div>
        </div>
      ))}
    </>
  );
}

function Funnel({ d, lang }: { d: AdminOverview; lang: "en" | "fr" }) {
  const tx = T[lang];
  const max = Math.max(1, ...d.funnel.map((s) => s.total));
  return (
    <div className="card">
      <div className="small muted" style={{ marginBottom: 8 }}>
        {tx.funnelNote}
      </div>
      {d.funnel.map((s) => (
        <div key={s.step} className="usage-row">
          <div className="usage-head">
            <span>{tx.steps[s.step] ?? s.step}</span>
            <span>{s.total}</span>
          </div>
          <div className="usage-bar">
            <span style={{ width: `${(s.total / max) * 100}%` }} />
          </div>
          {Object.keys(s.byPlan).length ? (
            <div className="small muted">
              {Object.entries(s.byPlan)
                .map(([p, n]) => `${PLAN_NAMES[p as PlanId] ?? p}: ${n}`)
                .join(" · ")}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const LIMIT_KEYS: (keyof Entitlements)[] = ["creator_limit", "team_seat_limit", "ai_requests", "live_monitoring_hours", "exports_limit", "history_retention_days", "recording_hours", "video_retention_days", "screenshot_limit"];

function Config({ lang, onSaved }: { lang: "en" | "fr"; onSaved: () => void }) {
  const tx = T[lang];
  const [cfg, setCfg] = useState<BillingConfig | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    billingApi.adminConfig().then(setCfg).catch(() => undefined);
  }, []);
  if (!cfg) return <div className="card muted">…</div>;

  const numInput = (value: number, onChange: (v: number) => void) => (
    <input className="input" style={{ maxWidth: 130, minHeight: 36 }} inputMode="decimal" defaultValue={String(value)} onBlur={(e) => onChange(Number(e.target.value.replace(",", ".")) || 0)} />
  );

  const save = async () => {
    setBusy(true);
    try {
      const plans = Object.fromEntries(
        PLAN_IDS.map((id) => {
          const p = cfg.plans[id];
          return [id, { available: p.available, trialDays: p.trialDays, entitlements: pick(p.entitlements), trial: pick({ ...p.entitlements, ...p.trial }, Object.keys(p.trial) as (keyof Entitlements)[]) }];
        }),
      );
      setCfg(await billingApi.saveAdminConfig({ plans, founding: { enabled: cfg.founding.enabled, capacity: cfg.founding.capacity }, costs: cfg.costs, margins: cfg.margins }));
      toast(tx.saved, "ok");
      onSaved();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  const setPlan = (id: PlanId, fn: (p: BillingConfig["plans"][PlanId]) => void) => {
    const next = structuredClone(cfg);
    fn(next.plans[id]);
    setCfg(next);
  };

  return (
    <>
      <div className="small muted">{tx.configNote}</div>
      <div className="card">
        <div className="card-title">{tx.founding}</div>
        <label className="check-row">
          <input type="checkbox" checked={cfg.founding.enabled} onChange={(e) => setCfg({ ...cfg, founding: { ...cfg.founding, enabled: e.target.checked } })} />
          <span>{tx.foundingEnabled}</span>
        </label>
        <div className="compare-row">
          <span>{tx.capacity}</span>
          {numInput(cfg.founding.capacity, (v) => setCfg({ ...cfg, founding: { ...cfg.founding, capacity: Math.round(v) } }))}
        </div>
      </div>
      {PLAN_IDS.map((id) => {
        const p = cfg.plans[id];
        return (
          <div key={id} className="card">
            <div className="card-title">{PLAN_NAMES[id]}</div>
            <label className="check-row">
              <input type="checkbox" checked={p.available} onChange={(e) => setPlan(id, (x) => void (x.available = e.target.checked))} />
              <span>{tx.available}</span>
            </label>
            <div className="compare-row">
              <span>{tx.trialDays}</span>
              {numInput(p.trialDays, (v) => setPlan(id, (x) => void (x.trialDays = Math.round(v))))}
            </div>
            {LIMIT_KEYS.map((k) => (
              <div key={k} className="compare-row">
                <span>{k}</span>
                <span className="row" style={{ gap: 6 }}>
                  {numInput(p.entitlements[k] as number, (v) => setPlan(id, (x) => void ((x.entitlements[k] as number) = v)))}
                  {k in p.trial ? (
                    <span className="small muted">
                      {tx.trialAllowance}: {numInput(p.trial[k] as number, (v) => setPlan(id, (x) => void ((x.trial[k] as number) = v)))}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        );
      })}
      <div className="card">
        <div className="card-title">{tx.costTitle}</div>
        {(Object.keys(cfg.costs) as (keyof BillingConfig["costs"])[]).map((k) => (
          <div key={k} className="compare-row">
            <span>{k}</span>
            {numInput(cfg.costs[k], (v) => setCfg({ ...cfg, costs: { ...cfg.costs, [k]: v } }))}
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-title">{tx.marginTitle}</div>
        {(["target", "watch"] as const).map((k) => (
          <div key={k} className="compare-row">
            <span>{k}</span>
            {numInput(cfg.margins[k], (v) => setCfg({ ...cfg, margins: { ...cfg.margins, [k]: v } }))}
          </div>
        ))}
      </div>
      <button className="btn gold block" onClick={save} disabled={busy}>
        {busy ? "…" : tx.save}
      </button>
    </>
  );
}

/** Only the editable, numeric/boolean entitlement keys the server accepts. */
function pick(e: Partial<Entitlements>, keys: (keyof Entitlements)[] = Object.keys(e) as (keyof Entitlements)[]): Partial<Entitlements> {
  const out: Partial<Entitlements> = {};
  for (const k of keys) if (e[k] !== undefined) (out as Record<string, unknown>)[k] = e[k];
  return out;
}
