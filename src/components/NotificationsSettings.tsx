import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushPrefs } from "../push";
import { toast } from "../store";
import { Toggle } from "./ui";

const TX = {
  en: {
    intro: "Get notified on this phone even when NOVUS is closed, with a red badge on the app icon.",
    enable: "Turn on notifications",
    on: "On for this device ✓",
    live: "A LIVE starts",
    liveHint: "When one of your streamers goes LIVE.",
    alerts: "Critical alerts",
    alertsHint: "Threats, doxxing, hate… at most one every 3 minutes per streamer.",
    summary: "LIVE summary",
    summaryHint: "When a LIVE ends: duration, messages, alerts.",
    test: "Send a test notification",
    testSent: "Sent — it should appear in a few seconds.",
    off: "Turn off on this device",
    install: "On iPhone, notifications work in the app added to the home screen: in Safari, tap Share › Add to Home Screen, then open NOVUS from its icon and come back here.",
    unsupported: "This browser doesn't support notifications.",
    denied: "Notifications are blocked for NOVUS. On iPhone: Settings › Notifications › NOVUS LIVE › Allow Notifications. Then come back here.",
    team: "Each person turns them on on their own phone. Team members only receive their own streamers.",
  },
  fr: {
    intro: "Sois prévenu sur ce téléphone même quand NOVUS est fermé, avec une pastille rouge sur l'icône de l'appli.",
    enable: "Activer les notifications",
    on: "Activées sur cet appareil ✓",
    live: "Début de LIVE",
    liveHint: "Quand un de tes livers lance un LIVE.",
    alerts: "Alertes critiques",
    alertsHint: "Menaces, doxxing, haine… au plus une toutes les 3 minutes par liver.",
    summary: "Résumé de LIVE",
    summaryHint: "À la fin d'un LIVE : durée, messages, alertes.",
    test: "Envoyer une notification test",
    testSent: "Envoyée — elle arrive dans quelques secondes.",
    off: "Désactiver sur cet appareil",
    install: "Sur iPhone, les notifications marchent dans l'appli ajoutée à l'écran d'accueil : dans Safari, touche Partager › Sur l'écran d'accueil, puis ouvre NOVUS depuis son icône et reviens ici.",
    unsupported: "Ce navigateur ne gère pas les notifications.",
    denied: "Les notifications sont bloquées pour NOVUS. Sur iPhone : Réglages › Notifications › NOVUS LIVE › Autoriser les notifications. Puis reviens ici.",
    team: "Chaque personne les active sur son propre téléphone. Les membres de l'équipe ne reçoivent que leurs livers.",
  },
};

const DEFAULTS: PushPrefs = { live: true, alerts: true, summary: true };

export function NotificationsSettings() {
  const lang = useLang();
  const tx = TX[lang];
  const [support] = useState(pushSupport);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => toast(errorText(e instanceof ApiError ? e.code : e instanceof Error ? e.message : "push_failed", lang), "warn");

  useEffect(() => {
    (async () => {
      try {
        const sub = await currentSubscription();
        if (sub) {
          const r = await api.pushStatus(sub.endpoint);
          if (r.subscribed) {
            setEndpoint(sub.endpoint);
            setPrefs(r.prefs);
          }
        }
      } catch {
        /* shows the "turn on" button */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      setPrefs(await enablePush(prefs));
      setEndpoint((await currentSubscription())?.endpoint ?? null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const change = async (key: keyof PushPrefs, value: boolean) => {
    if (!endpoint) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await api.pushPrefs(endpoint, next);
    } catch (e) {
      setPrefs(prefs);
      fail(e);
    }
  };
  const test = async () => {
    if (!endpoint) return;
    try {
      await api.pushTest(endpoint);
      toast(tx.testSent, "ok");
    } catch (e) {
      fail(e);
    }
  };
  const off = async () => {
    setBusy(true);
    await disablePush();
    setEndpoint(null);
    setBusy(false);
  };

  const message = support === "install" ? tx.install : support === "unsupported" ? tx.unsupported : support === "denied" ? tx.denied : null;
  return (
    <>
      <div className="card">
        <div className="small muted">{tx.intro}</div>
        {message ? (
          <div className="code-box" style={{ marginTop: 12 }}>
            <div className="small">{message}</div>
          </div>
        ) : loading ? (
          <div className="small muted" style={{ marginTop: 12 }}>
            …
          </div>
        ) : endpoint ? (
          <div className="state-badge good" style={{ marginTop: 12, display: "inline-block" }}>
            {tx.on}
          </div>
        ) : (
          <button className="btn gold block" style={{ marginTop: 12 }} onClick={enable} disabled={busy}>
            {busy ? "…" : `🔔 ${tx.enable}`}
          </button>
        )}
      </div>

      {endpoint ? (
        <>
          <div className="card" style={{ padding: "4px 14px" }}>
            {(["live", "alerts", "summary"] as (keyof PushPrefs)[]).map((k) => (
              <div key={k} className="list-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{tx[k]}</div>
                  <div className="small muted">{tx[`${k}Hint` as "liveHint"]}</div>
                </div>
                <Toggle label={tx[k]} on={prefs[k]} onChange={(v) => void change(k, v)} />
              </div>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={test}>
              {tx.test}
            </button>
            <button className="btn ghost" onClick={off} disabled={busy}>
              {tx.off}
            </button>
          </div>
        </>
      ) : null}
      <div className="small muted" style={{ marginTop: 14 }}>
        {tx.team}
      </div>
    </>
  );
}
