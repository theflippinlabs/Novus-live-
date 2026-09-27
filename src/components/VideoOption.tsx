import { useEffect, useState } from "react";
import type { VideoPack, VideoPackId } from "../../shared/plans";
import { ApiError } from "../api";
import { billingApi, euro, refreshBilling } from "../billing";
import { errorText, useLang } from "../i18n";
import { toast, useStore } from "../store";

const TX = {
  en: {
    title: "Video option",
    intro: "Records the LIVEs of the accounts you choose in video (480p), kept for 30 days, to watch or download from the History.",
    caps: "Hard caps: recording stops when the month's hours or gigabytes are used — never an extra charge.",
    hours: "Video hours this month",
    gb: "Video storage this month (GB)",
    perMonth: "/month",
    perYear: "/year",
    pack: (h: number) => `${h} h of video`,
    detail: (gb: number, days: number) => `up to ${gb} GB · kept ${days} days`,
    choose: "Add",
    switch: "Switch to this pack",
    current: "Your pack",
    remove: "Remove the option",
    confirmRemove: "Remove the Video option? Recording stops; videos already saved stay until their retention ends.",
    confirmBuy: (name: string, price: string) => `Add ${name} for ${price}? It's added to your subscription (prorated today).`,
    pending: "Request sent — the option switches on as soon as Stripe confirms it.",
    included: "Included in your plan.",
    granted: "Offered to your space.",
    comped: "Not included in this complimentary access. Ask the Novus team to enable it.",
    trial: "Available once your trial has ended.",
    founderOnly: "Only the workspace founder can change the option.",
    howTo: "Then turn “VIDEO” on for each account in Settings › TikTok accounts (with the streamer's consent).",
  },
  fr: {
    title: "Option Vidéo",
    intro: "Enregistre en vidéo (480p) les LIVE des comptes que tu choisis, conservés 30 jours, à regarder ou télécharger depuis l'Historique.",
    caps: "Plafonds stricts : l'enregistrement s'arrête quand les heures ou les Go du mois sont utilisés — jamais de supplément facturé.",
    hours: "Heures de vidéo ce mois",
    gb: "Stockage vidéo ce mois (Go)",
    perMonth: "/mois",
    perYear: "/an",
    pack: (h: number) => `${h} h de vidéo`,
    detail: (gb: number, days: number) => `jusqu'à ${gb} Go · conservée ${days} jours`,
    choose: "Ajouter",
    switch: "Passer à ce pack",
    current: "Ton pack",
    remove: "Retirer l'option",
    confirmRemove: "Retirer l'option Vidéo ? L'enregistrement s'arrête ; les vidéos déjà faites restent jusqu'à la fin de leur conservation.",
    confirmBuy: (name: string, price: string) => `Ajouter ${name} pour ${price} ? C'est ajouté à ton abonnement (au prorata dès aujourd'hui).`,
    pending: "Demande envoyée — l'option s'active dès que Stripe la confirme.",
    included: "Incluse dans ton offre.",
    granted: "Offerte à ton espace.",
    comped: "Non incluse dans cet accès offert. Demande à l'équipe Novus de l'activer.",
    trial: "Disponible une fois l'essai terminé.",
    founderOnly: "Seul le fondateur de l'espace peut changer l'option.",
    howTo: "Ensuite, active « VIDÉO » pour chaque compte dans Réglages › Comptes TikTok (avec l'accord du liver).",
  },
};

/** Settings › Subscription: the Video option (packs, usage against its caps, add / switch / remove). */
export function VideoOption() {
  const lang = useLang();
  const tx = TX[lang];
  const b = useStore((s) => s.billing);
  const founder = useStore((s) => !s.me || s.me.kind === "founder");
  const [packs, setPacks] = useState<VideoPack[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void billingApi.plans().then((p) => setPacks(p.video ?? [])).catch(() => undefined);
  }, []);
  if (!b) return null;
  const v = b.video;
  const e = b.entitlements;
  const yearly = b.cycle === "year";
  const price = (p: VideoPack) => `${euro(yearly ? p.yearly : p.monthly, lang)}${yearly ? tx.perYear : tx.perMonth}`;

  const change = async (pack: VideoPackId | null, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await billingApi.setVideoPack(pack);
      toast(tx.pending, "ok");
      // Stripe's webhook activates the pack a moment later.
      setTimeout(() => void refreshBilling(), 3000);
      setTimeout(() => void refreshBilling(), 8000);
    } catch (err) {
      toast(errorText(err instanceof ApiError ? err.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  const status = v.included ? tx.included : v.granted ? tx.granted : null;
  const n = (x: number) => x.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 });

  return (
    <div className="card video-option">
      <div className="row wrap" style={{ gap: 8 }}>
        <b style={{ flex: 1 }}>◉ {tx.title}</b>
        {e.recording ? <span className="state-badge good">{v.pack ? packs.find((p) => p.id === v.pack)?.hours ?? "" : ""}{v.pack ? " h" : "ON"}</span> : null}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>{tx.intro}</div>
      {status ? <div className="small" style={{ color: "var(--gold)", marginTop: 6 }}>{status}</div> : null}

      {e.recording ? (
        <div style={{ marginTop: 10 }}>
          <UsageBar label={tx.hours} used={b.usage.recording_hours} limit={e.recording_hours} fmt={n} />
          <UsageBar label={tx.gb} used={b.usage.video_gb ?? 0} limit={e.video_storage_gb} fmt={n} />
          <div className="small muted">{tx.howTo}</div>
        </div>
      ) : null}

      {!v.included && !v.granted ? (
        <>
          <div className="video-packs">
            {packs.map((p) => {
              const mine = v.pack === p.id;
              return (
                <div key={p.id} className={`video-pack ${mine ? "mine" : ""}`}>
                  <div className="video-pack-hours">{tx.pack(p.hours)}</div>
                  <div className="video-pack-price">{price(p)}</div>
                  <div className="small muted">{tx.detail(p.storage_gb, p.retention_days)}</div>
                  {mine ? (
                    <span className="small" style={{ color: "var(--gold)" }}>{tx.current}</span>
                  ) : v.canBuy ? (
                    <button className="btn sm gold" disabled={busy} onClick={() => void change(p.id, tx.confirmBuy(tx.pack(p.hours), price(p)))}>
                      {v.pack ? tx.switch : tx.choose}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>{tx.caps}</div>
          {!v.canBuy ? (
            <div className="small muted" style={{ marginTop: 6 }}>
              {!founder ? tx.founderOnly : b.comped ? tx.comped : b.status === "trialing" ? tx.trial : null}
            </div>
          ) : null}
          {v.pack && v.canBuy ? (
            <button className="btn sm ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => void change(null, tx.confirmRemove)}>
              {tx.remove}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function UsageBar({ label, used, limit, fmt }: { label: string; used: number; limit: number; fmt: (n: number) => string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  return (
    <div className="usage-row">
      <div className="usage-head">
        <span>{label}</span>
        <span>
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <div className={`usage-bar ${pct >= 100 ? "full" : pct >= 80 ? "warn" : ""}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
