import { normalize } from "./text";

// Lightweight language identification: script detection + stopword voting.
// Good enough to tag chat messages; never used to make moderation decisions on its own.

const SCRIPTS: [RegExp, string][] = [
  [/[؀-ۿ]/, "ar"],
  [/[Ѐ-ӿ]/, "ru"],
  [/[぀-ヿ]/, "ja"],
  [/[가-힯]/, "ko"],
  [/[一-鿿]/, "zh"],
  [/[֐-׿]/, "he"],
  [/[฀-๿]/, "th"],
  [/[ऀ-ॿ]/, "hi"],
  [/[Ͱ-Ͽ]/, "el"],
];

const WORDS: Record<string, string[]> = {
  en: ["the", "you", "and", "is", "are", "what", "when", "this", "that", "with", "your", "how", "can", "love", "stream", "i'm", "it's"],
  fr: ["le", "la", "les", "est", "tu", "je", "vous", "c'est", "quand", "pourquoi", "avec", "mais", "trop", "merci", "salut", "t'es", "ton", "une", "des", "sur", "pas"],
  es: ["el", "los", "que", "es", "por", "como", "hola", "gracias", "pero", "muy", "para", "cuando"],
  de: ["der", "die", "und", "ist", "nicht", "ich", "du", "das", "wann", "danke", "hallo"],
  pt: ["voce", "você", "obrigado", "nao", "não", "muito", "quando", "olá", "ola", "tudo"],
  it: ["ciao", "grazie", "sono", "che", "non", "perché", "quando", "molto"],
};

export function detectLanguage(text: string): string | undefined {
  for (const [re, lang] of SCRIPTS) if (re.test(text)) return lang;
  const words = normalize(text).split(/[^\p{L}']+/u).filter(Boolean);
  if (words.length === 0) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(WORDS)) {
    const set = new Set(list.map((w) => normalize(w)));
    const score = words.reduce((acc, w) => acc + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : undefined;
}
