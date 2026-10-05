import { useMemo, useState } from "react";
import { useLang } from "../i18n";
import { switchRoom, useStore } from "../store";
import type { RoomSummary, TikTokGroup } from "../../shared/types";
import { Sheet } from "./ui";
import { IconChevron } from "./Icons";

/*
 * Which account is on screen. One compact row: the current account (tap: every account, by
 * group, LIVE ones first) and quick chips for the accounts LIVE right now.
 */

const roomLabel = (r: Pick<RoomSummary, "kind" | "username">, lang: "en" | "fr") => (r.kind === "main" ? (lang === "fr" ? "Démo" : "Demo") : `@${r.username}`);
const NO_GROUPS: TikTokGroup[] = [];
const isOn = (r: RoomSummary) => r.live || Boolean(r.detected);
/** LIVE accounts first, then alphabetical; the demo room last. */
const order = (list: RoomSummary[]) =>
  [...list].sort((a, b) => Number(a.kind === "main") - Number(b.kind === "main") || Number(isOn(b)) - Number(isOn(a)) || (a.username ?? "").localeCompare(b.username ?? ""));

function Dot({ r }: { r: RoomSummary }) {
  return r.kind === "tiktok" ? <span className={`dot ${r.live ? "on" : r.detected ? "detected" : r.state === "ERROR" ? "bad" : ""}`} /> : null;
}

function RoomChip({ r, current, lang }: { r: RoomSummary; current: string; lang: "en" | "fr" }) {
  return (
    <button
      className={`room-chip ${r.id === current ? "on" : ""} ${r.live ? "live" : ""}`}
      onClick={() => switchRoom(r.id)}
      aria-current={r.id === current ? "true" : undefined}
    >
      <Dot r={r} />
      <span className="name">{roomLabel(r, lang)}</span>
      {r.openAlerts > 0 ? <span className={`count ${r.criticalAlerts > 0 ? "crit" : ""}`}>{r.openAlerts}</span> : null}
    </button>
  );
}

/** One line of an account: who, its state, its alerts. */
function AccountRow({ r, current, lang, onPick }: { r: RoomSummary; current: string; lang: "en" | "fr"; onPick: () => void }) {
  const fr = lang === "fr";
  const name = roomLabel(r, lang);
  const status =
    r.kind === "main"
      ? fr
        ? "LIVE de démonstration"
        : "Demo LIVE"
      : r.live
        ? `${fr ? "En LIVE · enregistré" : "LIVE · recorded"}${r.viewerCount ? ` · ${r.viewerCount} ${fr ? "spect." : "viewers"}` : ""}`
        : r.detected
          ? fr
            ? "En LIVE · non enregistré"
            : "LIVE · not recorded"
          : r.state === "ERROR"
            ? fr
              ? "Connexion en erreur"
              : "Connection error"
            : fr
              ? "Hors ligne"
              : "Offline";
  const on = r.id === current;
  return (
    <button
      className={`acct-row ${on ? "on" : ""} ${isOn(r) ? "is-live" : ""}`}
      onClick={() => {
        switchRoom(r.id);
        onPick();
      }}
      aria-current={on ? "true" : undefined}
    >
      <span className="acct-avatar">
        {((r.username ?? name).replace(/[^\p{L}\p{N}]/gu, "") || "?").slice(0, 2).toUpperCase()}
        <Dot r={r} />
      </span>
      <span className="acct-text">
        <span className="acct-name">{name}</span>
        <span className={`acct-status ${isOn(r) ? "live" : r.state === "ERROR" ? "bad" : ""}`}>{status}</span>
      </span>
      {r.openAlerts > 0 ? <span className={`mod-count ${r.criticalAlerts > 0 ? "hot" : ""}`}>{r.openAlerts}</span> : null}
      {on ? <span className="acct-check">✓</span> : null}
    </button>
  );
}

/** Every account: LIVE ones on top, then each group (folded, opens on tap), with a search. */
function AccountSheet({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  const fr = lang === "fr";
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const groups = useStore((s) => s.settings.tiktokGroups) ?? NO_GROUPS;
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const searching = q.trim().length > 0;
  const { live, sections, demo } = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    const match = (r: RoomSummary) => !needle || roomLabel(r, lang).toLowerCase().includes(needle);
    const tiktok = rooms.filter((r) => r.kind === "tiktok");
    const byUser = new Map(tiktok.filter((r) => r.username).map((r) => [r.username!.toLowerCase(), r]));
    const inGroup = new Set<string>();
    const out: { id: string; name: string; rooms: RoomSummary[]; live: number }[] = [];
    for (const g of groups) {
      const members = g.members.map((u) => byUser.get(u)).filter((r): r is RoomSummary => Boolean(r));
      members.forEach((r) => inGroup.add(r.id));
      const shown = order(members.filter(match));
      if (shown.length) out.push({ id: g.id, name: g.name, rooms: shown, live: shown.filter(isOn).length });
    }
    const rest = order(tiktok.filter((r) => !inGroup.has(r.id) && match(r)));
    if (rest.length) out.push({ id: "rest", name: groups.length ? (fr ? "Sans groupe" : "No group") : fr ? "Tous les comptes" : "All accounts", rooms: rest, live: rest.filter(isOn).length });
    return { live: order(tiktok.filter((r) => isOn(r) && match(r))), sections: out, demo: rooms.filter((r) => r.kind === "main" && match(r)) };
  }, [rooms, groups, q, lang, fr]);
  const toggle = (id: string) =>
    setOpened((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const total = rooms.filter((r) => r.kind === "tiktok").length;
  return (
    <Sheet onClose={onClose} label={fr ? "Comptes" : "Accounts"}>
      <div className="card-title">{fr ? "Choisir un compte" : "Pick an account"}</div>
      <div className="small muted" style={{ marginTop: -4, marginBottom: 10 }}>
        {fr ? `${total} compte${total > 1 ? "s" : ""} suivi${total > 1 ? "s" : ""} · ${live.length} en LIVE` : `${total} followed · ${live.length} LIVE`}
      </div>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={fr ? "Rechercher @compte" : "Search @account"} autoCapitalize="off" autoCorrect="off" aria-label={fr ? "Rechercher un compte" : "Search an account"} />

      {live.length ? (
        <>
          <div className="menu-group-title acct-title-live">
            <span className="dot-live" /> {fr ? "En LIVE maintenant" : "LIVE now"} · {live.length}
          </div>
          <div className="menu-group acct-live-group">
            {live.map((r) => (
              <AccountRow key={`live-${r.id}`} r={r} current={current} lang={lang} onPick={onClose} />
            ))}
          </div>
        </>
      ) : null}

      {sections.length ? <div className="menu-group-title">{groups.length ? (fr ? "Groupes" : "Groups") : fr ? "Comptes" : "Accounts"}</div> : null}
      {sections.map((s) => {
        const open = searching || opened.has(s.id) || (sections.length === 1 && !groups.length);
        return (
          <div key={s.id} className="menu-group acct-group">
            <button className="acct-group-head" onClick={() => toggle(s.id)} aria-expanded={open}>
              <span className="acct-group-name">{s.name}</span>
              <span className="acct-group-meta">
                {s.rooms.length} {fr ? "compte" : "account"}
                {s.rooms.length > 1 ? "s" : ""}
                {s.live ? <b> · {s.live} {fr ? "en LIVE" : "LIVE"}</b> : null}
              </span>
              <IconChevron className={`acct-chevron ${open ? "open" : ""}`} width={18} height={18} />
            </button>
            {open ? s.rooms.map((r) => <AccountRow key={`${s.id}-${r.id}`} r={r} current={current} lang={lang} onPick={onClose} />) : null}
          </div>
        );
      })}

      {demo.length ? (
        <>
          <div className="menu-group-title">{fr ? "Démonstration" : "Demo"}</div>
          <div className="menu-group">
            {demo.map((r) => (
              <AccountRow key={r.id} r={r} current={current} lang={lang} onPick={onClose} />
            ))}
          </div>
        </>
      ) : null}
      {!live.length && !sections.length && !demo.length ? <div className="empty">{fr ? "Aucun compte." : "No account."}</div> : null}
    </Sheet>
  );
}

export function RoomBar() {
  const lang = useLang();
  const fr = lang === "fr";
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const [open, setOpen] = useState(false);
  if (rooms.length < 2) return null;
  const cur = rooms.find((r) => r.id === current);
  const live = order(rooms.filter((r) => isOn(r) && r.id !== current));
  const totalLive = rooms.filter(isOn).length;
  return (
    <nav className="room-bar" aria-label={fr ? "Comptes" : "Accounts"}>
      <button className="room-picker" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {cur ? <Dot r={cur} /> : null}
        <span className="name">{cur ? roomLabel(cur, lang) : fr ? "Comptes" : "Accounts"}</span>
        <span className="caret">▾</span>
        {totalLive ? <span className="live-count">{totalLive} {fr ? "en LIVE" : "LIVE"}</span> : null}
      </button>
      {live.map((r) => (
        <RoomChip key={r.id} r={r} current={current} lang={lang} />
      ))}
      {open ? <AccountSheet onClose={() => setOpen(false)} /> : null}
    </nav>
  );
}
