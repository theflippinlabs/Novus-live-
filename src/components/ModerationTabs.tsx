import { useLang } from "../i18n";
import { navigate, useStore } from "../store";
import { IconAlert, IconShield, IconUsers } from "./Icons";

/** Top switch of the Moderation tab: dashboard, alerts, viewers (the views of the same job). */
export function ModerationTabs() {
  const lang = useLang();
  const view = useStore((s) => s.view);
  const open = useStore((s) => s.stats.openAlerts);
  const critical = useStore((s) => s.stats.criticalAlerts);
  const fr = lang === "fr";
  return (
    <div className="mod-tabs three" role="tablist" aria-label={fr ? "Modération" : "Moderation"}>
      <button role="tab" aria-selected={view === "moderation"} className={view === "moderation" ? "on" : ""} onClick={() => navigate("moderation")}>
        <IconShield width={17} height={17} />
        {fr ? "Tableau" : "Overview"}
      </button>
      <button role="tab" aria-selected={view === "alerts"} className={view === "alerts" ? "on" : ""} onClick={() => navigate("alerts")}>
        <IconAlert width={17} height={17} />
        {fr ? "Alertes" : "Alerts"}
        {open > 0 ? <span className={`mod-count ${critical ? "hot" : ""}`}>{open > 99 ? "99+" : open}</span> : null}
      </button>
      <button role="tab" aria-selected={view === "viewers"} className={view === "viewers" ? "on" : ""} onClick={() => navigate("viewers")}>
        <IconUsers width={17} height={17} />
        {fr ? "Spectateurs" : "Viewers"}
      </button>
    </div>
  );
}
