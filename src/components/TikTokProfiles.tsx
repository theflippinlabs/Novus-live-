import { useState } from "react";
import { api, ApiError } from "../api";
import { useLang } from "../i18n";
import { setState, toast, useStore } from "../store";

const TEXT = {
  en: {
    title: "TikTok profiles",
    following: "FOLLOWING",
    follow: "Follow",
    stop: "Stop following",
    add: "Add",
    remove: "Remove",
    placeholder: "@handle",
    empty: "No profile yet — add the TikTok accounts you want Novus to follow.",
    hint: "Tap Follow on the account that is going LIVE. Novus follows one profile at a time.",
    switchTo: "Switch profile",
  },
  fr: {
    title: "Profils TikTok",
    following: "SUIVI",
    follow: "Suivre",
    stop: "Arrêter le suivi",
    add: "Ajouter",
    remove: "Retirer",
    placeholder: "@pseudo",
    empty: "Aucun profil — ajoute les comptes TikTok que Novus doit suivre.",
    hint: "Touche Suivre sur le compte qui va passer en LIVE. Novus suit un profil à la fois.",
    switchTo: "Changer de profil",
  },
};

const clean = (s: string) => s.trim().replace(/^@/, "");
const valid = (s: string) => /^[A-Za-z0-9._]{2,64}$/.test(s);

function useTikTokProfiles() {
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.tiktok?.username ?? "");
  const saved = settings.tiktokProfiles ?? [];
  const profiles = active && !saved.includes(active) ? [...saved, active] : saved;
  return { profiles, active };
}

async function followProfile(username: string) {
  try {
    const s = await api.tiktokConnect(username);
    setState({ tiktok: s });
    const settings = await api.settings();
    setState({ settings });
    toast(`@${s.username}`, "ok");
  } catch (e) {
    toast(e instanceof ApiError ? e.code : "Error", "warn");
  }
}

/** Compact switcher shown on the Live screen while waiting for a LIVE. */
export function ProfileSwitcher() {
  const lang = useLang();
  const { profiles, active } = useTikTokProfiles();
  const [busy, setBusy] = useState(false);
  if (profiles.length < 2) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>
        {TEXT[lang].switchTo}
      </div>
      <div className="chips" style={{ justifyContent: "center" }}>
        {profiles.map((p) => (
          <button
            key={p}
            className={`chip ${p === active ? "on" : ""}`}
            disabled={busy || p === active}
            onClick={async () => {
              setBusy(true);
              await followProfile(p);
              setBusy(false);
            }}
          >
            @{p}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Full profile manager (Settings › TikTok Integration). */
export function TikTokProfiles() {
  const lang = useLang();
  const tx = TEXT[lang];
  const { profiles, active } = useTikTokProfiles();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const saveList = async (tiktokProfiles: string[]) => {
    try {
      setState({ settings: await api.saveSettings({ tiktokProfiles }) });
    } catch (e) {
      toast(e instanceof ApiError ? e.code : "Error", "warn");
    }
  };

  const add = () =>
    run(async () => {
      const name = clean(draft);
      if (!valid(name)) return;
      setDraft("");
      if (!profiles.includes(name)) await saveList([...profiles, name]);
      if (!active) await followProfile(name);
    });

  const remove = (name: string) =>
    run(async () => {
      if (name === active) setState({ tiktok: await api.tiktokDisconnect() });
      await saveList(profiles.filter((p) => p !== name));
    });

  const stop = () =>
    run(async () => {
      setState({ tiktok: await api.tiktokDisconnect() });
    });

  return (
    <>
      <div className="card-title" style={{ marginTop: 14 }}>
        {tx.title}
      </div>
      {profiles.length === 0 ? <div className="small muted">{tx.empty}</div> : null}
      {profiles.map((p) => (
        <div key={p} className="list-row">
          <div style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>@{p}</div>
          {p === active ? (
            <span className="state-badge good">{tx.following}</span>
          ) : (
            <button className="btn sm gold" disabled={busy} onClick={() => run(() => followProfile(p))}>
              {tx.follow}
            </button>
          )}
          <button className="btn sm ghost" disabled={busy} onClick={() => remove(p)} aria-label={`${tx.remove} @${p}`} title={tx.remove}>
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          className="input"
          placeholder={tx.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          aria-label="TikTok username"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button className="btn" onClick={add} disabled={busy || !valid(clean(draft))}>
          + {tx.add}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {tx.hint}
      </div>
      {active ? (
        <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={stop}>
          {tx.stop}
        </button>
      ) : null}
    </>
  );
}
