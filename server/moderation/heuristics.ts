import { explainI18n } from "../../shared/i18n";
import { thresholdsFor } from "../../shared/settings";
import type {
  Category,
  ModerationAnalysis,
  RecommendedAction,
  Settings,
  Severity,
  Thresholds,
  ViewerFlag,
} from "../../shared/types";
import { HOSTILE_CATEGORIES, type RoomContext, type ViewerContext } from "./context";
import { IMPERSONATION_NAME_RE, MITIGATION_RE, NEGATIVE_RE, PATTERNS, SHORTENER_RE, TARGET_RE } from "./patterns";
import { capsRatio, deLeet, emojiCount, extractUrls, fingerprint, normalize, similarity } from "./text";

// Stage 1: fast, deterministic, local. Runs on every single message.

export interface Stage1Input {
  text: string;
  username: string;
  timestamp: number;
  viewer: ViewerContext;
  room: RoomContext;
  settings: Settings;
}

export interface Stage1Result {
  analysis: ModerationAnalysis;
  fp: string;
  hostile: boolean;
  /** Should stage 2 (contextual AI) look at this message? */
  ambiguous: boolean;
  /** Raw score before flag (trusted/watchlist) adjustments. */
  rawScore: number;
}

const CONTEXTUAL: ReadonlySet<Category> = new Set<Category>([
  "insult",
  "harassment",
  "hate",
  "sexual_harassment",
  "impersonation",
  "escalation",
  "coordinated_attack",
]);

const SEVERE: ReadonlySet<Category> = new Set<Category>(["threat", "doxxing", "hate", "sexual_harassment"]);

const BENIGN_BURSTS = new Set([
  "hi",
  "hello",
  "hey",
  "salut",
  "coucou",
  "lol",
  "gg",
  "wow",
  "first",
  "yes",
  "yay",
  "hype",
  "lets go",
  "letsgo",
  "bonjour",
  "love you",
  "ily",
  "w",
  "w stream",
]);

class Signals {
  private map = new Map<Category, { w: number; reasons: string[] }>();

  add(category: Category, weight: number, reason: string): void {
    const cur = this.map.get(category);
    if (!cur) {
      this.map.set(category, { w: Math.min(0.95, weight), reasons: [reason] });
      return;
    }
    // Multiple hits in the same category reinforce each other with diminishing returns.
    cur.w = Math.min(0.95, Math.max(cur.w, weight) + Math.min(cur.w, weight) * 0.25);
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
  }

  scale(category: Category, factor: number): void {
    const cur = this.map.get(category);
    if (cur) cur.w *= factor;
  }

  has(category: Category): boolean {
    return this.map.has(category);
  }

  categories(): Category[] {
    return [...this.map.keys()];
  }

  drop(category: Category): void {
    this.map.delete(category);
  }

  combined(): number {
    let keep = 1;
    for (const { w } of this.map.values()) keep *= 1 - w;
    return Math.round((1 - keep) * 100);
  }

  /** Reasons ordered by weight (strongest first). */
  reasons(): string[] {
    return [...this.map.values()].sort((a, b) => b.w - a.w).flatMap((v) => v.reasons);
  }

  size(): number {
    return this.map.size;
  }
}

export function effectiveThresholds(settings: Settings, flag: ViewerFlag | null): Thresholds {
  const t = thresholdsFor(settings);
  if (flag === "trusted") {
    return { watch: Math.min(97, t.watch + 15), warning: Math.min(98, t.warning + 15), critical: Math.min(99, t.critical + 12) };
  }
  if (flag === "watchlist") {
    return { watch: Math.max(1, t.watch - 10), warning: Math.max(2, t.warning - 10), critical: Math.max(3, t.critical - 8) };
  }
  return t;
}

export function severityFor(score: number, t: Thresholds): Severity {
  if (score >= t.critical) return "critical";
  if (score >= t.warning) return "warning";
  if (score >= t.watch) return "watch";
  return "normal";
}

export function recommendFor(severity: Severity, categories: Category[], score: number, priorWarnings: number): RecommendedAction {
  const has = (c: Category) => categories.includes(c);
  switch (severity) {
    case "critical":
      if ((has("threat") && has("doxxing")) || (has("hate") && score >= 90) || (has("doxxing") && score >= 92)) return "report";
      if (categories.some((c) => SEVERE.has(c)) || has("scam") || has("impersonation")) return "block";
      return "mute";
    case "warning":
      if (has("scam") || has("impersonation")) return "block";
      if (categories.some((c) => SEVERE.has(c)) || priorWarnings > 0 || has("flooding") || has("coordinated_attack")) return "mute";
      return "warn";
    case "watch":
      return "watch";
    default:
      return "none";
  }
}

const NEGATIVE_ONCE = new RegExp(NEGATIVE_RE.source, "u");

function isFlooding(viewer: ViewerContext, now: number): number {
  return viewer.recent.filter((m) => m.t >= now - 10_000).length;
}

/** Strict mode: topics a human moderator wants a second look at, even without a clear insult. */
const STRICT_NET_RE =
  /\b(racist|racism|sexist|nazi|slur|ethnicity|race|black|white people|asian|mexican|gay|trans|religion|kill|die|dead|fuck|fck|shit|bitch|hoe|whore|slut|retard|sell|selling|dm|dms|snap|insta|telegram|whatsapp|cashapp|paypal)\b/;

/** Personal / body questions or shouted demands that a human might find rude. */
function rudeQuestion(text: string): boolean {
  return /\b(height|weight|how old|age|bra size|body count|single|boyfriend|address|where do you live)\b/i.test(text) || (text.length >= 8 && capsRatio(text) > 0.75 && /[?!]/.test(text));
}

export function analyzeStage1(input: Stage1Input): Stage1Result {
  const { text, username, timestamp: now, viewer, room, settings } = input;
  const n = normalize(text);
  const fp = fingerprint(text);
  const directed = TARGET_RE.test(n);
  const banter = MITIGATION_RE.test(n) || MITIGATION_RE.test(text);
  const s = new Signals();

  // --- known patterns -------------------------------------------------------------
  for (const rule of PATTERNS) {
    if (rule.needsTarget && !directed) continue;
    const m = rule.re.exec(n);
    if (!m) continue;
    if (rule.reason === "Shares a phone number" && m[0].replace(/\D/g, "").length < 9) continue;
    s.add(rule.category, rule.weight, rule.reason);
  }

  // Threat + personal info together is much worse than either alone.
  if (s.has("threat") && s.has("doxxing")) s.add("threat", 0.8, "Threat with personal info");
  // A targeted insult directed at someone is harassment, not banter.
  if (s.has("insult") && directed && !banter) s.add("harassment", 0.25, "Directed at someone");

  // --- custom banned phrases ----------------------------------------------------------
  for (const phrase of settings.bannedPhrases) {
    const p = normalize(phrase);
    if (p && n.includes(p)) {
      s.add("banned_phrase", 0.5, `Banned phrase “${phrase}”`);
      break;
    }
  }

  // --- links ------------------------------------------------------------------------
  const urls = extractUrls(text);
  if (urls.length) {
    const shortener = urls.some((u) => SHORTENER_RE.test(u.toLowerCase()));
    s.add("suspicious_link", shortener ? 0.4 : 0.2, shortener ? "Shortened link" : "Contains link");
    if (s.has("scam")) s.add("scam", 0.35, "Scam with link");
  }

  // --- impersonation (username) --------------------------------------------------------
  const uname = deLeet(username).replace(/[^a-z0-9]/g, "");
  const streamer = deLeet(settings.streamerName).replace(/[^a-z0-9]/g, "");
  if (streamer && uname !== streamer) {
    const looksLikeStreamer = uname.includes(streamer) || similarity(uname, streamer) >= 0.5;
    if (looksLikeStreamer) {
      s.add("impersonation", IMPERSONATION_NAME_RE.test(uname) ? 0.5 : 0.35, "Look-alike of streamer account");
      if (/\b(gift|gifts|send|donate|paypal|cash|coins|cadeau)\b/.test(n)) s.add("impersonation", 0.4, "Asks for gifts/money");
    } else if (IMPERSONATION_NAME_RE.test(uname) && (s.has("impersonation") || urls.length > 0)) {
      s.add("impersonation", 0.25, "Official-sounding username");
    }
  }

  // --- spam shape -----------------------------------------------------------------------
  if (text.length >= 12 && capsRatio(text) > 0.75) s.add("spam", 0.12, "Excessive caps");
  if (emojiCount(text) >= 10) s.add("spam", 0.18, "Emoji flood");
  if (/(.)\1{9,}/u.test(text)) s.add("spam", 0.15, "Character flood");

  // --- per-viewer context ---------------------------------------------------------------
  const burst = isFlooding(viewer, now);
  if (burst >= 4) s.add("flooding", burst >= 7 ? 0.45 : 0.3, `Flooding ${burst + 1} msgs/10s`);

  const shortFp = fp.length < 4 || fp.startsWith("emoji:");
  const repeats = viewer.recent.filter(
    (m) => m.t >= now - 120_000 && (m.fp === fp || (!shortFp && similarity(m.fp, fp) >= 0.82)),
  ).length;
  if (repeats >= (shortFp ? 3 : 1) && fp) {
    s.add("repetition", Math.min(0.45, 0.14 * repeats), `Repeated ${repeats + 1}x`);
    if (s.has("spam") || s.has("scam") || s.has("suspicious_link")) s.add("spam", 0.25, "Repeated promotion");
  }

  // --- room context: coordinated bursts / pile-ons ----------------------------------------
  // Many people typing the same friendly thing ("hello everyone!", "when does it launch?") is an
  // echo, not an attack. A burst only counts when the content itself is negative, promotional or raid-like.
  const raidLanguage = /\b(raid|raiding|mass report|l stream|l+ streamer|ratio|w+ raid)\b/.test(n);
  const negativeContent = NEGATIVE_ONCE.test(text) || NEGATIVE_ONCE.test(n);
  const burstEligible = fp && !BENIGN_BURSTS.has(fp) && !shortFp && (raidLanguage || negativeContent || s.size() > 0);
  const sameAccounts = burstEligible ? room.sameMessageAccounts(fp, viewer.viewerId, now) : 0;
  if (sameAccounts >= 2) {
    const total = sameAccounts + 1;
    s.add("coordinated_attack", Math.min(0.6, 0.3 + 0.05 * (total - 3)), `Coordinated burst (${total} accounts)`);
    s.add("spam", 0.15, "Copy-paste message");
    if (raidLanguage) s.add("coordinated_attack", 0.35, "Raid language");
  }

  const hostileNow = [...HOSTILE_CATEGORIES].some((c) => s.has(c));
  if (hostileNow) {
    // Pile-on: several *other* accounts hostile within the last 30s, and this message is not banter.
    const pileOn = banter ? 0 : room.hostileAccounts(viewer.viewerId, now, 30_000);
    if (pileOn >= 3) s.add("coordinated_attack", Math.min(0.4, 0.15 + 0.04 * pileOn), `Pile-on (${pileOn + 1} hostile accounts)`);

    // Escalation: repeated hostility from the same viewer over time.
    const priorHostile = viewer.recent.filter((m) => m.hostile && m.t >= now - 5 * 60_000);
    if (priorHostile.length >= 1) {
      s.add("escalation", Math.min(0.45, 0.15 + 0.1 * priorHostile.length), `Repeated hostility (${priorHostile.length + 1}x)`);
      const lastScores = priorHostile.slice(-3).map((m) => m.score);
      const rising = lastScores.every((v, i) => i === 0 || v >= lastScores[i - 1]);
      if (lastScores.length >= 2 && rising) s.add("escalation", 0.2, "Escalating over time");
    }
    if (viewer.warnings > 0) s.add("escalation", 0.2, "Re-offending after warning");
  }

  // --- mitigation: banter without history is probably friendly teasing -----------------------
  const priorHostileCount = viewer.recent.filter((m) => m.hostile).length;
  if (banter && priorHostileCount === 0 && !s.has("threat") && !s.has("doxxing") && !s.has("hate")) {
    s.scale("insult", 0.45);
    s.scale("harassment", 0.5);
  }

  for (const c of s.categories()) if (!settings.categories[c]) s.drop(c);

  const rawScore = s.combined();
  const flag = viewer.flag;
  let score = rawScore;
  // Trusted viewers get the benefit of the doubt on banter-like signals, but not on serious harm.
  if (flag === "trusted") score = Math.round(rawScore * (s.categories().some((c) => SEVERE.has(c)) ? 0.85 : 0.6));
  if (flag === "watchlist" && rawScore > 0) score = Math.min(100, Math.round(rawScore * 1.15 + 5));

  const thresholds = effectiveThresholds(settings, flag);
  const severity = severityFor(score, thresholds);
  const categories = s.categories();
  const reasons = s.reasons();
  const recommendedAction = recommendFor(severity, categories, score, viewer.warnings);

  const strong = categories.filter((c) => !CONTEXTUAL.has(c)).length;
  const confidence =
    categories.length === 0
      ? 0.9
      : Math.min(0.95, 0.5 + 0.12 * strong + 0.04 * reasons.length + (banter ? -0.1 : 0));

  const hostile = categories.some((c) => HOSTILE_CATEGORIES.has(c));
  // Stage 2 gets: flagged-but-uncertain messages, contextual categories, and hostile words
  // wrapped in banter ("lol you're such a clown") where only context can tell.
  // Strict: anything with a weak signal or a negative tone gets a second look by the AI, even
  // when it scores below the thresholds (veiled digs, rude questions, misspelled insults).
  const strictNet =
    settings.sensitivity === "strict" &&
    severity === "normal" &&
    flag !== "trusted" &&
    (score > 0 || new RegExp(NEGATIVE_RE.source, "u").test(n) || STRICT_NET_RE.test(n) || rudeQuestion(text));
  const ambiguous =
    (severity !== "normal" &&
      score < 97 &&
      (confidence < 0.75 || categories.some((c) => CONTEXTUAL.has(c)) || banter || flag === "trusted")) ||
    (severity === "normal" && banter && hostile) ||
    strictNet;

  return {
    analysis: {
      riskScore: score,
      severity,
      categories,
      explanation: explainI18n(categories, severity, flag).en,
      explanationI18n: explainI18n(categories, severity, flag),
      recommendedAction,
      confidence: Math.round(confidence * 100) / 100,
      reasons: reasons.slice(0, 5),
      stage: "heuristic",
    },
    fp,
    hostile,
    ambiguous,
    rawScore,
  };
}

/** English explanation (canonical); both languages are in `explanationI18n`. */
export function explain(categories: Category[], severity: Severity, flag: ViewerFlag | null): string {
  return explainI18n(categories, severity, flag).en;
}
