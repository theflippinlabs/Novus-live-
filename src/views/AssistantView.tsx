import { useCallback, useEffect, useRef, useState } from "react";
import type { CatchUp, ChatPulse, CoachTip, CopilotTurn, Supporter } from "../../shared/types";
import { api, ApiError } from "../api";
import { Avatar, Segmented } from "../components/ui";
import { useCan } from "../permissions";
import { nicknameOf } from "../viewerName";
import { LineChart } from "../components/Charts";
import { errorText, tr, useLang, useT } from "../i18n";
import { ago, compact, hm } from "../format";
import { navigate, openViewer, serverNow, toast, useStore } from "../store";

const LAST_CHECK_KEY = "novus:lastCheck";

function readLastCheck(): number | undefined {
  try {
    const v = Number(localStorage.getItem(LAST_CHECK_KEY));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeLastCheck(t: number) {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(t));
  } catch {
    /* private mode */
  }
}

function CatchUpCard() {
  const t = useT();
  const lang = useLang();
  const [result, setResult] = useState<CatchUp | null>(null);
  const [since, setSince] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const from = readLastCheck();
      const r = await api.catchUp(from, lang);
      setResult(r);
      setSince(from);
      writeLastCheck(r.until);
    } catch {
      toast(t("catchUpFailed"), "warn");
    } finally {
      setBusy(false);
    }
  };
  // Rebuild the same briefing in the other language when the language changes.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    api
      .catchUp(since ?? result.since, lang)
      .then((r) => !cancelled && setResult({ ...r, until: result.until }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
  return (
    <div className="card catchup-card">
      <button className="btn gold lg block" onClick={run} disabled={busy}>
        {busy ? "…" : `⟲ ${t("catchUp")}`}
      </button>
      <div className="small muted" style={{ textAlign: "center", marginTop: 6 }}>
        {t("catchUpHint")}
        {readLastCheck() ? ` · ${hm(readLastCheck()!)}` : ""}
      </div>
      {result ? (
        <div style={{ marginTop: 14 }} aria-live="polite">
          <h3>{result.headline}</h3>
          {result.narrative ? <p style={{ marginTop: 0, color: "var(--text-2)", fontSize: 14 }}>{result.narrative}</p> : null}
          {result.sections.map((s) => (
            <div key={s.title}>
              <div className="card-title" style={{ margin: "10px 0 2px" }}>
                {s.title}
              </div>
              <ul>
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="small muted">
            {hm(result.since)} → {hm(result.until)} · {result.source === "ai" ? t("stageAi") : t("stageLocal")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LivePulse() {
  const t = useT();
  const lang = useLang();
  const sessionId = useStore((s) => s.session?.id);
  const [pulse, setPulse] = useState<ChatPulse | null>(null);

  const load = useCallback(() => {
    api
      .pulse()
      .then(setPulse)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load, sessionId]);

  const answer = async (id: string, answered: boolean) => {
    await api.markAnswered(id, answered);
    load();
  };

  const now = serverNow();
  const p = pulse;

  return (
    <>
        {p ? (
          <>
            <div className="card">
              <div className="card-title">
                <span className="gold">◆</span> {t("chatPulse")}
              </div>
              <div className="grid-3">
                <div>
                  <div className="hero-num">{compact(p.messagesTotal)}</div>
                  <div className="small muted">{t("messages")}</div>
                </div>
                <div>
                  <div className="hero-num">{compact(p.activeViewers)}</div>
                  <div className="small muted">{t("chatters")}</div>
                </div>
                <div>
                  <div className={`hero-num ${p.activityChangePct > 0 ? "delta-up" : p.activityChangePct < 0 ? "delta-down" : ""}`}>
                    {p.activityChangePct > 0 ? "+" : ""}
                    {p.activityChangePct}%
                  </div>
                  <div className="small muted">{t("activity")}</div>
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {p.messagesPerMinute} {t("msgMin")} · {compact(p.viewerCount)} {t("viewersShort")}
              </div>
              {p.viewersNeedingAttention > 0 ? (
                <button className="btn block" style={{ marginTop: 10, borderColor: "rgba(229,38,62,.5)", whiteSpace: "normal", height: "auto", padding: "10px 12px" }} onClick={() => navigate("alerts")}>
                  <b style={{ color: "#ff8b98" }}>{p.viewersNeedingAttention}</b>&nbsp;{t("needAttention")}
                </button>
              ) : null}
            </div>

            <div className="card">
              <div className="card-title">{t("topUnanswered")}</div>
              {p.topUnanswered ? (
                <>
                  <div className="quote">“{p.topUnanswered.question}”</div>
                  <div className="row small muted" style={{ marginTop: 6 }}>
                    ×{p.topUnanswered.count} · {p.topUnanswered.askers.slice(0, 3).map((a) => `@${a}`).join(", ")}
                    <span className="spacer" />
                    <button className="btn sm" onClick={() => answer(p.topUnanswered!.id, true)}>
                      ✓ {t("markAnswered")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="muted">—</div>
              )}
            </div>

            <div className="card">
              <div className="card-title">{t("trending")}</div>
              {p.trending.length === 0 ? <div className="muted">—</div> : null}
              {p.trending.map((topic, i) => (
                <div key={topic.topic} className="rank">
                  <span className="n">{i + 1}</span>
                  <span className="t">{tr(topic.topic, lang)}</span>
                  <span className="c">
                    {topic.count}
                    {topic.growth > 0 ? <span className="delta-up"> +{topic.growth}%</span> : null}
                  </span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">{t("questions")}</div>
              {p.topQuestions.length === 0 ? <div className="muted">—</div> : null}
              {p.topQuestions.map((q) => (
                <div key={q.id} className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, textDecoration: q.answered ? "line-through" : undefined, color: q.answered ? "var(--text-3)" : undefined }}>{q.question}</div>
                    <div className="small muted">
                      ×{q.count} · {ago(q.lastAskedAt, now)}
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => answer(q.id, !q.answered)}>
                    {q.answered ? t("reopen") : `✓ ${t("markAnswered")}`}
                  </button>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">
                {t("sentiment")}
                <span className="spacer" />
                <span style={{ color: p.sentiment.current < -0.08 ? "var(--r-warning)" : "var(--text)" }}>{tr(p.sentiment.label, lang)}</span>
              </div>
              {p.sentiment.shift ? (
                <div className="small" style={{ color: "var(--gold)", marginBottom: 6 }}>
                  ⚡ {tr(p.sentiment.shift, lang)} ({p.sentiment.change > 0 ? "+" : ""}
                  {p.sentiment.change})
                </div>
              ) : null}
              <LineChart
                label={t("sentiment")}
                data={p.sentimentSeries.map((s) => ({ t: s.t, v: s.value }))}
                min={-1}
                max={1}
                zeroLine
                height={110}
                format={(pt) => `${hm(pt.t)} · ${pt.v.toFixed(2)}`}
              />
            </div>

            {p.repeatedRequests.length ? (
              <div className="card">
                <div className="card-title">{t("requests")}</div>
                {p.repeatedRequests.map((r) => (
                  <div key={r.id} className="rank">
                    <span className="t">“{r.question}”</span>
                    <span className="c">×{r.count}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <Supporters list={p.supporters} />

            <div className="card">
              <div className="card-title">{t("important")}</div>
              {p.importantMessages.length === 0 ? <div className="muted">—</div> : null}
              {p.importantMessages.map((m) => (
                <button key={m.commentId} className="list-row" style={{ width: "100%", textAlign: "left", alignItems: "flex-start" }} onClick={() => openViewer(m.viewer.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small" style={{ color: "var(--gold)" }}>
                      {tr(m.reason, lang)} · @{m.viewer.username}
                    </div>
                    <div style={{ fontSize: 14 }}>{tr(m.text, lang)}</div>
                  </div>
                  <span className="small muted">{ago(m.t, now)}</span>
                </button>
              ))}
            </div>

            {p.spikes.length ? (
              <div className="card">
                <div className="card-title">{t("spikes")}</div>
                {p.spikes.map((s) => (
                  <div key={s.t} className="rank">
                    <span className="t mono">{hm(s.t)}</span>
                    <span className="c">
                      {s.messages} {t("msgShort")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty">…</div>
        )}
    </>
  );
}

// ---------------------------------------------------------------- top supporters

function Supporters({ list }: { list: Supporter[] }) {
  const lang = useLang();
  const fr = lang === "fr";
  if (!list.length) return null;
  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◆</span> {fr ? "Meilleurs soutiens" : "Top supporters"}
      </div>
      {list.map((s, i) => {
        const nick = nicknameOf(s.viewer);
        return (
          <button key={s.viewer.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onClick={() => openViewer(s.viewer.id)}>
            <span className="rank-n">{i + 1}</span>
            <Avatar viewer={s.viewer} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="ellipsis">{nick ?? `@${s.viewer.username}`}</b>
              {nick ? <div className="viewer-handle">@{s.viewer.username}</div> : null}
            </div>
            <div style={{ textAlign: "right" }}>
              <b>🎁 {s.gifts}</b>
              {s.diamonds ? (
                <div className="small muted">
                  {s.diamonds.toLocaleString(fr ? "fr-FR" : "en-GB")} <span className="gold">◆</span>
                </div>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- copilot

type DraftKind = "question" | "thanks" | "welcome" | "revive";

const CX = {
  en: {
    tabs: { copilot: "Copilot", live: "Live", recap: "Recap" },
    heroSub: "Reads your LIVE in real time and tells you what matters.",
    mood: "Mood",
    priorities: "Right now",
    openAlerts: "Open alerts",
    draftAnswer: "Write a reply",
    draftThanks: "Write a thank-you",
    draftRevive: "Revive the chat",
    draftWelcome: "Welcome newcomers",
    askAdvice: "Ask for advice",
    moodAsk: "The mood is turning negative in my chat. What should I do right now?",
    profile: "Profile",
    answered: "Mark answered",
    dismiss: "Hide",
    writing: "Novus is writing…",
    copy: "Copy",
    copied: "Copied",
    send: "Send in chat",
    sent: "Sent ✓",
    again: "Rewrite",
    ask: "Ask Novus",
    askHint: "Ask anything about your LIVE — Novus answers from what is happening now.",
    placeholder: "Your question…",
    clear: "New conversation",
    thinking: "Novus is thinking…",
    chips: ["Sum up the last 10 minutes", "Who should I keep an eye on?", "What is the chat asking for?", "How do I boost engagement now?", "Who are my best supporters?"],
    aiOff: "The AI copilot isn't available (AI not configured on the server). The priorities above keep working.",
    you: "You",
  },
  fr: {
    tabs: { copilot: "Copilote", live: "En direct", recap: "Récap" },
    heroSub: "Lit ton LIVE en temps réel et te dit ce qui compte.",
    mood: "Ambiance",
    priorities: "Maintenant",
    openAlerts: "Voir les alertes",
    draftAnswer: "Rédiger une réponse",
    draftThanks: "Rédiger un remerciement",
    draftRevive: "Relancer le chat",
    draftWelcome: "Accueillir les nouveaux",
    askAdvice: "Demander conseil",
    moodAsk: "L'ambiance devient négative dans mon chat. Qu'est-ce que je fais maintenant ?",
    profile: "Profil",
    answered: "Marquer répondue",
    dismiss: "Masquer",
    writing: "Novus rédige…",
    copy: "Copier",
    copied: "Copié",
    send: "Envoyer dans le chat",
    sent: "Envoyé ✓",
    again: "Réécrire",
    ask: "Demande à Novus",
    askHint: "Pose n'importe quelle question sur ton LIVE — Novus répond à partir de ce qui se passe maintenant.",
    placeholder: "Ta question…",
    clear: "Nouvelle conversation",
    thinking: "Novus réfléchit…",
    chips: ["Résume les 10 dernières minutes", "Qui dois-je surveiller ?", "Que demande le chat ?", "Comment relancer l'engagement ?", "Qui sont mes meilleurs soutiens ?"],
    aiOff: "Le copilote IA n'est pas disponible (IA non configurée sur le serveur). Les priorités ci-dessus continuent de fonctionner.",
    you: "Toi",
  },
};

const errMsg = (e: unknown, lang: "en" | "fr") => errorText(e instanceof ApiError ? e.code : "ai_failed", lang);

/** An AI-written chat message the streamer can edit, copy or post in the LIVE chat. */
function DraftComposer({ kind, questionId, viewerId, onClose }: { kind: DraftKind; questionId?: string; viewerId?: string; onClose: () => void }) {
  const lang = useLang();
  const cx = CX[lang];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [state, setStateLocal] = useState<"idle" | "copied" | "sending" | "sent">("idle");
  const sender = useStore((s) => s.chatSender);
  const room = useStore((s) => s.room);
  const live = useStore((s) => s.session?.status === "live");
  const canSend = useCan("send_chat") && Boolean(sender?.connected) && room.startsWith("tt:") && live;

  const draft = useCallback(async () => {
    setBusy(true);
    setStateLocal("idle");
    try {
      setText((await api.draftMessage({ kind, questionId, viewerId }, lang)).text);
    } catch (e) {
      toast(errMsg(e, lang), "warn");
      onClose();
    } finally {
      setBusy(false);
    }
  }, [kind, questionId, viewerId, lang, onClose]);
  useEffect(() => {
    void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setStateLocal("sending");
    try {
      await api.copilotSendChat(text);
      setStateLocal("sent");
    } catch (e) {
      toast(errMsg(e, lang), "warn");
      setStateLocal("idle");
    }
  };

  return (
    <div className="composer">
      {busy ? (
        <div className="small muted typing">{cx.writing}</div>
      ) : (
        <>
          <textarea className="input composer-text" value={text} maxLength={150} rows={3} onChange={(e) => setText(e.target.value)} aria-label={cx.send} />
          <div className="row wrap" style={{ gap: 8 }}>
            {canSend ? (
              <button className="btn sm gold" disabled={!text.trim() || state === "sending" || state === "sent"} onClick={send}>
                {state === "sent" ? cx.sent : state === "sending" ? "…" : cx.send}
              </button>
            ) : null}
            <button
              className={`btn sm ${canSend ? "" : "gold"}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setStateLocal("copied");
                } catch {
                  /* select by hand */
                }
              }}
            >
              {state === "copied" ? `${cx.copied} ✓` : cx.copy}
            </button>
            <button className="btn sm ghost" onClick={draft}>
              ⟲ {cx.again}
            </button>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={onClose} aria-label={cx.dismiss}>
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TipCard({ tip, onDismiss, onAsk, onAnswered }: { tip: CoachTip; onDismiss: () => void; onAsk: (q: string) => void; onAnswered: (id: string) => void }) {
  const lang = useLang();
  const cx = CX[lang];
  const canModerate = useCan("moderate");
  const aiOn = useStore((s) => s.ai.state !== "local_only");
  const [draft, setDraft] = useState<DraftKind | null>(null);
  const closeDraft = useCallback(() => setDraft(null), []);
  const draftFor: Partial<Record<CoachTip["kind"], [DraftKind, string]>> = {
    question: ["question", cx.draftAnswer],
    supporter: ["thanks", cx.draftThanks],
    activity: ["revive", cx.draftRevive],
    spike: ["welcome", cx.draftWelcome],
  };
  const d = draftFor[tip.kind];
  return (
    <div className={`tip p${tip.priority}`}>
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <span className="tip-dot" aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tip-title">{tip.title}</div>
          <div className="tip-detail">{tip.detail}</div>
        </div>
        {tip.kind !== "calm" && tip.kind !== "idle" ? (
          <button className="tip-x" onClick={onDismiss} aria-label={cx.dismiss}>
            ✕
          </button>
        ) : null}
      </div>
      {!draft ? (
        <div className="row wrap tip-actions">
          {tip.kind === "alerts" ? (
            <button className="btn sm gold" onClick={() => navigate("alerts")}>
              {cx.openAlerts} →
            </button>
          ) : null}
          {d && aiOn ? (
            <button className="btn sm gold" onClick={() => setDraft(d[0])}>
              ✦ {d[1]}
            </button>
          ) : null}
          {tip.kind === "mood" && aiOn ? (
            <button className="btn sm gold" onClick={() => onAsk(cx.moodAsk)}>
              ✦ {cx.askAdvice}
            </button>
          ) : null}
          {tip.kind === "question" && tip.questionId && canModerate ? (
            <button className="btn sm" onClick={() => onAnswered(tip.questionId!)}>
              ✓ {cx.answered}
            </button>
          ) : null}
          {tip.kind === "supporter" && tip.viewer ? (
            <button className="btn sm" onClick={() => openViewer(tip.viewer!.id)}>
              {cx.profile}
            </button>
          ) : null}
        </div>
      ) : (
        <DraftComposer kind={draft} questionId={tip.questionId} viewerId={tip.viewer?.id} onClose={closeDraft} />
      )}
    </div>
  );
}

const historyKey = (room: string) => `novus:copilot:${room}`;
function loadHistory(room: string): CopilotTurn[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(historyKey(room)) ?? "[]");
    return Array.isArray(v) ? v.slice(-20) : [];
  } catch {
    return [];
  }
}

function AskNovus({ pending, onPendingDone }: { pending: string | null; onPendingDone: () => void }) {
  const lang = useLang();
  const cx = CX[lang];
  const room = useStore((s) => s.room);
  const aiOn = useStore((s) => s.ai.state !== "local_only");
  const [turns, setTurns] = useState<CopilotTurn[]>(() => loadHistory(room));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTurns(loadHistory(room)), [room]);
  useEffect(() => {
    try {
      sessionStorage.setItem(historyKey(room), JSON.stringify(turns.slice(-20)));
    } catch {
      /* private mode */
    }
  }, [turns, room]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [turns.length, busy]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      const before = turns;
      setTurns([...before, { role: "user", text: q }]);
      setInput("");
      setBusy(true);
      try {
        const { text } = await api.askCopilot(q, before.slice(-10), lang);
        setTurns((t) => [...t, { role: "assistant", text }]);
      } catch (e) {
        setTurns(before);
        setInput(q);
        toast(errMsg(e, lang), "warn");
      } finally {
        setBusy(false);
      }
    },
    [busy, turns, lang],
  );

  useEffect(() => {
    if (pending) {
      void ask(pending);
      onPendingDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <div className="card copilot-chat">
      <div className="card-title">
        <span className="gold">✦</span> {cx.ask}
        <span className="spacer" />
        {turns.length ? (
          <button className="link-btn small" onClick={() => setTurns([])}>
            {cx.clear}
          </button>
        ) : null}
      </div>
      {!aiOn ? (
        <div className="small muted">{cx.aiOff}</div>
      ) : (
        <>
          {turns.length === 0 ? <div className="small muted">{cx.askHint}</div> : null}
          <div className="bubbles">
            {turns.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.text}
              </div>
            ))}
            {busy ? <div className="bubble assistant typing">{cx.thinking}</div> : null}
            <div ref={endRef} />
          </div>
          <div className="chips-scroll">
            {cx.chips.map((c) => (
              <button key={c} className="chip" disabled={busy} onClick={() => ask(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="row ask-row">
            <input
              className="input"
              value={input}
              maxLength={500}
              placeholder={cx.placeholder}
              aria-label={cx.ask}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(input)}
            />
            <button className="btn gold" disabled={busy || !input.trim()} onClick={() => ask(input)} aria-label={cx.ask}>
              ↑
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Copilot() {
  const lang = useLang();
  const cx = CX[lang];
  const t = useT();
  const room = useStore((s) => s.room);
  const sessionId = useStore((s) => s.session?.id);
  const stats = useStore((s) => s.stats);
  const live = useStore((s) => s.session?.status === "live");
  const [tips, setTips] = useState<CoachTip[] | null>(null);
  const [mood, setMood] = useState<ChatPulse["sentiment"] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .coach(lang)
      .then((r) => setTips(r.tips))
      .catch(() => undefined);
    api
      .pulse()
      .then((p) => setMood(p.sentiment))
      .catch(() => undefined);
  }, [lang]);
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, room, sessionId]);

  const answered = async (id: string) => {
    await api.markAnswered(id, true).catch(() => undefined);
    load();
  };
  const shown = (tips ?? []).filter((tip) => !hidden.has(tip.id));

  return (
    <>
      <div className="copilot-hero">
        <div className="copilot-mark">✦</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="copilot-name">NOVUS COPILOT</div>
          <div className="small">{cx.heroSub}</div>
          {live && mood ? (
            <div className="copilot-mood">
              {cx.mood} : <b>{tr(mood.label, lang)}</b>
            </div>
          ) : null}
        </div>
      </div>
      <div className="copilot-stats">
        <div>
          <b>{compact(stats.viewerCount)}</b>
          <span>{t("viewersShort")}</span>
        </div>
        <div>
          <b>{compact(stats.messagesPerMinute)}</b>
          <span>{t("msgMin")}</span>
        </div>
        <div>
          <b>{compact(stats.activeChatters)}</b>
          <span>{t("chatters")}</span>
        </div>
      </div>

      <div className="section-title">{cx.priorities}</div>
      {tips === null ? <div className="card muted">…</div> : null}
      {shown.map((tip) => (
        <TipCard key={tip.id} tip={tip} onDismiss={() => setHidden((h) => new Set(h).add(tip.id))} onAsk={setPending} onAnswered={answered} />
      ))}

      <AskNovus pending={pending} onPendingDone={() => setPending(null)} />
    </>
  );
}

type Tab = "copilot" | "live" | "recap";

export function AssistantView() {
  const lang = useLang();
  const cx = CX[lang];
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = sessionStorage.getItem("novus:assistant-tab");
      return v === "live" || v === "recap" ? v : "copilot";
    } catch {
      return "copilot";
    }
  });
  const pick = (v: Tab) => {
    setTab(v);
    try {
      sessionStorage.setItem("novus:assistant-tab", v);
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="scroll">
      <div className="narrow stack">
        <Segmented label="Assistant" value={tab} gold onChange={pick} options={(["copilot", "live", "recap"] as Tab[]).map((k) => ({ value: k, label: cx.tabs[k] }))} />
        {tab === "copilot" ? <Copilot /> : null}
        {tab === "live" ? <LivePulse /> : null}
        {tab === "recap" ? <CatchUpCard /> : null}
      </div>
    </div>
  );
}
