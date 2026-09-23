// Text normalization and similarity helpers used by stage-1 heuristics.

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Lowercase, strip accents, collapse whitespace. Keeps punctuation that matters for URLs. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aggressive fingerprint for repetition detection: no emoji, no punctuation, de-leeted, collapsed repeats. */
export function fingerprint(text: string): string {
  const n = normalize(text)
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
  return n.length > 0 ? n : emojiSignature(text);
}

function emojiSignature(text: string): string {
  const emojis = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  return emojis.length ? `emoji:${[...new Set(emojis)].sort().join("")}` : "";
}

export function deLeet(text: string): string {
  return normalize(text).replace(/[0-9@$]/g, (c) => LEET[c] ?? c);
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Jaccard similarity over character trigrams (0..1). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function capsRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 8) return 0;
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return upper / letters.length;
}

export function emojiCount(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

export const URL_RE = /\b((?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+\.(?:ly|gg|me|io|xyz|top|click|link|site|online|shop|live|ru|cc|tk|com|net|org|fr)\/[^\s]*)/i;

export function extractUrls(text: string): string[] {
  const re = new RegExp(URL_RE.source, "gi");
  return text.match(re) ?? [];
}

const STOPWORDS_EN = new Set(
  "a an the and or but if then so to of in on at for with from by is are was were be been am i you he she it we they me my your our their this that these those do does did have has had not no yes just like lol im its it's what when where why how who can could will would should u ur pls please oh ok okay hi hey hello guys all get got go going one more very really too also there here out up about as".split(
    " ",
  ),
);
const STOPWORDS_FR = new Set(
  "le la les un une des de du et ou mais donc or ni car je tu il elle on nous vous ils elles me te se ce cet cette ces mon ton son ma ta sa mes tes ses est suis es sont etre avoir ai as a avez ont pas ne plus que qui quoi quand comment pourquoi ou oui non dans sur pour par avec en au aux y c ca cest trop tres bien bah ben salut coucou mdr ptdr".split(
    " ",
  ),
);

export function isStopword(w: string): boolean {
  return STOPWORDS_EN.has(w) || STOPWORDS_FR.has(w);
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .replace(URL_RE, " ")
    // French elisions: l'application → application, qu'il → il
    .replace(/\b(l|d|j|c|qu|n|s|t|m)'/g, " ")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 1);
}

export function contentWords(text: string): string[] {
  return tokenize(text).filter((w) => !isStopword(w) && w.length > 2 && !/^\d+$/.test(w));
}
