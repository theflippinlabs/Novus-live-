import { useEffect, useState } from "react";
import type { BillingMe } from "../../shared/types";
import { ApiError } from "../api";
import { billingApi, NEXT_PLAN, PLAN_NAMES, refreshBilling, track } from "../billing";
import { errorText, useLang } from "../i18n";
import { setState, toast, useStore } from "../store";
import { ChangeFounderCode } from "./FounderCode";

const TX = {
  en: {
    plan: "Plan",
    comped: "Complimentary access",
    status: {
      pending: "Not started",
      trialing: "Free trial",
      active: "Active",
      past_due: "Payment failed",
      restricted: "Read-only",
      canceled: "Canceled",
      comped: "Complimentary",
    } as Record<BillingMe["status"], string>,
    trialUntil: (d: string) => `Trial until ${d}`,
    renews: (d: string) => `Renews on ${d}`,
    endsOn: (d: string) => `Ends on ${d} (cancellation scheduled)`,
    founding: (d: string) => `Founding Agency — €149/month until ${d}, then €199/month`,
    usage: "This period",
    creators: "Monitored creators",
    seats: "Team members",
    ai: "AI reviews",
    live: "LIVE hours monitored",
    exports: "Exports",
    fairUse: "Fair-use allowances: beyond the AI allowance, local rules keep moderating.",
    seePlans: "See plans",
    change: "Change plan",
    manage: "Manage billing & invoices",
    finish: "Finish subscribing",
    full: "You're managing at full capacity.",
    growing: (n: number) => `Your agency is growing. Agency Pro supports up to ${n} creators.`,
    multi: "Managing multiple creators? Move to Agency.",
    next: (p: string) => `Move to ${p}`,
  },
  fr: {
    plan: "Offre",
    comped: "Accès offert",
    status: {
      pending: "Non démarré",
      trialing: "Essai gratuit",
      active: "Actif",
      past_due: "Paiement en échec",
      restricted: "Lecture seule",
      canceled: "Résilié",
      comped: "Offert",
    } as Record<BillingMe["status"], string>,
    trialUntil: (d: string) => `Essai jusqu'au ${d}`,
    renews: (d: string) => `Renouvellement le ${d}`,
    endsOn: (d: string) => `Se termine le ${d} (résiliation programmée)`,
    founding: (d: string) => `Founding Agency — 149 €/mois jusqu'au ${d}, puis 199 €/mois`,
    usage: "Cette période",
    creators: "Créateurs surveillés",
    seats: "Membres de l'équipe",
    ai: "Analyses IA",
    live: "Heures de LIVE surveillées",
    exports: "Exports",
    fairUse: "Quotas d'usage raisonnable : au-delà du quota IA, les règles locales continuent de modérer.",
    seePlans: "Voir les offres",
    change: "Changer d'offre",
    manage: "Gérer la facturation et les factures",
    finish: "Finaliser l'abonnement",
    full: "Vous gérez à pleine capacité.",
    growing: (n: number) => `Votre agence grandit. Agency Pro accepte jusqu'à ${n} créateurs.`,
    multi: "Vous gérez plusieurs créateurs ? Passez à Agency.",
    next: (p: string) => `Passer à ${p}`,
  },
};

function Usage({ label, used, limit, lang }: { label: string; used: number; limit: number; lang: "en" | "fr" }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const n = (v: number) => v.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
  return (
    <div className="usage-row">
      <div className="usage-head">
        <span>{label}</span>
        <span>
          {n(used)} / {n(limit)}
        </span>
      </div>
      <div className={`usage-bar ${pct >= 100 ? "full" : pct >= 80 ? "warn" : ""}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Settings › Subscription (founder): plan, status, usage vs limits, plan changes and billing portal. */
export function BillingSection() {
  const lang = useLang();
  const tx = TX[lang];
  const b = useStore((s) => s.billing);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void refreshBilling();
  }, []);
  if (!b) return <div className="card muted">…</div>;

  const date = (t?: number) => (t ? new Date(t).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
  const e = b.entitlements;
  const next = NEXT_PLAN[b.plan];
  const upsell =
    b.plan === "agency" && b.creators >= e.creator_limit - 2
      ? tx.growing(40)
      : b.creators >= e.creator_limit && e.creator_limit > 0
        ? tx.full
        : b.plan === "creator_pro" && b.creators >= 3
          ? tx.multi
          : null;

  const portal = async () => {
    setBusy(true);
    try {
      location.href = (await billingApi.portal()).url;
    } catch (err) {
      toast(errorText(err instanceof ApiError ? err.code : "internal_error", lang), "warn");
      setBusy(false);
    }
  };

  const tone = b.status === "active" || b.status === "trialing" || b.comped ? "good" : b.status === "past_due" || b.status === "restricted" || b.status === "canceled" ? "bad" : "gold";

  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 8 }}>
        <b style={{ fontSize: 18, flex: 1 }}>{PLAN_NAMES[b.plan]}</b>
        <span className={`state-badge ${tone}`}>{b.comped ? tx.comped.toUpperCase() : tx.status[b.status].toUpperCase()}</span>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {b.status === "trialing" && b.trialEndsAt ? tx.trialUntil(date(b.trialEndsAt)) : null}
        {b.status === "active" && b.currentPeriodEnd ? (b.cancelAtPeriodEnd ? tx.endsOn(date(b.currentPeriodEnd)) : tx.renews(date(b.currentPeriodEnd))) : null}
      </div>
      {b.founding && b.foundingUntil ? (
        <div className="small" style={{ color: "var(--gold)", marginTop: 4 }}>
          {tx.founding(date(b.foundingUntil))}
        </div>
      ) : null}

      <div className="card-title" style={{ marginTop: 14 }}>
        {tx.usage}
      </div>
      <Usage label={tx.creators} used={b.creators} limit={e.creator_limit} lang={lang} />
      {e.team_seat_limit > 0 ? <Usage label={tx.seats} used={b.seats} limit={e.team_seat_limit} lang={lang} /> : null}
      <Usage label={tx.ai} used={b.usage.ai_requests} limit={e.ai_requests} lang={lang} />
      <Usage label={tx.live} used={b.usage.live_monitoring_hours} limit={e.live_monitoring_hours} lang={lang} />
      <Usage label={tx.exports} used={b.usage.exports} limit={e.exports_limit} lang={lang} />
      <div className="small muted">{tx.fairUse}</div>

      {upsell && next && !b.comped ? (
        <div className="code-box" style={{ marginTop: 12 }}>
          <div className="small">{upsell}</div>
          <a className="btn sm gold" href={`/pricing?from=usage_${b.plan}`} onClick={() => track("upgrade_prompt_clicked", { plan: next, source: `usage_${b.plan}` })}>
            {tx.next(PLAN_NAMES[next])}
          </a>
        </div>
      ) : null}

      {!b.comped ? (
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          {b.status === "pending" || b.status === "canceled" ? (
            <a className="btn gold" href="/pricing?from=app">
              {tx.finish}
            </a>
          ) : (
            <a className="btn" href="/pricing?from=app">
              {tx.change}
            </a>
          )}
          {b.canManageBilling ? (
            <button className="btn ghost" onClick={portal} disabled={busy}>
              {busy ? "…" : tx.manage}
            </button>
          ) : null}
        </div>
      ) : (
        <a className="link-btn" href="/pricing?from=app" style={{ display: "inline-block", marginTop: 10 }}>
          {tx.seePlans} →
        </a>
      )}
      {b.ownCode ? <ChangeFounderCode /> : null}
    </div>
  );
}

const BANNER = {
  en: {
    past_due: "Your last payment failed. Update your payment method to keep monitoring.",
    restricted: "Your workspace is read-only: history and exports stay available. Reactivate to resume monitoring.",
    canceled: "Your subscription has ended. Your history is kept — reactivate anytime.",
    not_started: "Finish subscribing to start monitoring your LIVEs.",
    trial_quota: "You've reached your trial LIVE intelligence limit. Upgrade to continue protecting your LIVE activity.",
    trialEnds: (d: number) => (d <= 1 ? "Your free trial ends tomorrow." : `Your free trial ends in ${d} days.`),
    update: "Update payment method",
    reactivate: "Reactivate",
    upgrade: "Upgrade",
    plans: "See plans",
  },
  fr: {
    past_due: "Votre dernier paiement a échoué. Mettez à jour votre moyen de paiement pour continuer la surveillance.",
    restricted: "Votre espace est en lecture seule : historique et exports restent disponibles. Réactivez pour reprendre la surveillance.",
    canceled: "Votre abonnement est terminé. Votre historique est conservé — réactivez quand vous voulez.",
    not_started: "Finalisez votre abonnement pour démarrer la surveillance de vos LIVE.",
    trial_quota: "Vous avez atteint la limite d'intelligence LIVE de l'essai. Passez à l'offre pour continuer à protéger vos LIVE.",
    trialEnds: (d: number) => (d <= 1 ? "Votre essai gratuit se termine demain." : `Votre essai gratuit se termine dans ${d} jours.`),
    update: "Mettre à jour le paiement",
    reactivate: "Réactiver",
    upgrade: "Passer à l'offre",
    plans: "Voir les offres",
  },
};

/** App-wide billing banner for the founder: failed payment, read-only, trial ending. */
export function BillingBanner() {
  const lang = useLang();
  const tx = BANNER[lang];
  const b = useStore((s) => s.billing);
  const founder = useStore((s) => !s.me || s.me.kind === "founder");
  if (!b || b.comped || !founder) return null;
  const days = b.trialEndsAt ? Math.ceil((b.trialEndsAt - Date.now()) / 86_400_000) : null;

  let text: string | null = null;
  let bad = false;
  let action: { label: string; portal?: boolean } | null = null;
  if (b.status === "past_due") {
    text = tx.past_due;
    bad = true;
    action = { label: tx.update, portal: true };
  } else if (b.access === "restricted") {
    text = b.reason === "canceled" ? tx.canceled : b.reason === "not_started" ? tx.not_started : tx.restricted;
    bad = b.reason !== "not_started";
    action = b.reason === "payment" && b.canManageBilling ? { label: tx.update, portal: true } : { label: b.reason === "not_started" ? tx.plans : tx.reactivate };
  } else if (b.reason === "trial_quota") {
    text = tx.trial_quota;
    action = { label: tx.upgrade };
  } else if (b.status === "trialing" && days !== null && days <= 3) {
    text = tx.trialEnds(days);
  }
  if (!text) return null;

  const go = async () => {
    if (action?.portal) {
      try {
        location.href = (await billingApi.portal()).url;
        return;
      } catch {
        /* fall back to the pricing page */
      }
    }
    location.href = "/pricing?from=banner";
  };

  return (
    <div className={`billing-banner ${bad ? "bad" : ""}`} role="status">
      <span>{text}</span>
      {action ? (
        <button className="btn sm gold" onClick={() => void go()}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

const UPGRADE = {
  en: {
    plan_limit_creators: "You're managing at full capacity. Move up a plan to monitor more creators — your saved accounts are kept.",
    plan_limit_seats: "All your team seats are in use. A higher plan adds more seats.",
    plan_limit_exports: "You've used this month's exports. A higher plan includes more.",
    history_retention: "This LIVE is older than your plan's history window. It is kept — a higher plan shows more history.",
    workspace_restricted: "Your workspace is read-only. Reactivate your subscription to resume monitoring.",
    see: "See plans",
    later: "Not now",
  },
  fr: {
    plan_limit_creators: "Vous gérez à pleine capacité. Passez à l'offre supérieure pour surveiller plus de créateurs — vos comptes enregistrés sont conservés.",
    plan_limit_seats: "Toutes vos places d'équipe sont utilisées. Une offre supérieure en ajoute.",
    plan_limit_exports: "Vous avez utilisé les exports du mois. Une offre supérieure en inclut davantage.",
    history_retention: "Ce LIVE est plus ancien que l'historique de votre offre. Il est conservé — une offre supérieure affiche plus d'historique.",
    workspace_restricted: "Votre espace est en lecture seule. Réactivez votre abonnement pour reprendre la surveillance.",
    see: "Voir les offres",
    later: "Plus tard",
  },
};

/** Contextual upgrade prompt, shown when the API refuses an action because of the plan. */
export function UpgradeSheet() {
  const lang = useLang();
  const code = useStore((s) => s.upgrade);
  const plan = useStore((s) => s.billing?.plan);
  const founder = useStore((s) => !s.me || s.me.kind === "founder");
  if (!code) return null;
  const tx = UPGRADE[lang];
  const text = (tx as Record<string, string>)[code] ?? tx.plan_limit_creators;
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={() => setState({ upgrade: null })}>
      <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: 0 }}>{text}</p>
        <div className="row">
          {founder ? (
            <a className="btn gold" href={`/pricing?from=${code}`} onClick={() => track("upgrade_prompt_clicked", { plan, source: code })}>
              {tx.see}
            </a>
          ) : null}
          <button className="btn ghost" onClick={() => setState({ upgrade: null })}>
            {tx.later}
          </button>
        </div>
      </div>
    </div>
  );
}
