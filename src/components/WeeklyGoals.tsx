import { useEffect, useState } from "react";
import { GOAL_KEYS, type GoalKey, type GoalProgress, type WeeklyGoals } from "../../shared/types";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { useCan } from "../permissions";
import { setState, toast, useStore } from "../store";
import { Sheet } from "./ui";

// Live screen: the streamer's goals for the week and where they stand (running LIVE
// included), with the week's pace to tell ahead from behind. Managers set the goals.

type Lang = "en" | "fr";
const TX = {
  en: {
    title: "Weekly goals",
    reached: (a: number, b: number) => `${a}/${b} reached`,
    none: "No goal this week",
    set: "Set goals",
    edit: "Edit",
    labels: { diamonds: "Diamonds", hours: "LIVE hours", lives: "LIVEs", follows: "New followers", peakViewers: "Viewer peak" } as Record<GoalKey, string>,
    status: { done: "Reached", ahead: "Ahead", on: "On track", behind: "Behind" },
    pace: (p: number) => `${p}% of the week gone`,
    left: (d: number) => (d <= 0 ? "Last day" : `${d} day${d > 1 ? "s" : ""} left`),
    sheet: (u: string) => `Weekly goals · @${u}`,
    hint: "Leave a field empty for no goal. The week runs Monday to Sunday; LIVEs under 5 minutes don't count.",
    save: "Save",
    clear: "Clear all",
    saved: "Goals saved",
  },
  fr: {
    title: "Objectifs de la semaine",
    reached: (a: number, b: number) => `${a}/${b} atteints`,
    none: "Aucun objectif cette semaine",
    set: "Définir",
    edit: "Modifier",
    labels: { diamonds: "Diamants", hours: "Heures de LIVE", lives: "LIVE", follows: "Nouveaux abonnés", peakViewers: "Pic de spectateurs" } as Record<GoalKey, string>,
    status: { done: "Atteint", ahead: "En avance", on: "Dans les temps", behind: "En retard" },
    pace: (p: number) => `${p} % de la semaine écoulée`,
    left: (d: number) => (d <= 0 ? "Dernier jour" : `${d} jour${d > 1 ? "s" : ""} restant${d > 1 ? "s" : ""}`),
    sheet: (u: string) => `Objectifs de la semaine · @${u}`,
    hint: "Laisse un champ vide pour ne pas fixer d'objectif. La semaine va du lundi au dimanche ; les LIVE de moins de 5 minutes ne comptent pas.",
    save: "Enregistrer",
    clear: "Tout effacer",
    saved: "Objectifs enregistrés",
  },
};

type Status = keyof (typeof TX)["en"]["status"];
/** Peak viewers is a record, not a total: it is reached or not, no pace. */
function statusOf(key: GoalKey, done: number, goal: number, elapsed: number): Status {
  const pct = (done / goal) * 100;
  if (pct >= 100) return "done";
  if (key === "peakViewers") return pct >= 80 ? "on" : "behind";
  if (pct >= elapsed + 10) return "ahead";
  if (pct >= elapsed - 10) return "on";
  return "behind";
}

function GoalsSheet({ account, goals, onClose, lang }: { account: string; goals: WeeklyGoals; onClose: () => void; lang: Lang }) {
  const tx = TX[lang];
  const all = useStore((s) => s.settings.tiktokGoals) ?? {};
  const [draft, setDraft] = useState<Record<GoalKey, string>>(() => Object.fromEntries(GOAL_KEYS.map((k) => [k, goals[k] !== undefined ? String(goals[k]) : ""])) as Record<GoalKey, string>);
  const [busy, setBusy] = useState(false);

  const save = async (clear = false) => {
    const next: WeeklyGoals = {};
    if (!clear)
      for (const k of GOAL_KEYS) {
        const v = Number(draft[k].replace(",", ".").replace(/\s/g, ""));
        if (draft[k].trim() && Number.isFinite(v) && v > 0) next[k] = k === "hours" ? Math.round(v * 2) / 2 : Math.round(v);
      }
    const map = { ...all };
    if (Object.keys(next).length) map[account] = next;
    else delete map[account];
    setBusy(true);
    try {
      setState({ settings: await api.saveSettings({ tiktokGoals: map }) });
      toast(tx.saved, "ok");
      onClose();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label={tx.sheet(account)}>
      <div className="card-title" style={{ paddingRight: 48 }}>{tx.sheet(account)}</div>
      <div className="goal-form">
        {GOAL_KEYS.map((k) => (
          <label key={k} className="goal-field">
            <span>{tx.labels[k]}</span>
            <input className="input" inputMode={k === "hours" ? "decimal" : "numeric"} value={draft[k]} placeholder="—" onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>{tx.hint}</div>
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn gold" onClick={() => void save()} disabled={busy}>
          {tx.save}
        </button>
        {Object.keys(goals).length ? (
          <button className="btn ghost" onClick={() => void save(true)} disabled={busy}>
            {tx.clear}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Compact bar above the chat; expands to one progress bar per goal. */
export function WeeklyGoalsCard({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const lang = useLang();
  const tx = TX[lang];
  const room = useStore((s) => s.room);
  const goalsSetting = useStore((s) => s.settings.tiktokGoals);
  const canManage = useCan("manage_accounts");
  const [data, setData] = useState<GoalProgress | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!room.startsWith("tt:")) {
      setData(null);
      return;
    }
    let alive = true;
    const load = () =>
      api
        .goals()
        .then((d) => alive && setData(d))
        .catch(() => alive && setData(null));
    void load();
    // The running LIVE moves the numbers: refresh every 30 s.
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [room, goalsSetting]);

  if (!data) return null;
  const set = GOAL_KEYS.filter((k) => data.goals[k]);
  if (!set.length && !canManage) return null;
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const n = (v: number, k: GoalKey) => v.toLocaleString(locale, { maximumFractionDigits: k === "hours" ? 1 : 0 });
  const rows = set.map((k) => {
    const goal = data.goals[k]!;
    const done = data.done[k];
    return { k, goal, done, pct: Math.min(100, (done / goal) * 100), status: statusOf(k, done, goal, data.weekElapsed) };
  });
  const reached = rows.filter((r) => r.status === "done").length;
  const overall = rows.length ? Math.round(rows.reduce((s, r) => s + r.pct, 0) / rows.length) : 0;
  const worst: Status | null = rows.length ? (rows.some((r) => r.status === "behind") ? "behind" : rows.every((r) => r.status === "done") ? "done" : rows.some((r) => r.status === "ahead") ? "ahead" : "on") : null;
  const daysLeft = Math.ceil((data.weekEnd - Date.now()) / 86_400_000) - 1;

  return (
    <div className={`goals-card ${open ? "open" : ""}`}>
      <div className="goals-head">
        <button className="goals-toggle" onClick={() => rows.length && setOpen((o) => !o)} aria-expanded={open} disabled={!rows.length}>
          <span className="goals-ring" style={{ ["--p" as string]: `${overall}%` }} aria-hidden="true">
            <span>{rows.length ? `${overall}%` : "—"}</span>
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <b className="ellipsis" style={{ display: "block" }}>{tx.title}</b>
            <span className="small muted goals-sub">
              {worst ? <span className={`goal-status ${worst}`}>{tx.status[worst]}</span> : null}
              {rows.length ? `${tx.reached(reached, rows.length)} · ${tx.left(daysLeft)}` : tx.none}
            </span>
          </span>
        </button>
        {canManage ? (
          <button className="btn sm ghost goals-edit" onClick={() => setEditing(true)} aria-label={rows.length ? tx.edit : tx.set} title={rows.length ? tx.edit : tx.set}>
            {rows.length ? "✎" : `+ ${tx.set}`}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="goals-list">
          {rows.map((r) => (
            <div key={r.k} className="goal-row">
              <div className="goal-line">
                <span>{tx.labels[r.k]}</span>
                <span>
                  <b>{n(r.done, r.k)}</b>
                  <span className="muted"> / {n(r.goal, r.k)}</span>
                  <span className={`goal-status ${r.status}`}>{tx.status[r.status]}</span>
                </span>
              </div>
              <div className="goal-bar">
                <span className={r.status} style={{ width: `${Math.max(2, r.pct)}%` }} />
                {r.k !== "peakViewers" ? <i style={{ left: `${data.weekElapsed}%` }} title={tx.pace(data.weekElapsed)} /> : null}
              </div>
            </div>
          ))}
          <div className="small muted">▏{tx.pace(data.weekElapsed)}</div>
        </div>
      ) : null}
      {editing ? <GoalsSheet account={data.account} goals={data.goals} onClose={() => setEditing(false)} lang={lang} /> : null}
    </div>
  );
}
