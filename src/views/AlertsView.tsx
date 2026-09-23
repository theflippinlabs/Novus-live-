import { useMemo, useState } from "react";
import { AlertCard } from "../components/AlertCard";
import { Segmented } from "../components/ui";
import { useT } from "../i18n";
import { useStore } from "../store";

type Filter = "open" | "watching" | "closed" | "all";

export function AlertsView() {
  const t = useT();
  const alerts = useStore((s) => s.alerts);
  const [filter, setFilter] = useState<Filter>("open");
  const [limit, setLimit] = useState(40);

  const counts = useMemo(() => {
    const c = { open: 0, watching: 0, closed: 0, all: alerts.length };
    for (const a of alerts) {
      if (a.status === "open") c.open++;
      else if (a.status === "watching") c.watching++;
      else c.closed++;
    }
    return c;
  }, [alerts]);

  const list = useMemo(
    () =>
      alerts.filter((a) =>
        filter === "all" ? true : filter === "closed" ? a.status === "resolved" || a.status === "dismissed" : a.status === filter,
      ),
    [alerts, filter],
  );

  return (
    <div className="scroll">
      <div className="narrow">
        <Segmented
          label="Alert filter"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setLimit(40);
          }}
          gold
          options={[
            { value: "open", label: `${t("open")} ${counts.open}` },
            { value: "watching", label: `${t("watching")} ${counts.watching}` },
            { value: "closed", label: `${t("resolved")} ${counts.closed}` },
            { value: "all", label: t("all") },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          {list.length === 0 ? <div className="empty">{t("noAlerts")}</div> : null}
          {list.slice(0, limit).map((a) => (
            <AlertCard key={a.id} alert={a} />
          ))}
          {list.length > limit ? (
            <button className="btn block" style={{ marginTop: 12 }} onClick={() => setLimit((l) => l + 40)}>
              +{list.length - limit}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
