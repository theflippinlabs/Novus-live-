import type { ComponentType, SVGProps } from "react";
import { useT, type TKey } from "../i18n";
import { navigate, useStore, type View } from "../store";
import { IconAlert, IconChart, IconGear, IconLive, IconSpark, IconUsers } from "./Icons";

const TABS: { view: View; label: TKey; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { view: "live", label: "live", Icon: IconLive },
  { view: "alerts", label: "alerts", Icon: IconAlert },
  { view: "viewers", label: "viewers", Icon: IconUsers },
  { view: "assistant", label: "assistant", Icon: IconSpark },
  { view: "analytics", label: "analytics", Icon: IconChart },
  { view: "settings", label: "settings", Icon: IconGear },
];

export function BottomNav() {
  const t = useT();
  const view = useStore((s) => s.view);
  const open = useStore((s) => s.stats.openAlerts);
  const critical = useStore((s) => s.stats.criticalAlerts);
  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map(({ view: v, label, Icon }) => (
        <button key={v} className={`nav-btn ${view === v ? "active" : ""}`} onClick={() => navigate(v)} aria-current={view === v ? "page" : undefined}>
          <Icon />
          {t(label)}
          {v === "alerts" && open > 0 ? <span className={`badge ${critical ? "" : "soft"}`}>{open > 99 ? "99+" : open}</span> : null}
        </button>
      ))}
    </nav>
  );
}
