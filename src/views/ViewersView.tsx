import { useEffect, useState } from "react";
import type { ViewerListItem } from "../../shared/types";
import { api } from "../api";
import { Avatar, Segmented, SeverityBadge } from "../components/ui";
import { categoryLabel, useLang, useT } from "../i18n";
import { ago } from "../format";
import { openViewer, serverNow, useStore } from "../store";

type Sort = "risk" | "messages" | "recent";
type Filter = "all" | "flagged" | "trusted" | "watchlist" | "ignored";

export function ViewersView() {
  const t = useT();
  const lang = useLang();
  const sessionId = useStore((s) => s.session?.id);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("risk");
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<ViewerListItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .viewers({ q: q.trim() || undefined, sort, filter })
        .then((r) => alive && setList(r.viewers))
        .catch(() => undefined);
    const debounce = setTimeout(load, 200);
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [q, sort, filter, sessionId]);

  const now = serverNow();

  return (
    <div className="scroll">
      <div className="narrow">
        <input className="input" type="search" placeholder={t("searchViewers")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("searchViewers")} autoCapitalize="off" autoCorrect="off" />
        <div style={{ marginTop: 8 }}>
          <Segmented
            label={t("sortLabel")}
            value={sort}
            onChange={setSort}
            options={[
              { value: "risk", label: t("sortRisk") },
              { value: "messages", label: t("sortMessages") },
              { value: "recent", label: t("sortRecent") },
            ]}
          />
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          {(["all", "flagged", "trusted", "watchlist", "ignored"] as Filter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)} style={{ minHeight: 36 }}>
              {f === "all" ? t("all") : f === "flagged" ? t("flagged") : t(f)}
            </button>
          ))}
        </div>

        <div className="card" style={{ marginTop: 12, padding: "2px 12px" }}>
          {list.length === 0 ? <div className="empty">{t("noViewers")}</div> : null}
          {list.map((v) => {
            const topCat = (Object.entries(v.categories).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? null) as keyof typeof v.categories | null;
            return (
              <button key={v.viewer.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onClick={() => openViewer(v.viewer.id)}>
                <Avatar viewer={v.viewer} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>@{v.viewer.username}</b>
                    {v.flag ? <span className={`chip ${v.flag === "trusted" ? "on" : ""}`} style={{ minHeight: 20, fontSize: 10.5 }}>{t(v.flag)}</span> : null}
                  </div>
                  <div className="small muted">
                    {v.messageCount} {t("msgShort")} · {ago(v.lastSeen, now)}
                    {v.warnings ? ` · ${v.warnings} ⚠` : ""}
                    {topCat ? ` · ${categoryLabel(topCat, lang)}` : ""}
                  </div>
                </div>
                {v.maxRisk > 0 ? <SeverityBadge severity={v.maxRisk >= 75 ? "critical" : v.maxRisk >= 50 ? "warning" : v.maxRisk >= 25 ? "watch" : "normal"} score={v.maxRisk} compact /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
