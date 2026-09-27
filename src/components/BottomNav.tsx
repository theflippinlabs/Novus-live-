import type { ComponentType, SVGProps } from "react";
import { useLang, useT } from "../i18n";
import { navigate, useStore, type View } from "../store";
import { IconChart, IconGear, IconLive, IconShield } from "./Icons";

/*
 * Five tabs, like the best iPhone apps: the LIVE, moderation (alerts + viewers), the
 * copilot in the middle (the flagship, one thumb away), stats and settings.
 */

type Tab = { key: string; views: View[]; go: View; Icon: ComponentType<SVGProps<SVGSVGElement>>; label: { en: string; fr: string } };

const LEFT: Tab[] = [
  { key: "live", views: ["live"], go: "live", Icon: IconLive, label: { en: "Live", fr: "Live" } },
  { key: "moderation", views: ["alerts", "viewers"], go: "alerts", Icon: IconShield, label: { en: "Moderation", fr: "Modération" } },
];
const RIGHT: Tab[] = [
  { key: "analytics", views: ["analytics"], go: "analytics", Icon: IconChart, label: { en: "Stats", fr: "Stats" } },
  { key: "settings", views: ["settings", "admin"], go: "settings", Icon: IconGear, label: { en: "Settings", fr: "Réglages" } },
];

export function BottomNav() {
  const t = useT();
  const lang = useLang();
  const view = useStore((s) => s.view);
  const open = useStore((s) => s.stats.openAlerts);
  const critical = useStore((s) => s.stats.criticalAlerts);
  const live = useStore((s) => s.session?.status === "live");
  // Back to the moderation screen used last (alerts or viewers).
  const lastModeration = useStore((s) => s.lastModeration);

  const button = (tab: Tab) => {
    const active = tab.views.includes(view);
    const target = tab.key === "moderation" ? lastModeration : tab.go;
    return (
      <button key={tab.key} className={`nav-btn ${active ? "active" : ""}`} onClick={() => navigate(target)} aria-current={active ? "page" : undefined}>
        <tab.Icon />
        {tab.label[lang]}
        {tab.key === "moderation" && open > 0 ? <span className={`badge ${critical ? "" : "soft"}`}>{open > 99 ? "99+" : open}</span> : null}
        {tab.key === "live" && live ? <span className="nav-live-dot" aria-label="LIVE" /> : null}
      </button>
    );
  };

  const copilotActive = view === "assistant";
  return (
    <nav className="bottom-nav" aria-label={t("mainNav")}>
      {LEFT.map(button)}
      <button className={`nav-btn nav-center ${copilotActive ? "active" : ""}`} onClick={() => navigate("assistant")} aria-current={copilotActive ? "page" : undefined}>
        <span className="nav-orb" aria-hidden="true">
          ✦
        </span>
        {lang === "fr" ? "Copilote" : "Copilot"}
      </button>
      {RIGHT.map(button)}
    </nav>
  );
}
