import { useState } from "react";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { setState, switchRoom, toast, useStore } from "../store";

const TEXT = {
  en: {
    title: "Followed TikTok accounts",
    live: "LIVE",
    waiting: "WAITING",
    error: "RETRYING",
    open: "Open",
    current: "ON SCREEN",
    add: "Add",
    remove: "Remove",
    confirmRemove: (u: string) => `Stop following @${u}? Its running LIVE session (if any) will be closed.`,
    placeholder: "@handle",
    empty: "No account yet — add the TikTok accounts you moderate.",
    hint: "Novus watches every account at the same time and joins each LIVE automatically. Each account has its own chat, alerts and report — switch with the bar at the top.",
  },
  fr: {
    title: "Comptes TikTok suivis",
    live: "EN LIVE",
    waiting: "EN ATTENTE",
    error: "NOUVEL ESSAI",
    open: "Ouvrir",
    current: "À L'ÉCRAN",
    add: "Ajouter",
    remove: "Retirer",
    confirmRemove: (u: string) => `Ne plus suivre @${u} ? Son LIVE en cours dans Novus (s'il y en a un) sera clôturé.`,
    placeholder: "@pseudo",
    empty: "Aucun compte — ajoute les comptes TikTok que tu modères.",
    hint: "Novus surveille tous les comptes en même temps et rejoint chaque LIVE automatiquement. Chaque compte a son propre chat, ses alertes et son rapport — passe de l'un à l'autre avec la barre en haut.",
  },
};

const NO_PROFILES: string[] = [];
const clean = (s: string) => s.trim().replace(/^@/, "");
const valid = (s: string) => /^[A-Za-z0-9._]{2,64}$/.test(s);

/** Profile manager (Settings › TikTok Integration): add / open / remove followed accounts. */
export function TikTokProfiles() {
  const lang = useLang();
  const tx = TEXT[lang];
  const profiles = useStore((s) => s.settings.tiktokProfiles) ?? NO_PROFILES;
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      const name = clean(draft);
      if (!valid(name)) return;
      setDraft("");
      const res = await api.tiktokConnect(name);
      setState({ settings: await api.settings(), rooms: (await api.rooms()).rooms });
      toast(`@${name}`, "ok");
      if (res.room !== current) switchRoom(res.room);
    });

  const remove = (name: string) => {
    if (!window.confirm(tx.confirmRemove(name))) return;
    void run(async () => {
      const next = profiles.filter((p) => p.toLowerCase() !== name.toLowerCase());
      setState({ settings: await api.saveSettings({ tiktokProfiles: next }), rooms: (await api.rooms()).rooms });
      if (current === `tt:${name.toLowerCase()}`) switchRoom("main");
    });
  };

  return (
    <>
      <div className="card-title" style={{ marginTop: 14 }}>
        {tx.title}
      </div>
      {profiles.length === 0 ? <div className="small muted">{tx.empty}</div> : null}
      {profiles.map((p) => {
        const id = `tt:${p.toLowerCase()}`;
        const room = rooms.find((r) => r.id === id);
        const badge = room?.live ? { cls: "bad", text: tx.live } : room?.state === "ERROR" ? { cls: "bad", text: tx.error } : { cls: "gold", text: tx.waiting };
        return (
          <div key={p} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>@{p}</div>
              <span className={`state-badge ${badge.cls}`} style={{ fontSize: 10, marginTop: 4 }}>
                {badge.text}
              </span>
            </div>
            {id === current ? (
              <span className="small muted">{tx.current}</span>
            ) : (
              <button className="btn sm gold" disabled={busy || !room} onClick={() => switchRoom(id)}>
                {tx.open}
              </button>
            )}
            <button className="btn sm ghost" disabled={busy} onClick={() => remove(p)} aria-label={`${tx.remove} @${p}`} title={tx.remove}>
              ✕
            </button>
          </div>
        );
      })}
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
    </>
  );
}
