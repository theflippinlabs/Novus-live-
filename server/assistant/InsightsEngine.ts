import type {
  AnalyzedComment,
  ChatPulse,
  ImportantMessage,
  QuestionCluster,
  SentimentPoint,
  TopicTrend,
  ViewerRef,
} from "../../shared/types";
import { NEGATIVE_RE, POSITIVE_RE, QUESTION_START_RE, REQUEST_RE } from "../moderation/patterns";
import { contentWords, normalize } from "../moderation/text";

// Streamer assistant: extracts questions, requests, topics, sentiment and
// notable messages from the chat stream. Fully local and deterministic.

const CANON: Record<string, string> = {
  launch: "release",
  launches: "release",
  release: "release",
  released: "release",
  sortie: "release",
  sort: "release",
  date: "release",
  out: "release",
  app: "app",
  application: "app",
  applications: "app",
  appli: "app",
  discord: "discord",
  price: "price",
  cost: "price",
  prix: "price",
  combien: "price",
  free: "price",
  android: "android",
  iphone: "iphone",
  ios: "iphone",
  beta: "beta",
  waitlist: "beta",
  features: "features",
  feature: "features",
  fonctionnalites: "features",
};

const TOPIC_LABELS: Record<string, string> = {
  release: "Release date",
  app: "New application",
  discord: "Discord",
  price: "Pricing",
  android: "Android",
  iphone: "iPhone",
  beta: "Beta access",
  features: "Features",
};

const IGNORE_TOPICS = new Set(["stream", "live", "lets", "goooo", "gooo", "haha", "omg", "love", "fire", "tout", "monde", "new", "got", "miss", "wait", "try", "looks", "look", "want", "know", "think", "make", "see", "tho", "else", "everyone", "guys"]);

function canonWords(text: string): string[] {
  return [...new Set(contentWords(text).map((w) => CANON[w] ?? w))];
}

// Topic words specific enough that sharing one means "same question".
const ANCHORS = new Set(["release", "discord", "price", "android", "iphone", "beta"]);

function questionSimilarity(a: string[], b: string[]): number {
  const j = jaccard(a, b);
  const sb = new Set(b);
  return a.some((w) => ANCHORS.has(w) && sb.has(w)) ? Math.max(j, 0.5) : j;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const inter = a.filter((w) => sb.has(w)).length;
  return inter / (a.length + b.length - inter);
}

export function sentimentOf(text: string): number {
  const pos = (text.match(POSITIVE_RE) ?? []).length;
  const neg = (text.match(NEGATIVE_RE) ?? []).length;
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

export function isQuestion(text: string): boolean {
  const n = normalize(text);
  return n.includes("?") || QUESTION_START_RE.test(n);
}

interface ClusterState extends QuestionCluster {
  words: string[];
  askerSet: Set<string>;
}

interface Entry {
  t: number;
  words: string[];
  sentiment: number;
}

export class InsightsEngine {
  private questions = new Map<string, ClusterState>();
  private requests = new Map<string, ClusterState>();
  private entries: Entry[] = [];
  private important: ImportantMessage[] = [];
  private seenViewers = new Set<string>();
  private minuteCounts = new Map<number, number>();
  private minuteSentiment = new Map<number, { sum: number; n: number }>();
  private seq = 0;
  streamerName = "novarys";

  reset(): void {
    this.questions.clear();
    this.requests.clear();
    this.entries = [];
    this.important = [];
    this.seenViewers.clear();
    this.minuteCounts.clear();
    this.minuteSentiment.clear();
  }

  private cluster(map: Map<string, ClusterState>, c: AnalyzedComment, words: string[]): void {
    let best: ClusterState | undefined;
    let bestScore = 0;
    for (const cl of map.values()) {
      const s = questionSimilarity(cl.words, words);
      if (s > bestScore) {
        best = cl;
        bestScore = s;
      }
    }
    if (best && bestScore >= 0.34) {
      best.count += 1;
      best.askerSet.add(c.viewer.username);
      best.askers = [...best.askerSet].slice(-12);
      // A question asked again well after being answered is live again.
      if (best.answered && c.timestamp - best.lastAskedAt > 60_000) best.answered = false;
      best.lastAskedAt = c.timestamp;
      return;
    }
    if (map.size >= 300) {
      const oldest = [...map.values()].sort((a, b) => a.lastAskedAt - b.lastAskedAt)[0];
      map.delete(oldest.id);
    }
    this.seq += 1;
    const id = `q${this.seq}`;
    map.set(id, {
      id,
      question: c.text.trim().slice(0, 140),
      count: 1,
      askers: [c.viewer.username],
      askerSet: new Set([c.viewer.username]),
      firstAskedAt: c.timestamp,
      lastAskedAt: c.timestamp,
      answered: false,
      words,
    });
  }

  addComment(c: AnalyzedComment): void {
    const minute = Math.floor(c.timestamp / 60_000) * 60_000;
    this.minuteCounts.set(minute, (this.minuteCounts.get(minute) ?? 0) + 1);

    const toxic = c.analysis.severity === "warning" || c.analysis.severity === "critical";
    const sentiment = toxic ? -0.8 : sentimentOf(c.text);
    const ms = this.minuteSentiment.get(minute) ?? { sum: 0, n: 0 };
    ms.sum += sentiment;
    ms.n += 1;
    this.minuteSentiment.set(minute, ms);

    const words = canonWords(c.text);
    const isHost = normalize(c.viewer.username) === normalize(this.streamerName);
    this.entries.push({ t: c.timestamp, words: toxic ? [] : words, sentiment });
    const cutoff = c.timestamp - 15 * 60_000;
    while (this.entries.length && this.entries[0].t < cutoff) this.entries.shift();

    if (isHost) {
      // The host answering in chat marks matching questions as answered.
      for (const q of this.questions.values()) if (jaccard(q.words, words) > 0 || q.words.some((w) => words.includes(w))) q.answered = true;
    } else if (!toxic && words.length > 0) {
      if (isQuestion(c.text)) this.cluster(this.questions, c, words);
      else if (REQUEST_RE.test(normalize(c.text))) this.cluster(this.requests, c, words);
    }

    const firstMessage = !this.seenViewers.has(c.viewer.id);
    this.seenViewers.add(c.viewer.id);
    if (!toxic && !isHost) {
      const n = normalize(c.text);
      if (firstMessage && /\b(first time|premiere fois|new here|nouveau ici)\b/.test(n)) this.addImportant(c, "First-time viewer");
      else if (n.includes(normalize(this.streamerName)) && sentiment > 0) this.addImportant(c, "Mentions the streamer");
      else if (c.text.length > 70 && sentiment > 0.3) this.addImportant(c, "Thoughtful supportive message");
    }
  }

  addGift(viewer: ViewerRef, giftName: string, count: number, value: number | undefined, t: number, id: string): void {
    if ((value ?? 0) * count >= 100 || count >= 10) {
      this.important.push({ commentId: id, viewer, text: `sent ${count}× ${giftName}`, reason: "Big gift", t });
      this.trimImportant();
    }
  }

  private addImportant(c: AnalyzedComment, reason: string): void {
    this.important.push({ commentId: c.id, viewer: c.viewer, text: c.text, reason, t: c.timestamp });
    this.trimImportant();
  }

  private trimImportant(): void {
    if (this.important.length > 50) this.important.splice(0, this.important.length - 50);
  }

  markAnswered(id: string, answered = true): boolean {
    const q = this.questions.get(id) ?? this.requests.get(id);
    if (!q) return false;
    q.answered = answered;
    return true;
  }

  private publicCluster(c: ClusterState): QuestionCluster {
    return {
      id: c.id,
      question: c.question,
      count: c.count,
      askers: c.askers,
      firstAskedAt: c.firstAskedAt,
      lastAskedAt: c.lastAskedAt,
      answered: c.answered,
    };
  }

  topQuestions(limit = 5, since = 0): QuestionCluster[] {
    return [...this.questions.values()]
      .filter((q) => q.lastAskedAt >= since)
      .sort((a, b) => b.count - a.count || b.lastAskedAt - a.lastAskedAt)
      .slice(0, limit)
      .map((q) => this.publicCluster(q));
  }

  topRequests(limit = 4): QuestionCluster[] {
    return [...this.requests.values()]
      .filter((q) => q.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((q) => this.publicCluster(q));
  }

  trending(now: number, limit = 5): TopicTrend[] {
    const cur = new Map<string, number>();
    const prev = new Map<string, number>();
    for (const e of this.entries) {
      const target = e.t >= now - 5 * 60_000 ? cur : e.t >= now - 10 * 60_000 ? prev : null;
      if (!target) continue;
      for (const w of e.words) if (!IGNORE_TOPICS.has(w)) target.set(w, (target.get(w) ?? 0) + 1);
    }
    return [...cur.entries()]
      .filter(([, n]) => n >= 2)
      .map(([w, n]) => {
        const p = prev.get(w) ?? 0;
        return { topic: TOPIC_LABELS[w] ?? w.charAt(0).toUpperCase() + w.slice(1), count: n, growth: p ? Math.round(((n - p) / p) * 100) : 100 };
      })
      .sort((a, b) => b.count - a.count || b.growth - a.growth)
      .slice(0, limit);
  }

  sentimentSeries(): SentimentPoint[] {
    return [...this.minuteSentiment.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-30)
      .map(([t, v]) => ({ t, value: Math.round((v.sum / v.n) * 100) / 100 }));
  }

  private sentimentWindow(from: number, to: number): { avg: number; n: number } {
    let sum = 0;
    let n = 0;
    for (const e of this.entries) if (e.t >= from && e.t < to) {
      sum += e.sentiment;
      n += 1;
    }
    return { avg: n ? sum / n : 0, n };
  }

  sentiment(now: number): ChatPulse["sentiment"] {
    const cur = this.sentimentWindow(now - 2 * 60_000, now + 1);
    const prev = this.sentimentWindow(now - 5 * 60_000, now - 2 * 60_000);
    const change = prev.n >= 5 && cur.n >= 5 ? cur.avg - prev.avg : 0;
    const label = cur.avg > 0.35 ? "Very positive" : cur.avg > 0.1 ? "Positive" : cur.avg < -0.3 ? "Hostile" : cur.avg < -0.08 ? "Tense" : "Neutral";
    const shift = Math.abs(change) >= 0.3 ? (change < 0 ? "Sudden negative shift" : "Mood lifting fast") : null;
    return { current: Math.round(cur.avg * 100) / 100, label, change: Math.round(change * 100) / 100, shift };
  }

  spikes(): { t: number; messages: number }[] {
    const vals = [...this.minuteCounts.entries()].sort((a, b) => a[0] - b[0]);
    if (vals.length < 4) return [];
    const nums = vals.map(([, v]) => v);
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    return vals.filter(([, v]) => v > mean + 2 * sd && v > 10).map(([t, messages]) => ({ t, messages }));
  }

  activityChangePct(now: number): number {
    const minute = Math.floor(now / 60_000) * 60_000;
    // Compare the last full minute with the average of the five before it.
    const last = this.minuteCounts.get(minute - 60_000) ?? this.minuteCounts.get(minute) ?? 0;
    let sum = 0;
    let n = 0;
    for (let i = 2; i <= 6; i++) {
      const v = this.minuteCounts.get(minute - i * 60_000);
      if (v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    if (!n || sum === 0) return 0;
    return Math.round(((last - sum / n) / (sum / n)) * 100);
  }

  importantMessages(since = 0, limit = 8): ImportantMessage[] {
    return this.important.filter((m) => m.t >= since).slice(-limit).reverse();
  }
}
