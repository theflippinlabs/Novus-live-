import { useEffect, useRef, useState, type RefObject } from "react";
import type { SubtitleCue, SubtitleStatus } from "../../shared/types";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { toast } from "../store";

const TX = {
  en: {
    title: "Subtitles",
    off: "None",
    make: (l: string, min: number, left: number) => `Make the ${l} subtitles (${min} min of speech to transcribe · ${left} min left this month)`,
    makeTranslate: (l: string) => `Make the ${l} subtitles (translation of the transcript)`,
    transcribing: "Transcribing the voice…",
    translating: "Translating…",
    srt: "Subtitles file (.srt)",
    off_server: "Subtitles aren't switched on on the server yet.",
    note: "Speech-to-text, then machine translation: the original voice stays the reference. In full screen on iPhone, subtitles show when you leave full screen.",
    names: { fr: "French", en: "English" },
  },
  fr: {
    title: "Sous-titres",
    off: "Aucun",
    make: (l: string, min: number, left: number) => `Créer les sous-titres en ${l} (${min} min de voix à transcrire · ${left} min restantes ce mois-ci)`,
    makeTranslate: (l: string) => `Créer les sous-titres en ${l} (traduction de la transcription)`,
    transcribing: "Transcription de la voix…",
    translating: "Traduction…",
    srt: "Fichier de sous-titres (.srt)",
    off_server: "Les sous-titres ne sont pas encore activés sur le serveur.",
    note: "Transcription de la voix puis traduction automatique : la voix d'origine fait foi. En plein écran sur iPhone, les sous-titres s'affichent en sortant du plein écran.",
    names: { fr: "français", en: "anglais" },
  },
};

type Status = SubtitleStatus & { minutesNeeded: number };

/** The subtitle line at a time (cues are in order). */
function cueAt(cues: SubtitleCue[], t: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].end < t) lo = mid + 1;
    else if (cues[mid].start > t) hi = mid - 1;
    else return cues[mid].text;
  }
  return "";
}

/** Subtitles shown over the video, synced with its time. */
export function SubtitleOverlay({ video, cues }: { video: RefObject<HTMLVideoElement | null>; cues: SubtitleCue[] | null }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const el = video.current;
    if (!el || !cues) {
      setText("");
      return;
    }
    const tick = () => setText(cueAt(cues, el.currentTime));
    el.addEventListener("timeupdate", tick);
    el.addEventListener("seeked", tick);
    tick();
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("seeked", tick);
    };
  }, [video, cues]);
  return text ? <div className="subtitle-line">{text}</div> : null;
}

/** Choose the subtitles (none, French, English), make them when missing, download them. */
export function SubtitleControls({ sessionId, onCues }: { sessionId: string; onCues: (cues: SubtitleCue[] | null) => void }) {
  const lang = useLang();
  const tx = TX[lang];
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState<"off" | "fr" | "en">("off");
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async (want: "off" | "fr" | "en" = choice) => {
    const s = await api.subtitles(sessionId, want === "off" ? undefined : want).catch(() => null);
    if (!s) return;
    setStatus(s);
    onCues(want !== "off" && s.cues ? s.cues : null);
    if (s.error && !s.job) toast(errorText(s.error, lang), "warn");
    if (!s.job && poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  };

  useEffect(() => {
    void refresh("off");
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const pick = (v: "off" | "fr" | "en") => {
    setChoice(v);
    void refresh(v);
  };

  const make = async (l: "fr" | "en") => {
    setBusy(true);
    try {
      setStatus({ ...(await api.makeSubtitles(sessionId, l)), minutesNeeded: status?.minutesNeeded ?? 0 });
      if (!poll.current) poll.current = setInterval(() => void refresh(l), 4000);
    } catch (e) {
      toast(e instanceof ApiError ? errorText(e.code, lang) : errorText("subtitles_failed", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const job = status.job;
  const ready = choice !== "off" && status.ready.includes(choice);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="small muted">{tx.title}</span>
        <div className="seg" role="radiogroup" aria-label={tx.title} style={{ flex: "0 0 auto" }}>
          {(["off", "fr", "en"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={choice === v} className={choice === v ? "on gold-on" : ""} onClick={() => pick(v)}>
              {v === "off" ? tx.off : v.toUpperCase()}
            </button>
          ))}
        </div>
        {ready ? (
          <a className="btn sm ghost" href={`/api/history/${encodeURIComponent(sessionId)}/subtitles.srt?lang=${choice}`} download>
            ⤓ {tx.srt}
          </a>
        ) : null}
      </div>
      {job ? (
        <div style={{ marginTop: 8 }}>
          <div className="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
            <span style={{ width: `${Math.max(4, job.progress * 100)}%` }} />
          </div>
          <div className="small muted">
            {job.phase === "transcribing" ? tx.transcribing : tx.translating} {Math.round(job.progress * 100)} %
          </div>
        </div>
      ) : choice !== "off" && !ready ? (
        status.configured ? (
          <button className="btn sm gold" style={{ marginTop: 8 }} disabled={busy} onClick={() => void make(choice)}>
            {status.minutesNeeded ? tx.make(tx.names[choice], status.minutesNeeded, status.minutesLeft) : tx.makeTranslate(tx.names[choice])}
          </button>
        ) : (
          <div className="small muted" style={{ marginTop: 8 }}>{tx.off_server}</div>
        )
      ) : null}
      {choice !== "off" ? <div className="small muted" style={{ marginTop: 6 }}>{tx.note}</div> : null}
    </div>
  );
}
