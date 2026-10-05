import { useMemo, useState } from "react";
import { useLang } from "../i18n";
import { switchRoom, useStore } from "../store";
import type { RoomSummary, TikTokGroup } from "../../shared/types";
import { Sheet } from "./ui";

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

function RoomChip({ r, current, lang, onPick }: { r: RoomSummary; current: string; lang: "en" | "fr"; onPick?: () => void }) {
  return (
    <button
      className={`room-chip ${r.id === current ? "on" : ""} ${r.live ? "live" : ""}`}
      onClick={() => {
        switchRoom(r.id);
        onPick?.();
      }}
      aria-current={r.id === current ? "true" : undefined}
    >
      <Dot r={r} />
      <span className="name">{roomLabel(r, lang)}</span>
      {r.openAlerts > 0 ? <span className={`count ${r.criticalAlerts > 0 ? "crit" : ""}`}>{r.openAlerts}</span> : null}
    </button>
  );
}

/** Every account, by group (LIVE ones first in each), with a search. */
function AccountSheet({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  const fr = lang === "fr";
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const groups = useStore((s) => s.settings.tiktokGroups) ?? NO_GROUPS;
  const [q, setQ] = useState("");
  const sections = useMemo(() => {
    const match = (r: RoomSummary) => !q.trim() || roomLabel(r, lang).toLowerCase().includes(q.trim().toLowerCase().replace(/^@/, ""));
    const byUser = new Map(rooms.filter((r) => r.kind === "tiktok" && r.username).map((r) => [r.username!.toLowerCase(), r]));
    const inGroup = new Set<string>();
    const out: { id: string; name: string; rooms: RoomSummary[] }[] = [];
    const live = order(rooms.filter((r) => isOn(r) && match(r)));
    if (live.length) out.push({ id: "live", name: fr ? "En LIVE maintenant" : "LIVE now", rooms: live });
    for (const g of groups) {
      const members = g.members.map((u) => byUser.get(u)).filter((r): r is RoomSummary => Boolean(r));
      members.forEach((r) => inGroup.add(r.id));
      const shown = order(members.filter(match));
      if (shown.length) out.push({ id: g.id, name: g.name, rooms: shown });
    }
    const rest = order(rooms.filter((r) => !inGroup.has(r.id) && match(r)));
    if (rest.length) out.push({ id: "rest", name: groups.length ? (fr ? "Sans groupe" : "No group") : fr ? "Tous les comptes" : "All accounts", rooms: rest });
    return out;
  }, [rooms, groups, q, lang, fr]);
  return (
    <Sheet onClose={onClose} label={fr ? "Comptes" : "Accounts"}>
      <div className="card-title">{fr ? "Choisir un compte" : "Pick an account"}</div>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={fr ? "Rechercher @compte" : "Search @account"} autoCapitalize="off" autoCorrect="off" aria-label={fr ? "Rechercher un compte" : "Search an account"} />
      {sections.map((s) => (
        <div key={s.id} style={{ marginTop: 14 }}>
          <div className="small muted" style={{ marginBottom: 6, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {s.name} · {s.rooms.length}
          </div>
          <div className="chips">
            {s.rooms.map((r) => (
              <RoomChip key={`${s.id}-${r.id}`} r={r} current={current} lang={lang} onPick={onClose} />
            ))}
          </div>
        </div>
      ))}
      {!sections.length ? <div className="empty">{fr ? "Aucun compte." : "No account."}</div> : null}
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
