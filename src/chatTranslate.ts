import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AnalyzedComment } from "../shared/types";
import { api } from "./api";

/*
 * Live translation of the chat (French / English), chosen on the Live screen.
 * New messages are sent in small batches; each message is translated once (here and on the
 * server, which also counts it in the plan's AI allowance). Off by default.
 */

export type ChatLang = "off" | "fr" | "en";

const KEY = "novus:chat-translate";
let target: ChatLang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "fr" || v === "en" ? v : "off";
  } catch {
    return "off";
  }
})();
/** "<lang>|<comment id>" → translated text. */
const done = new Map<string, string>();
const pending = new Set<string>();
let unavailable = false;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version += 1;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setChatTranslation(lang: ChatLang): void {
  target = lang;
  unavailable = false;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode: kept for this visit */
  }
  notify();
}

export function useChatTranslation(): { target: ChatLang; unavailable: boolean } {
  useSyncExternalStore(subscribe, () => version);
  return { target, unavailable };
}

/** The translation to show under a message, or null (off, not ready, or same as the original). */
export function useTranslated(c: AnalyzedComment): string | null {
  useSyncExternalStore(subscribe, () => version);
  if (target === "off") return null;
  const t = done.get(`${target}|${c.id}`);
  if (!t) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(t) === norm(c.text) ? null : t;
}

/** Translate the latest messages on screen as they arrive (every 1.5 s, 40 at a time). */
export function useChatTranslator(comments: AnalyzedComment[]): void {
  const { target: lang } = useChatTranslation();
  const latest = useRef(comments);
  latest.current = comments;
  useEffect(() => {
    if (lang === "off") return;
    let busy = false;
    const tick = () => {
      if (busy || unavailable) return;
      const todo = latest.current
        .slice(-80)
        .filter((c) => !done.has(`${lang}|${c.id}`) && !pending.has(`${lang}|${c.id}`))
        .slice(-40);
      if (!todo.length) return;
      busy = true;
      for (const c of todo) pending.add(`${lang}|${c.id}`);
      void api
        .translate(
          todo.map((c) => c.text),
          lang,
        )
        .then((r) => {
          if (!r.available) unavailable = true;
          todo.forEach((c, i) => done.set(`${lang}|${c.id}`, r.translations[i] ?? c.text));
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
          for (const c of todo) pending.delete(`${lang}|${c.id}`);
          // Keep memory bounded on long LIVEs.
          if (done.size > 6000) for (const k of [...done.keys()].slice(0, 2000)) done.delete(k);
          notify();
        });
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [lang]);
}
