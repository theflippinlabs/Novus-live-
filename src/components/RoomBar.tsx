import { useMemo, useState } from "react";
import { useLang } from "../i18n";
import { switchRoom, useStore } from "../store";
import type { RoomSummary, TikTokGroup } from "../../shared/types";

const roomLabel = (r: Pick<RoomSummary, "kind" | "username">, lang: "en" | "fr") =>
  r.kind === "main" ? (lang === "fr" ? "Démo" : "Demo") : `@${r.username}`;

const ALL = "all";
const UNGROUPED = "none";
const NO_GROUPS: TikTokGroup[] = [];

function savedGroup(): string {
  try {
    return localStorage.getItem("novus:group") ?? ALL;
  } catch {
    return ALL;
  }
}

function RoomChip({ r, current, lang }: { r: RoomSummary; current: string; lang: "en" | "fr" }) {
  return (
    <button
      className={`room-chip ${r.id === current ? "on" : ""} ${r.live ? "live" : ""}`}
      onClick={() => switchRoom(r.id)}
      aria-current={r.id === current ? "true" : undefined}
    >
      {r.kind === "tiktok" ? <span className={`dot ${r.live ? "on" : r.state === "ERROR" ? "bad" : ""}`} /> : null}
      <span className="name">{roomLabel(r, lang)}</span>
      {r.openAlerts > 0 ? <span className={`count ${r.criticalAlerts > 0 ? "crit" : ""}`}>{r.openAlerts}</span> : null}
    </button>
  );
}

/**
 * One chip per moderation room; every followed account is watched at the same time.
 * With groups, a first row picks the group and the second shows its accounts.
 */
export function RoomBar() {
  const lang = useLang();
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const groups = useStore((s) => s.settings.tiktokGroups) ?? NO_GROUPS;
  const [picked, setPicked] = useState(savedGroup);

  const grouped = useMemo(() => {
    const byUser = new Map(rooms.filter((r) => r.kind === "tiktok" && r.username).map((r) => [r.username!.toLowerCase(), r]));
    const inGroup = new Set<string>();
    const list = groups.map((g) => {
      const members = g.members.map((u) => byUser.get(u)).filter((r): r is RoomSummary => Boolean(r));
      members.forEach((r) => inGroup.add(r.id));
      return { id: g.id, name: g.name, rooms: members };
    });
    const rest = rooms.filter((r) => r.kind === "tiktok" && !inGroup.has(r.id));
    return { list, rest };
  }, [rooms, groups]);

  if (rooms.length < 2) return null;
  // TikTok accounts first (LIVE ones leading), the demo room last.
  const order = (list: RoomSummary[]) => [...list].sort((a, b) => Number(a.kind === "main") - Number(b.kind === "main") || Number(b.live) - Number(a.live));
  const label = lang === "fr" ? "Comptes" : "Accounts";

  if (!grouped.list.length) {
    return (
      <nav className="room-bar" aria-label={label}>
        {order(rooms).map((r) => (
          <RoomChip key={r.id} r={r} current={current} lang={lang} />
        ))}
      </nav>
    );
  }

  const active = picked === UNGROUPED ? (grouped.rest.length ? UNGROUPED : ALL) : grouped.list.some((g) => g.id === picked) ? picked : ALL;
  const pick = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem("novus:group", id);
    } catch {
      /* private mode */
    }
  };
  const shown = active === ALL ? order(rooms) : active === UNGROUPED ? order(grouped.rest) : order(grouped.list.find((g) => g.id === active)!.rooms);
  const tabs = [
    { id: ALL, name: lang === "fr" ? "Tous" : "All", rooms },
    ...grouped.list,
    ...(grouped.rest.length ? [{ id: UNGROUPED, name: lang === "fr" ? "Sans groupe" : "No group", rooms: grouped.rest }] : []),
  ];

  return (
    <>
      <nav className="room-bar group-bar" aria-label={lang === "fr" ? "Groupes" : "Groups"}>
        {tabs.map((g) => {
          const live = g.rooms.filter((r) => r.live).length;
          return (
            <button key={g.id} className={`group-tab ${g.id === active ? "on" : ""}`} onClick={() => pick(g.id)} aria-pressed={g.id === active}>
              <span className="name">{g.name}</span>
              {live ? <span className="live-count" title={lang === "fr" ? `${live} en LIVE` : `${live} LIVE`}>{live}</span> : null}
            </button>
          );
        })}
      </nav>
      <nav className="room-bar" aria-label={label}>
        {shown.map((r) => (
          <RoomChip key={r.id} r={r} current={current} lang={lang} />
        ))}
        {!shown.length ? <span className="small muted">{lang === "fr" ? "Aucun compte dans ce groupe." : "No account in this group."}</span> : null}
      </nav>
    </>
  );
}
