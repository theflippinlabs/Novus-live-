import { useLang } from "../i18n";
import { switchRoom, useStore } from "../store";
import type { RoomSummary } from "../../shared/types";

const roomLabel = (r: Pick<RoomSummary, "kind" | "username">, lang: "en" | "fr") =>
  r.kind === "main" ? (lang === "fr" ? "Démo" : "Demo") : `@${r.username}`;

/** One chip per moderation room; every followed account is watched at the same time. */
export function RoomBar() {
  const lang = useLang();
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  if (rooms.length < 2) return null;
  // TikTok accounts first (LIVE ones leading), the demo room last.
  const ordered = [...rooms].sort((a, b) => Number(a.kind === "main") - Number(b.kind === "main") || Number(b.live) - Number(a.live));
  return (
    <nav className="room-bar" aria-label={lang === "fr" ? "Comptes" : "Accounts"}>
      {ordered.map((r) => (
        <button
          key={r.id}
          className={`room-chip ${r.id === current ? "on" : ""} ${r.live ? "live" : ""}`}
          onClick={() => switchRoom(r.id)}
          aria-current={r.id === current ? "true" : undefined}
        >
          {r.kind === "tiktok" ? <span className={`dot ${r.live ? "on" : r.state === "ERROR" ? "bad" : ""}`} /> : null}
          <span className="name">{roomLabel(r, lang)}</span>
          {r.openAlerts > 0 ? <span className={`count ${r.criticalAlerts > 0 ? "crit" : ""}`}>{r.openAlerts}</span> : null}
        </button>
      ))}
    </nav>
  );
}
