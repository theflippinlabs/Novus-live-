import { useEffect, useState } from "react";
import { GOAL_KEYS, TIER_KEYS, type GoalKey, type GoalProgress, type RewardTier, type TierKey, type TierProgram, type TierProgress, type WeeklyGoals } from "../../shared/types";
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
    tiers: "TikTok tiers",
    tierNow: (p: string) => `Tier ${p}`,
    tierNone: "No tier yet",
    tierNext: (p: string) => `Next: ${p}`,
    tierTop: "Top tier reached",
    tierPeriod: { week: "this week", month: "this month" },
    tierMissing: "Still needed",
    tierKeys: { validDays: "valid days", hours: "LIVE hours", diamonds: "diamonds", follows: "new followers" } as Record<TierKey, string>,
    tierEst: (m: number, src: string) => `Estimated by Novus from the LIVEs it followed (a valid day = ${m} min of LIVE). TikTok's own count (Backstage) is the reference. ${src}`,
    tierSrc: { all: "Tiers of the whole agency.", account: "Tiers specific to this streamer." },
    setTiers: "TikTok tiers",
    tierSheet: "TikTok reward tiers",
    tierHint: "Copy the tiers shown in TikTok (Backstage / LIVE Center): the reward % and what each tier requires. TikTok offers no API for them, so Novus can't read them itself.",
    tierPeriodLabel: "Period",
    tierValidLabel: "Minutes for a valid day",
    tierPercent: "Reward %",
    addTier: "+ Add a tier",
    removeTier: "Remove",
    scope: "Apply to",
    scopeAll: "All streamers",
    scopeOne: (u: string) => `@${u} only`,
    week: "Week",
    month: "Month",
    removeAll: "Delete these tiers",
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
    tiers: "Paliers TikTok",
    tierNow: (p: string) => `Palier ${p}`,
    tierNone: "Aucun palier atteint",
    tierNext: (p: string) => `Prochain : ${p}`,
    tierTop: "Palier max atteint",
    tierPeriod: { week: "cette semaine", month: "ce mois-ci" },
    tierMissing: "Il manque",
    tierKeys: { validDays: "jours valides", hours: "heures de LIVE", diamonds: "diamants", follows: "nouveaux abonnés" } as Record<TierKey, string>,
    tierEst: (m: number, src: string) => `Estimation Novus à partir des LIVE qu'il a suivis (jour valide = ${m} min de LIVE). Le décompte de TikTok (Backstage) fait foi. ${src}`,
    tierSrc: { all: "Paliers de toute l'agence.", account: "Paliers propres à ce liver." },
    setTiers: "Paliers TikTok",
    tierSheet: "Paliers de rémunération TikTok",
    tierHint: "Recopie les paliers affichés par TikTok (Backstage / LIVE Center) : le % de rémunération et ce que demande chaque palier. TikTok ne fournit pas d'API pour les lire, Novus ne peut donc pas les récupérer seul.",
    tierPeriodLabel: "Période",
    tierValidLabel: "Minutes pour un jour valide",
    tierPercent: "% de rémunération",
    addTier: "+ Ajouter un palier",
    removeTier: "Retirer",
    scope: "Appliquer à",
    scopeAll: "Tous les livers",
    scopeOne: (u: string) => `@${u} seulement`,
    week: "Semaine",
    month: "Mois",
    removeAll: "Supprimer ces paliers",
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

type TierDraft = { percent: string } & Record<TierKey, string>;
const emptyTier = (): TierDraft => ({ percent: "", validDays: "", hours: "", diamonds: "", follows: "" });

function TiersSheet({ account, onClose, lang }: { account: string; onClose: () => void; lang: Lang }) {
  const tx = TX[lang];
  const all = useStore((s) => s.settings.tiktokTiers) ?? {};
  const [scope, setScope] = useState<"*" | string>(all[account] ? account : "*");
  const base: TierProgram = all[scope] ?? all["*"] ?? { period: "month", validDayMinutes: 60, tiers: [] };
  const toDraft = (p: TierProgram): TierDraft[] => (p.tiers.length ? p.tiers.map((t) => ({ percent: String(t.percent), ...(Object.fromEntries(TIER_KEYS.map((k) => [k, t[k] !== undefined ? String(t[k]) : ""])) as Record<TierKey, string>) })) : [emptyTier()]);
  const [period, setPeriod] = useState<TierProgram["period"]>(base.period);
  const [minutes, setMinutes] = useState(String(base.validDayMinutes));
  const [rows, setRows] = useState<TierDraft[]>(() => toDraft(base));
  const [busy, setBusy] = useState(false);
  const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));

  const save = async (remove = false) => {
    const map = { ...all };
    if (remove) delete map[scope];
    else {
      const tiers: RewardTier[] = rows
        .filter((r) => r.percent.trim() && Number.isFinite(num(r.percent)))
        .map((r) => {
          const t: RewardTier = { percent: num(r.percent) };
          for (const k of TIER_KEYS) if (r[k].trim() && num(r[k]) > 0) t[k] = k === "hours" ? Math.round(num(r[k]) * 2) / 2 : Math.round(num(r[k]));
          return t;
        });
      if (!tiers.length) return;
      map[scope] = { period, validDayMinutes: Math.max(1, Math.round(num(minutes)) || 60), tiers };
    }
    setBusy(true);
    try {
      setState({ settings: await api.saveSettings({ tiktokTiers: map }) });
      toast(tx.saved, "ok");
      onClose();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label={tx.tierSheet}>
      <div className="card-title" style={{ paddingRight: 48 }}>{tx.tierSheet}</div>
      <div className="small muted">{tx.tierHint}</div>
      <div className="goal-form" style={{ marginTop: 10 }}>
        <label className="goal-field">
          <span>{tx.scope}</span>
          <select
            className="input"
            value={scope}
            onChange={(e) => {
              const next = e.target.value;
              setScope(next);
              const p = all[next] ?? all["*"] ?? base;
              setPeriod(p.period);
              setMinutes(String(p.validDayMinutes));
              setRows(toDraft(p));
            }}
          >
            <option value="*">{tx.scopeAll}</option>
            <option value={account}>{tx.scopeOne(account)}</option>
          </select>
        </label>
        <label className="goal-field">
          <span>{tx.tierPeriodLabel}</span>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as TierProgram["period"])}>
            <option value="month">{tx.month}</option>
            <option value="week">{tx.week}</option>
          </select>
        </label>
        <label className="goal-field">
          <span>{tx.tierValidLabel}</span>
          <input className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="tier-edit">
          <div className="goal-form">
            <label className="goal-field">
              <span>{tx.tierPercent}</span>
              <input className="input" inputMode="decimal" value={r.percent} placeholder="%" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
            </label>
            {TIER_KEYS.map((k) => (
              <label key={k} className="goal-field">
                <span>{tx.tierKeys[k]}</span>
                <input className="input" inputMode={k === "hours" ? "decimal" : "numeric"} value={r[k]} placeholder="—" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
              </label>
            ))}
          </div>
          {rows.length > 1 ? (
            <button className="link-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              {tx.removeTier}
            </button>
          ) : null}
        </div>
      ))}
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        {rows.length < 10 ? (
          <button className="btn sm ghost" onClick={() => setRows([...rows, emptyTier()])}>
            {tx.addTier}
          </button>
        ) : null}
        <span className="spacer" />
        {all[scope] ? (
          <button className="btn sm ghost" onClick={() => void save(true)} disabled={busy}>
            {tx.removeAll}
          </button>
        ) : null}
        <button className="btn gold" onClick={() => void save()} disabled={busy}>
          {tx.save}
        </button>
      </div>
    </Sheet>
  );
}

const pctLabel = (p: number, lang: Lang) => `${p.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 })} %`;

function TiersSection({ t, lang }: { t: TierProgress; lang: Lang }) {
  const tx = TX[lang];
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const n = (v: number, k: TierKey) => v.toLocaleString(locale, { maximumFractionDigits: k === "hours" ? 1 : 0 });
  const next = t.next !== null ? t.tiers[t.next] : null;
  return (
    <div className="tiers">
      <div className="goal-line">
        <b>
          {tx.tiers} · {tx.tierPeriod[t.period]}
        </b>
        <span className={`goal-status ${t.current !== null ? "done" : ""}`}>{t.current !== null ? tx.tierNow(pctLabel(t.tiers[t.current].percent, lang)) : tx.tierNone}</span>
      </div>
      <div className="tier-steps" role="list">
        {t.tiers.map((x, i) => (
          <span key={i} role="listitem" className={`tier-step ${x.reached ? "reached" : ""} ${i === t.next ? "next" : ""}`}>
            {x.label || pctLabel(x.percent, lang)}
          </span>
        ))}
      </div>
      {next ? (
        <>
          <div className="small" style={{ marginTop: 8 }}>
            {tx.tierNext(pctLabel(next.percent, lang))} — {tx.tierMissing} :{" "}
            <b>
              {(Object.keys(next.missing) as TierKey[]).map((k) => `${n(next.missing[k]!, k)} ${tx.tierKeys[k]}`).join(" · ")}
            </b>
          </div>
          {TIER_KEYS.filter((k) => next[k] !== undefined).map((k) => {
            const pct = Math.min(100, (t.done[k] / next[k]!) * 100);
            return (
              <div key={k} className="goal-row" style={{ marginTop: 6 }}>
                <div className="goal-line">
                  <span>{tx.tierKeys[k]}</span>
                  <span>
                    <b>{n(t.done[k], k)}</b>
                    <span className="muted"> / {n(next[k]!, k)}</span>
                  </span>
                </div>
                <div className="goal-bar">
                  <span style={{ width: `${Math.max(2, pct)}%` }} />
                  <i style={{ left: `${t.elapsed}%` }} />
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="small" style={{ color: "var(--gold)", marginTop: 6 }}>{tx.tierTop}</div>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>{tx.tierEst(t.validDayMinutes, tx.tierSrc[t.source])}</div>
    </div>
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
  const [editingTiers, setEditingTiers] = useState(false);
  const tiersSetting = useStore((s) => s.settings.tiktokTiers);

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
  }, [room, goalsSetting, tiersSetting]);

  if (!data) return null;
  const set = GOAL_KEYS.filter((k) => data.goals[k]);
  const tiers = data.tiers;
  if (!set.length && !tiers && !canManage) return null;
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
        <button className="goals-toggle" onClick={() => (rows.length || tiers || canManage) && setOpen((o) => !o)} aria-expanded={open} disabled={!rows.length && !tiers && !canManage}>
          <span className="goals-ring" style={{ ["--p" as string]: `${overall}%` }} aria-hidden="true">
            <span>{rows.length ? `${overall}%` : "—"}</span>
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <b className="ellipsis" style={{ display: "block" }}>{tx.title}</b>
            <span className="small muted goals-sub">
              {worst ? <span className={`goal-status ${worst}`}>{tx.status[worst]}</span> : null}
              {rows.length ? `${tx.reached(reached, rows.length)} · ${tx.left(daysLeft)}` : tx.none}
              {tiers ? <span className="tier-chip">{tiers.current !== null ? tx.tierNow(pctLabel(tiers.tiers[tiers.current].percent, lang)) : tx.tierNone}</span> : null}
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
          {canManage ? (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="link-btn" onClick={() => setEditingTiers(true)}>
                ✎ {tx.setTiers}
              </button>
            </div>
          ) : null}
          {tiers ? <TiersSection t={tiers} lang={lang} /> : null}
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
      {editingTiers ? <TiersSheet account={data.account} onClose={() => setEditingTiers(false)} lang={lang} /> : null}
      {editing ? <GoalsSheet account={data.account} goals={data.goals} onClose={() => setEditing(false)} lang={lang} /> : null}
    </div>
  );
}
