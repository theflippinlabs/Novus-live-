import { useEffect, useState } from "react";
import type { VideoLibrary } from "../../shared/types";
import { api } from "../api";
import { VideoCard } from "../components/VideoCard";
import { tr, useLang } from "../i18n";

const TX = {
  en: {
    intro: "Every recorded LIVE, stored in Novus. Watch it here, save it to your phone (Photos or Files), or keep it in Novus for good.",
    empty: "No LIVE video yet. Turn on recording for an account in Settings › TikTok accounts (Video option): its next LIVEs show up here.",
    all: "All accounts",
    kept: (used: string, limit: string) => `Kept for good: ${used} of ${limit} GB`,
    keptOnly: "Kept only",
  },
  fr: {
    intro: "Chaque LIVE enregistré, stocké dans Novus. Regarde-le ici, enregistre-le sur ton téléphone (Photos ou Fichiers), ou garde-le dans Novus pour de bon.",
    empty: "Pas encore de vidéo de LIVE. Active l'enregistrement d'un compte dans Réglages › Comptes TikTok (option Vidéo) : ses prochains LIVE apparaîtront ici.",
    all: "Tous les comptes",
    kept: (used: string, limit: string) => `Gardées pour de bon : ${used} sur ${limit} Go`,
    keptOnly: "Gardées seulement",
  },
};

/** More › LIVE videos: the space's LIVE videos in one place. */
export function VideosView() {
  const lang = useLang();
  const tx = TX[lang];
  const [lib, setLib] = useState<VideoLibrary | null>(null);
  const [account, setAccount] = useState("");
  const [keptOnly, setKeptOnly] = useState(false);
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .videos()
        .then((l) => alive && setLib(l))
        .catch(() => alive && setLib((l) => l ?? { videos: [], keptGb: 0, keepLimitGb: 0 }));
    load();
    // Videos being recorded grow: refresh now and then.
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!lib) return <div className="empty">…</div>;
  const accounts = [...new Set(lib.videos.map((v) => v.account))].sort();
  const shown = lib.videos.filter((v) => (!account || v.account === account) && (!keptOnly || v.kept));
  const n = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 1 });

  return (
    <>
      <div className="small muted">{tx.intro}</div>
      {lib.videos.length ? (
        <div className="row wrap small" style={{ gap: 10 }}>
          <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label={tx.all}>
            <option value="">{tx.all}</option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                @{a}
              </option>
            ))}
          </select>
          <label className="row muted" style={{ gap: 6 }}>
            <input type="checkbox" checked={keptOnly} onChange={(e) => setKeptOnly(e.target.checked)} /> ★ {tx.keptOnly}
          </label>
          {lib.keepLimitGb > 0 ? <span className="muted" style={{ marginLeft: "auto" }}>{tx.kept(n(lib.keptGb), n(lib.keepLimitGb))}</span> : null}
        </div>
      ) : null}
      {shown.length === 0 ? <div className="card muted">{tx.empty}</div> : null}
      {shown.map((v) => (
        <VideoCard key={v.sessionId} sessionId={v.sessionId} initial={v} heading={`@${v.account} · ${fmt.format(v.startedAt)}${v.title && v.title !== `@${v.account}` ? ` · ${tr(v.title, lang)}` : ""}`} />
      ))}
    </>
  );
}
