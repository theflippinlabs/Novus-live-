import { useCallback, useEffect, useRef, useState } from "react";
import type { CopilotTurn } from "../../shared/types";
import { ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { toast, useStore } from "../store";
import { canSpeak, speak, stopSpeaking, useDictation } from "../voice";
import { IconMic, IconSpeaker, IconSpeakerOff } from "./Icons";

// A conversation with Novus (typed or spoken), with ready-made questions. Used by the
// copilot (about the LIVE now) and by Stats (about the numbers).

const CX = {
  en: {
    placeholder: "Your question…",
    clear: "New conversation",
    thinking: "Novus is thinking…",
    aiOff: "The AI isn't available (not configured on the server).",
    mic: "Speak",
    micStop: "Stop",
    listening: "Listening…",
    voiceOn: "Read answers aloud",
    voiceOff: "Answers read aloud: off",
    micUnsupported: "Voice input isn't available in this browser: tap the 🎤 of the iPhone keyboard to dictate.",
    micDenied: "Allow the microphone for NOVUS (iPhone Settings › Safari › Microphone), or use the 🎤 of the keyboard.",
    micNothing: "I didn't hear anything — try again.",
    micFailed: "Voice input stopped — try again or use the 🎤 of the keyboard.",
  },
  fr: {
    placeholder: "Ta question…",
    clear: "Nouvelle conversation",
    thinking: "Novus réfléchit…",
    aiOff: "L'IA n'est pas disponible (non configurée sur le serveur).",
    mic: "Parler",
    micStop: "Arrêter",
    listening: "Je t'écoute…",
    voiceOn: "Lire les réponses à voix haute",
    voiceOff: "Lecture vocale : désactivée",
    micUnsupported: "La dictée n'est pas disponible dans ce navigateur : touche le 🎤 du clavier iPhone pour dicter.",
    micDenied: "Autorise le micro pour NOVUS (Réglages iPhone › Safari › Micro), ou utilise le 🎤 du clavier.",
    micNothing: "Je n'ai rien entendu — réessaie.",
    micFailed: "La dictée s'est arrêtée — réessaie ou utilise le 🎤 du clavier.",
  },
};

function load(key: string): CopilotTurn[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.slice(-20) : [];
  } catch {
    return [];
  }
}

export function AskPanel({
  title,
  hint,
  chips,
  storageKey,
  ask: askApi,
  pending,
  onPendingDone,
}: {
  title: string;
  hint: string;
  chips: string[];
  /** Conversation kept for the session under this key (per room / per LIVE). */
  storageKey: string;
  ask: (question: string, history: CopilotTurn[]) => Promise<string>;
  /** A question sent from elsewhere (e.g. a tip's "ask for advice"). */
  pending?: string | null;
  onPendingDone?: () => void;
}) {
  const lang = useLang();
  const cx = CX[lang];
  const aiOn = useStore((s) => s.ai.state !== "local_only");
  const [turns, setTurns] = useState<CopilotTurn[]>(() => load(storageKey));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [voice, setVoice] = useState(() => {
    try {
      return localStorage.getItem("novus:copilot-voice") === "1";
    } catch {
      return false;
    }
  });
  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    if (!next) stopSpeaking();
    try {
      localStorage.setItem("novus:copilot-voice", next ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  useEffect(() => setTurns(load(storageKey)), [storageKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(turns.slice(-20)));
    } catch {
      /* private mode */
    }
  }, [turns, storageKey]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [turns.length, busy]);

  const ask = useCallback(
    async (question: string, spoken = false) => {
      const q = question.trim();
      if (!q || busy) return;
      const before = turns;
      setTurns([...before, { role: "user", text: q }]);
      setInput("");
      setBusy(true);
      try {
        const text = await askApi(q, before.slice(-10));
        setTurns((t) => [...t, { role: "assistant", text }]);
        // Asked by voice (or voice answers on): Novus answers out loud.
        if (spoken || voice) speak(text, lang);
      } catch (e) {
        setTurns(before);
        setInput(q);
        toast(errorText(e instanceof ApiError ? e.code : "ai_failed", lang), "warn");
      } finally {
        setBusy(false);
      }
    },
    [busy, turns, lang, voice, askApi],
  );

  useEffect(() => {
    if (pending) {
      void ask(pending);
      onPendingDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const dictation = useDictation(
    lang,
    (partial) => setInput(partial),
    (final) => void ask(final, true),
    (e) => toast(e === "unsupported" ? cx.micUnsupported : e === "denied" ? cx.micDenied : e === "no-speech" ? cx.micNothing : cx.micFailed, "warn"),
  );
  const mic = () => {
    if (dictation.listening) return dictation.stop();
    stopSpeaking();
    if (!dictation.supported) return toast(cx.micUnsupported, "info");
    setInput("");
    dictation.start();
  };

  return (
    <div className="card copilot-chat">
      <div className="card-title">
        <span className="gold">✦</span> {title}
        <span className="spacer" />
        {aiOn && canSpeak() ? (
          <button className={`icon-btn ${voice ? "on" : ""}`} onClick={toggleVoice} aria-pressed={voice} aria-label={voice ? cx.voiceOn : cx.voiceOff} title={voice ? cx.voiceOn : cx.voiceOff}>
            {voice ? <IconSpeaker width={18} height={18} /> : <IconSpeakerOff width={18} height={18} />}
          </button>
        ) : null}
      </div>
      {!aiOn ? (
        <div className="small muted">{cx.aiOff}</div>
      ) : (
        <>
          {turns.length === 0 ? <div className="small muted">{hint}</div> : null}
          {turns.length ? (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="link-btn small" onClick={() => setTurns([])}>
                {cx.clear}
              </button>
            </div>
          ) : null}
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
            {chips.map((c) => (
              <button key={c} className="chip" disabled={busy} onClick={() => ask(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="row ask-row">
            <button className={`btn mic-btn ${dictation.listening ? "listening" : ""}`} disabled={busy} onClick={mic} aria-label={dictation.listening ? cx.micStop : cx.mic} aria-pressed={dictation.listening}>
              <IconMic width={22} height={22} />
            </button>
            <input
              className="input"
              value={input}
              maxLength={500}
              placeholder={dictation.listening ? cx.listening : cx.placeholder}
              aria-label={title}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(input)}
            />
            <button className="btn gold" disabled={busy || !input.trim()} onClick={() => ask(input)} aria-label={title}>
              ↑
            </button>
          </div>
        </>
      )}
    </div>
  );
}
