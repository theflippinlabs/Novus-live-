import type { AIProvider } from "./AIProvider";

/*
 * Translation of LIVE chat messages and subtitles (French / English).
 * Goes through the space's metered AI, so it counts against the plan's AI allowance like
 * every other AI use: past the allowance, texts stay untranslated (never an overage).
 * Identical texts are translated once (cache), and texts with no letters are never sent.
 */

export type Lang = "en" | "fr";

const BATCH = 40;
const PARALLEL = 4;
const CACHE_MAX = 20_000;

/** Nothing to translate: emojis, numbers, punctuation, a lone @handle or link. */
export function untranslatable(text: string): boolean {
  const t = text.replace(/@[\w.]+/g, "").replace(/https?:\/\/\S+/g, "").trim();
  return !/\p{L}{2,}/u.test(t);
}

export class Translator {
  private cache = new Map<string, string>();

  constructor(private ai: AIProvider) {}

  /** The AI is configured and the space still has AI allowance left. */
  available(): boolean {
    return Boolean(this.ai.translate) && this.ai.available();
  }

  /** Same order as `texts`; a text that could not be translated comes back unchanged. */
  async translate(texts: string[], target: Lang): Promise<string[]> {
    const out = [...texts];
    const todo: { i: number; text: string }[] = [];
    texts.forEach((text, i) => {
      const hit = this.cache.get(`${target}|${text}`);
      if (hit !== undefined) out[i] = hit;
      else if (!untranslatable(text)) todo.push({ i, text });
    });
    if (!todo.length || !this.available()) return out;
    // Each distinct text once.
    const unique = [...new Set(todo.map((t) => t.text))];
    const translated = new Map<string, string>();
    const chunks: string[][] = [];
    for (let k = 0; k < unique.length; k += BATCH) chunks.push(unique.slice(k, k + BATCH));
    // A few batches at a time (long exports), stopping once the AI allowance is used up.
    for (let k = 0; k < chunks.length; k += PARALLEL) {
      if (!this.available()) break;
      // A failed batch stays untranslated this time (not cached: tried again next time).
      const results = await Promise.all(chunks.slice(k, k + PARALLEL).map((chunk) => this.ai.translate!(chunk, target).catch(() => null)));
      results.forEach((res, n) => {
        if (!res) return;
        chunks[k + n].forEach((text, j) => {
          translated.set(text, res[j] ?? text);
          this.remember(`${target}|${text}`, res[j] ?? text);
        });
      });
    }
    for (const t of todo) out[t.i] = translated.get(t.text) ?? t.text;
    return out;
  }

  private remember(key: string, value: string): void {
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, value);
  }
}
