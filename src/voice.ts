import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Voice for the copilot, with the browser's own speech engines (no audio leaves the phone
 * through Novus): dictation via SpeechRecognition, answers read aloud via speechSynthesis.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechLang = (lang: "en" | "fr") => (lang === "fr" ? "fr-FR" : "en-US");

export type DictationError = "unsupported" | "denied" | "no-speech" | "failed";

/**
 * Hold-free dictation: start() listens until the speaker pauses, shows the words as they
 * come (onPartial), then hands the final sentence to onFinal.
 */
export function useDictation(lang: "en" | "fr", onPartial: (text: string) => void, onFinal: (text: string) => void, onError: (e: DictationError) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const text = useRef("");
  const supported = typeof window !== "undefined" && recognitionCtor() !== null;
  const cbs = useRef({ onPartial, onFinal, onError });
  cbs.current = { onPartial, onFinal, onError };

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return cbs.current.onError("unsupported");
    rec.current?.abort();
    const r = new Ctor();
    r.lang = speechLang(lang);
    r.continuous = false;
    r.interimResults = true;
    text.current = "";
    let failed = false;
    r.onresult = (e) => {
      let all = "";
      for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
      text.current = all.trim();
      cbs.current.onPartial(text.current);
    };
    r.onerror = (e) => {
      failed = true;
      if (e.error === "aborted") return;
      cbs.current.onError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "no-speech" : "failed");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (!failed && text.current) cbs.current.onFinal(text.current);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      cbs.current.onError("failed");
    }
  }, [lang]);

  useEffect(() => () => rec.current?.abort(), []);
  return { supported, listening, start, stop };
}

/** Read a copilot answer aloud in the app's language (stops any answer still playing). */
export function speak(text: string, lang: "en" | "fr"): void {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[•*_#]/g, " "));
  u.lang = speechLang(lang);
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  u.rate = 1.05;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
