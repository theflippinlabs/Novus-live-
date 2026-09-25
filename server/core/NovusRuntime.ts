import { randomUUID } from "node:crypto";
import { defaultSettings } from "../../shared/settings";
import {
  CATEGORIES,
  SEVERITIES,
  type ActionRecord,
  type ActionType,
  type AnalyticsSummary,
  type AnalyzedComment,
  type Category,
  type ChatPulse,
  type DemoSpeed,
  type LiveComment,
  type LiveEvent,
  type LiveSessionInfo,
  type LiveStats,
  type ModerationAlert,
  type ModerationAnalysis,
  type PlatformId,
  type RiskPoint,
  type Settings,
  type Snapshot,
  type StreamReport,
  type ChatLine,
  type ViewerCommentSummary,
  type ViewerFlag,
  type ViewerListItem,
  type ViewerProfile,
  type ViewerRef,
} from "../../shared/types";
import { SimulatedActionAdapter, TikTokManualActionAdapter } from "../actions/adapters";
import { runAction, type ModerationActionAdapter } from "../actions/ModerationActionAdapter";
import { AIQueue, type AIQueueOptions } from "../ai/AIQueue";
import type { AIProvider, AIReviewItem, AIVerdict } from "../ai/AIProvider";
import { Analytics } from "../analytics/Analytics";
import { buildReportMarkdown } from "../analytics/report";
import { buildCatchUp } from "../assistant/catchUp";
import { InsightsEngine, sentimentOf } from "../assistant/InsightsEngine";
import { HOSTILE_CATEGORIES, RoomContext, ViewerContextStore } from "../moderation/context";
import { analyzeStage1, effectiveThresholds, recommendFor, severityFor } from "../moderation/heuristics";
import { detectLanguage } from "../moderation/language";
import { fingerprint } from "../moderation/text";
import { emptyBatch, type PersistBatch, type Repository } from "../persistence/Repository";
import type { MockLiveAdapter } from "../platform/MockLiveAdapter";
import type { TikTokAdapter } from "../platform/TikTokAdapter";
import type { RealtimeHub } from "../realtime/RealtimeHub";

/*
 * The server-side ingestion pipeline:
 *
 *   platform adapter → normalized LiveEvent → stage-1 heuristics → contextual
 *   state update → (optional) stage-2 AI → persist → batched realtime update
 */

/** Newest reasons first; "Repeated 4x" supersedes "Repeated 3x" (same kind, different count). */
export function mergeReasons(latest: string[], older: string[]): string[] {
  const kind = (r: string) => r.replace(/\(?\d+x?\)?/g, "#");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...latest, ...older]) {
    const k = kind(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.slice(0, 6);
}

const SEV_RANK: Record<string, number> = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
const MAX_COMMENTS = 3000;
const MAX_ALERTS = 2000;
const ALERT_MERGE_WINDOW_MS = 10 * 60_000;
const DEMO_MUTE_MS = 5 * 60_000;
// How often a running LIVE's report is re-saved, so history survives a server restart.
const REPORT_SAVE_MS = 60_000;

interface ViewerState {
  viewer: ViewerRef;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  times: number[];
  warnings: number;
  alertIds: string[];
  riskTrend: RiskPoint[];
  recentComments: ViewerCommentSummary[];
  categories: Partial<Record<Category, number>>;
  assessment: ModerationAnalysis | null;
  actions: ActionRecord[];
  gifts: number;
  maxRisk: number;
  language?: string;
  /** Demo platform only: simulated mute/block suppress the viewer's messages. */
  silencedUntil?: number;
}

export interface RuntimeDeps {
  repo: Repository;
  ai: AIProvider;
  tiktok: TikTokAdapter;
  mock?: MockLiveAdapter;
  hub?: RealtimeHub;
  aiQueueOptions?: AIQueueOptions;
  clock?: () => number;
  persistIntervalMs?: number;
  log?: (msg: string) => void;
}

export class NovusRuntime {
  settings: Settings = defaultSettings();
  session: LiveSessionInfo | null = null;

  private comments: AnalyzedComment[] = [];
  private commentIndex = new Map<string, AnalyzedComment>();
  private viewers = new Map<string, ViewerState>();
  private alerts = new Map<string, ModerationAlert>();
  private openAlertByViewer = new Map<string, string>();
  private coordinatedAlertByFp = new Map<string, string>();
  private actions: ActionRecord[] = [];
  private ignored = new Set<string>();
  private recentTimes: number[] = [];
  private counters = { messages: 0, gifts: 0, follows: 0, joins: 0, viewerCount: 0 };
  /** Audience samples and gift ledger for the LIVE history / PDF report. */
  private audience = { peak: 0, peakAt: null as number | null, sum: 0, samples: 0 };
  private giftsBySender = new Map<string, { viewer: ViewerRef; gifts: number; diamonds: number }>();
  private giftsByName = new Map<string, { name: string; count: number; diamonds: number }>();
  private diamonds = 0;
  private lastReportSave = 0;

  readonly context = new ViewerContextStore();
  readonly room = new RoomContext();
  readonly insights = new InsightsEngine();
  readonly analytics = new Analytics();
  readonly aiQueue: AIQueue;

  private pending: PersistBatch = emptyBatch();
  private dirtyViewers = new Set<string>();
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private lastPersistError = 0;
  private now: () => number;
  private simulated: SimulatedActionAdapter;
  private manual = new TikTokManualActionAdapter();

  constructor(private deps: RuntimeDeps) {
    this.now = deps.clock ?? Date.now;
    this.aiQueue = new AIQueue(
      deps.ai,
      () => ({
        streamerName: this.settings.streamerName,
        language: this.settings.language,
        room: this.comments.slice(-20).map((c) => ({ username: c.viewer.username, text: c.text })),
      }),
      (item, verdict) => this.applyVerdict(item, verdict),
      deps.aiQueueOptions,
    );
    this.simulated = new SimulatedActionAdapter((action, target) => {
      const v = this.viewers.get(target.viewer.id);
      if (!v) return;
      if (action === "mute") v.silencedUntil = this.now() + DEMO_MUTE_MS;
      if (action === "block") v.silencedUntil = Number.POSITIVE_INFINITY;
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Storage shared by every room (used by the LIVE history). */
  get repository(): Repository {
    return this.deps.repo;
  }

  async init(): Promise<void> {
    await this.deps.repo.init();
    const stored = await this.deps.repo.loadSettings();
    if (stored) this.settings = { ...defaultSettings(), ...stored, categories: { ...defaultSettings().categories, ...stored.categories } };
    const flags = await this.deps.repo.loadViewerFlags();
    for (const [u, f] of Object.entries(flags)) if (f === "ignored") this.ignored.add(u);
    this.applySettingsSideEffects();
    this.persistTimer = setInterval(() => void this.flushPersist(), this.deps.persistIntervalMs ?? 2000);
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) clearInterval(this.persistTimer);
    await this.deps.mock?.stop();
    this.aiQueue.clear();
    await this.flushPersist();
  }

  private resetLiveState(): void {
    this.comments = [];
    this.commentIndex.clear();
    this.viewers.clear();
    this.alerts.clear();
    this.openAlertByViewer.clear();
    this.coordinatedAlertByFp.clear();
    this.actions = [];
    this.recentTimes = [];
    this.counters = { messages: 0, gifts: 0, follows: 0, joins: 0, viewerCount: 0 };
    this.audience = { peak: 0, peakAt: null, sum: 0, samples: 0 };
    this.giftsBySender.clear();
    this.giftsByName.clear();
    this.diamonds = 0;
    this.lastReportSave = 0;
    this.context.clear();
    this.room.clear();
    this.insights.reset();
    this.analytics.reset();
    this.aiQueue.clear();
    this.insights.streamerName = this.settings.streamerName;
  }

  async startSession(source: LiveSessionInfo["source"], platform: PlatformId, title: string): Promise<LiveSessionInfo> {
    if (this.session?.status === "live") await this.endSession();
    this.resetLiveState();
    this.session = {
      id: `ses_${this.now().toString(36)}_${randomUUID().slice(0, 6)}`,
      platform,
      source,
      title,
      status: "live",
      startedAt: this.now(),
    };
    await this.deps.repo.saveSession(this.session).catch((e) => this.persistError(e));
    this.deps.hub?.pushExtras({ reset: true, session: this.session });
    return this.session;
  }

  async endSession(): Promise<StreamReport | null> {
    if (!this.session || this.session.status !== "live") return null;
    if (this.deps.mock?.isRunning()) await this.deps.mock.stop();
    this.session = { ...this.session, status: "ended", endedAt: this.now() };
    await this.flushPersist();
    await this.deps.repo.saveSession(this.session).catch((e) => this.persistError(e));
    const report = this.report();
    await this.deps.repo.saveReport(report).catch((e) => this.persistError(e));
    this.deps.hub?.pushExtras({ session: this.session });
    return report;
  }

  async startDemo(speed: DemoSpeed = 1): Promise<LiveSessionInfo> {
    const mock = this.deps.mock;
    if (!mock) throw new Error("Demo adapter unavailable");
    const session = await this.startSession("demo", "mock", "Demo LIVE");
    mock.setSpeed(speed);
    await mock.start(session.id, (e) => this.ingest(e));
    return session;
  }

  setDemoSpeed(speed: DemoSpeed): void {
    this.deps.mock?.setSpeed(speed);
    this.deps.hub?.markDirty();
  }

  /** Events pushed by an authorized external connector (e.g. an approved TikTok LIVE source). */
  async ingestExternal(events: LiveEvent[], platform: "tiktok" | "external"): Promise<number> {
    const first = events[0];
    const startsStream = first?.type === "stream_status" && first.status === "started";
    if (!this.session || this.session.status !== "live" || this.session.source === "demo" || startsStream) {
      const title = (first?.type === "stream_status" && first.title) || (platform === "tiktok" ? "TikTok LIVE" : "External LIVE");
      await this.startSession(platform === "tiktok" ? "tiktok" : "external", platform, title);
    }
    const sessionId = this.session!.id;
    let n = 0;
    for (const e of events) {
      const ev = { ...e, sessionId, platform } as LiveEvent;
      if (platform === "tiktok") this.deps.tiktok.noteEvent(ev);
      this.ingest(ev);
      n++;
      if (ev.type === "stream_status" && ev.status === "ended") await this.endSession();
    }
    return n;
  }

  // ---------------------------------------------------------------- pipeline

  ingest(event: LiveEvent): AnalyzedComment | null {
    if (!this.session || this.session.status !== "live") return null;
    const t = event.timestamp;
    if (event.type !== "comment") this.pending.events.push(event);
    switch (event.type) {
      case "comment":
        return this.processComment(event);
      case "viewer_count":
        this.counters.viewerCount = event.count;
        this.analytics.addViewerCount(t, event.count);
        this.audience.sum += event.count;
        this.audience.samples += 1;
        if (event.count > this.audience.peak) this.audience = { ...this.audience, peak: event.count, peakAt: t };
        break;
      case "gift": {
        this.counters.gifts += event.count;
        const diamonds = Math.max(0, (event.value ?? 0) * event.count);
        this.diamonds += diamonds;
        const sender = this.giftsBySender.get(event.viewer.id) ?? { viewer: event.viewer, gifts: 0, diamonds: 0 };
        sender.gifts += event.count;
        sender.diamonds += diamonds;
        this.giftsBySender.set(event.viewer.id, sender);
        const kind = this.giftsByName.get(event.giftName) ?? { name: event.giftName, count: 0, diamonds: 0 };
        kind.count += event.count;
        kind.diamonds += diamonds;
        this.giftsByName.set(event.giftName, kind);
        const v = this.touchViewer(event.viewer, t);
        v.gifts += event.count;
        this.insights.addGift(event.viewer, event.giftName, event.count, event.value, t, event.id);
        break;
      }
      case "follow":
        this.counters.follows += 1;
        this.touchViewer(event.viewer, t);
        break;
      case "join":
        this.counters.joins += 1;
        this.touchViewer(event.viewer, t);
        break;
      case "moderation":
      case "stream_status":
        break;
    }
    this.deps.hub?.markDirty();
    return null;
  }

  private touchViewer(viewer: ViewerRef, t: number): ViewerState {
    let v = this.viewers.get(viewer.id);
    if (!v) {
      v = {
        viewer,
        firstSeen: t,
        lastSeen: t,
        messageCount: 0,
        times: [],
        warnings: 0,
        alertIds: [],
        riskTrend: [],
        recentComments: [],
        categories: {},
        assessment: null,
        actions: [],
        gifts: 0,
        maxRisk: 0,
      };
      this.viewers.set(viewer.id, v);
    } else {
      v.lastSeen = Math.max(v.lastSeen, t);
      if (viewer.avatarUrl && !v.viewer.avatarUrl) v.viewer = { ...v.viewer, avatarUrl: viewer.avatarUrl };
    }
    return v;
  }

  flagFor(username: string): ViewerFlag | null {
    const u = username.toLowerCase();
    if (this.ignored.has(u)) return "ignored";
    if (this.settings.trustedUsers.includes(u)) return "trusted";
    if (this.settings.watchlist.includes(u)) return "watchlist";
    return null;
  }

  private processComment(e: LiveComment): AnalyzedComment | null {
    const t = e.timestamp;
    const vs = this.touchViewer(e.viewer, t);
    if (this.session?.source === "demo" && vs.silencedUntil && vs.silencedUntil > t) return null;

    const flag = this.flagFor(e.viewer.username);
    const ctx = this.context.get(e.viewer.id, e.viewer.username);
    ctx.flag = flag === "ignored" ? null : flag;
    this.room.prune(t);

    const s1 = analyzeStage1({ text: e.text, username: e.viewer.username, timestamp: t, viewer: ctx, room: this.room, settings: this.settings });
    const wantsAI = s1.ambiguous && flag !== "ignored" && this.settings.aiEnabled && this.aiQueue.active;
    const analysis: ModerationAnalysis = { ...s1.analysis, aiPending: wantsAI || undefined };
    const comment: AnalyzedComment = { ...e, language: e.language ?? detectLanguage(e.text), analysis };

    this.context.record(ctx, { id: e.id, t, text: e.text, fp: s1.fp, score: analysis.riskScore, categories: analysis.categories, hostile: s1.hostile });
    this.room.add({ t, viewerId: e.viewer.id, fp: s1.fp, hostile: s1.hostile });

    this.comments.push(comment);
    this.commentIndex.set(comment.id, comment);
    if (this.comments.length > MAX_COMMENTS) {
      const removed = this.comments.splice(0, this.comments.length - MAX_COMMENTS);
      for (const r of removed) this.commentIndex.delete(r.id);
    }
    this.counters.messages += 1;
    this.recentTimes.push(t);
    while (this.recentTimes.length && this.recentTimes[0] < t - 60_000) this.recentTimes.shift();

    this.updateViewerFromComment(vs, comment);
    this.insights.addComment(comment);
    this.analytics.addComment(comment, analysis.severity === "warning" || analysis.severity === "critical" ? -0.8 : sentimentOf(e.text));
    this.considerAlert(comment);

    if (wantsAI) {
      const queued = this.aiQueue.enqueue({
        id: comment.id,
        username: e.viewer.username,
        text: e.text,
        flag,
        heuristic: analysis,
        viewerHistory: vs.recentComments.slice(1, 7).reverse().map((c) => ({ text: c.text, riskScore: c.riskScore })),
      });
      if (!queued) comment.analysis = { ...analysis, aiPending: undefined };
    }

    this.pending.comments.push(comment);
    this.deps.hub?.pushComment(comment);
    return comment;
  }

  private updateViewerFromComment(vs: ViewerState, c: AnalyzedComment): void {
    const a = c.analysis;
    vs.messageCount += 1;
    vs.times.push(c.timestamp);
    while (vs.times.length && vs.times[0] < c.timestamp - 5 * 60_000) vs.times.shift();
    vs.language = c.language ?? vs.language;
    vs.recentComments.unshift({ id: c.id, text: c.text, t: c.timestamp, riskScore: a.riskScore, severity: a.severity });
    if (vs.recentComments.length > 25) vs.recentComments.pop();
    vs.riskTrend.push({ t: c.timestamp, score: a.riskScore });
    if (vs.riskTrend.length > 60) vs.riskTrend.shift();
    for (const cat of a.categories) vs.categories[cat] = (vs.categories[cat] ?? 0) + 1;
    vs.maxRisk = Math.max(vs.maxRisk, a.riskScore);
    if (!vs.assessment || a.riskScore >= vs.assessment.riskScore * 0.6 || c.timestamp - (vs.riskTrend.at(-2)?.t ?? 0) > 5 * 60_000) {
      vs.assessment = a;
    }
    this.dirtyViewers.add(vs.viewer.id);
  }

  private considerAlert(c: AnalyzedComment): ModerationAlert | null {
    const flag = this.flagFor(c.viewer.username);
    if (flag === "ignored") return null;
    const a = c.analysis;
    const qualifies = a.severity === "warning" || a.severity === "critical" || (a.severity === "watch" && flag === "watchlist");
    if (!qualifies) return null;

    const now = c.timestamp;

    // Coordinated bursts become ONE alert listing every participating account.
    const fp = fingerprint(c.text);
    if (a.categories.includes("coordinated_attack") && this.room.accountsFor(fp, now, 30_000).length >= 3) {
      const groupId = this.coordinatedAlertByFp.get(fp);
      const group = groupId ? this.alerts.get(groupId) : undefined;
      if (group && (group.status === "open" || group.status === "watching") && now - group.updatedAt < 120_000) {
        if (group.viewer.id === c.viewer.id || group.accounts?.some((v) => v.id === c.viewer.id)) {
          // Same account again: fall through to the per-viewer merge below.
        } else {
          const merged: ModerationAlert = {
            ...group,
            accounts: [...(group.accounts ?? []), c.viewer].slice(0, 50),
            riskScore: Math.max(group.riskScore, a.riskScore),
            severity: SEV_RANK[a.severity] > SEV_RANK[group.severity] ? a.severity : group.severity,
            reasons: mergeReasons(a.reasons, group.reasons),
            occurrences: group.occurrences + 1,
            relatedCommentIds: [...group.relatedCommentIds, c.id].slice(-50),
            updatedAt: now,
          };
          this.viewers.get(c.viewer.id)?.alertIds.push(group.id);
          this.saveAlert(merged);
          return merged;
        }
      } else {
        const earlier = this.room
          .accountsFor(fp, now, 30_000)
          .filter((id) => id !== c.viewer.id)
          .map((id) => this.viewers.get(id)?.viewer)
          .filter((v): v is ViewerRef => Boolean(v));
        const created = this.createAlert(c, earlier);
        this.coordinatedAlertByFp.set(fp, created.id);
        return created;
      }
    }

    const existingId = this.openAlertByViewer.get(c.viewer.id);
    const existing = existingId ? this.alerts.get(existingId) : undefined;

    if (existing && (existing.status === "open" || existing.status === "watching") && now - existing.updatedAt < ALERT_MERGE_WINDOW_MS && !existing.resolution) {
      const headline = a.riskScore >= existing.riskScore;
      const escalated = SEV_RANK[a.severity] > SEV_RANK[existing.severity];
      const merged: ModerationAlert = {
        ...existing,
        riskScore: Math.max(existing.riskScore, a.riskScore),
        severity: escalated ? a.severity : existing.severity,
        categories: [...new Set([...a.categories, ...existing.categories])],
        reasons: mergeReasons(a.reasons, existing.reasons),
        text: headline ? c.text : existing.text,
        commentId: headline ? c.id : existing.commentId,
        explanation: headline ? a.explanation : existing.explanation,
        explanationI18n: headline ? a.explanationI18n : existing.explanationI18n,
        recommendedAction: headline ? a.recommendedAction : existing.recommendedAction,
        confidence: headline ? a.confidence : existing.confidence,
        stage: headline ? a.stage : existing.stage,
        occurrences: existing.occurrences + 1,
        relatedCommentIds: [...existing.relatedCommentIds, c.id].slice(-20),
        status: existing.status === "watching" && (escalated || a.severity === "critical") ? "open" : existing.status,
        updatedAt: now,
      };
      this.saveAlert(merged);
      return merged;
    }

    return this.createAlert(c);
  }

  private createAlert(c: AnalyzedComment, accounts?: ViewerRef[]): ModerationAlert {
    const a = c.analysis;
    const now = c.timestamp;
    const alert: ModerationAlert = {
      id: `alr_${randomUUID()}`,
      sessionId: c.sessionId,
      viewer: c.viewer,
      commentId: c.id,
      text: c.text,
      riskScore: a.riskScore,
      severity: a.severity,
      categories: a.categories,
      reasons: a.reasons,
      explanation: a.explanation,
      explanationI18n: a.explanationI18n,
      recommendedAction: a.recommendedAction,
      confidence: a.confidence,
      stage: a.stage,
      createdAt: now,
      updatedAt: now,
      status: "open",
      occurrences: 1,
      relatedCommentIds: [c.id],
      accounts: accounts?.length ? accounts : undefined,
    };
    this.openAlertByViewer.set(c.viewer.id, alert.id);
    this.viewers.get(c.viewer.id)?.alertIds.push(alert.id);
    this.analytics.addAlert(now);
    this.saveAlert(alert);
    return alert;
  }

  private saveAlert(alert: ModerationAlert): void {
    this.alerts.set(alert.id, alert);
    if (this.alerts.size > MAX_ALERTS) {
      // Very long sessions: drop the oldest closed alerts from memory (they remain in persistence).
      const closed = [...this.alerts.values()].filter((a) => a.status === "resolved" || a.status === "dismissed").sort((a, b) => a.updatedAt - b.updatedAt);
      for (const a of closed.slice(0, this.alerts.size - MAX_ALERTS)) this.alerts.delete(a.id);
    }
    if (alert.status === "resolved" || alert.status === "dismissed") {
      if (this.openAlertByViewer.get(alert.viewer.id) === alert.id) this.openAlertByViewer.delete(alert.viewer.id);
    }
    this.pending.alerts.push(alert);
    this.deps.hub?.pushAlert(alert);
  }

  // ---------------------------------------------------------------- stage 2

  private applyVerdict(item: AIReviewItem, verdict: AIVerdict | null): void {
    const before = this.commentIndex.get(item.id);
    if (!before) return;
    if (!verdict) {
      const cleared = { ...before, analysis: { ...before.analysis, aiPending: undefined } };
      this.replaceComment(cleared);
      return;
    }
    const heur = before.analysis;
    const score = Math.max(0, Math.min(100, verdict.confidence >= 0.4 ? Math.round(0.7 * verdict.riskScore + 0.3 * heur.riskScore) : heur.riskScore));
    const flag = this.flagFor(before.viewer.username);
    const severity = severityFor(score, effectiveThresholds(this.settings, flag === "ignored" ? null : flag));
    let categories = verdict.categories.filter((c) => CATEGORIES.includes(c) && this.settings.categories[c]);
    if (!categories.length && severity !== "normal") categories = heur.categories;
    const warnings = this.viewers.get(before.viewer.id)?.warnings ?? 0;
    const analysis: ModerationAnalysis = {
      riskScore: score,
      severity,
      categories,
      explanation: verdict.explanation || heur.explanation,
      explanationI18n: verdict.explanation ? { en: verdict.explanation, fr: verdict.explanationFr || verdict.explanation } : heur.explanationI18n,
      recommendedAction: severity === verdict.severity ? verdict.recommendedAction : recommendFor(severity, categories, score, warnings),
      confidence: Math.round(verdict.confidence * 100) / 100,
      reasons: [...new Set([...heur.reasons, severity === "normal" && heur.severity !== "normal" ? "Context: likely harmless" : "Context reviewed by AI"])].slice(0, 5),
      stage: "ai",
    };
    const after: AnalyzedComment = { ...before, analysis };
    this.replaceComment(after);
    this.analytics.reviseComment(before, after);
    this.context.refine(before.viewer.id, before.id, score, categories, categories.some((c) => HOSTILE_CATEGORIES.has(c)));

    const vs = this.viewers.get(before.viewer.id);
    if (vs) {
      const rc = vs.recentComments.find((r) => r.id === before.id);
      if (rc) {
        rc.riskScore = score;
        rc.severity = severity;
      }
      const pt = vs.riskTrend.find((p) => p.t === before.timestamp);
      if (pt) pt.score = score;
      vs.assessment = analysis;
      vs.maxRisk = Math.max(...vs.riskTrend.map((p) => p.score), 0);
      this.dirtyViewers.add(vs.viewer.id);
    }

    this.pending.analyses.push({
      sessionId: before.sessionId,
      commentId: before.id,
      provider: this.deps.ai.name,
      model: this.deps.ai.model,
      riskScore: verdict.riskScore,
      severity: verdict.severity,
      categories: verdict.categories,
      explanation: verdict.explanation,
      recommendedAction: verdict.recommendedAction,
      confidence: verdict.confidence,
      createdAt: this.now(),
    });

    const alert = [...this.alerts.values()].find((a) => a.relatedCommentIds.includes(before.id));
    if (!alert) {
      this.considerAlert(after);
      return;
    }
    if (alert.status !== "open" && alert.status !== "watching") return;
    const downgraded = SEV_RANK[severity] < SEV_RANK.warning;
    if (downgraded && alert.occurrences === 1) {
      const record = this.makeRecord(alert.viewer, "dismiss", {
        status: "recorded",
        message: `Cleared after contextual AI review: ${analysis.explanation}`,
        i18n: {
          en: { message: `Cleared after contextual AI review: ${analysis.explanationI18n?.en ?? analysis.explanation}` },
          fr: { message: `Écartée après vérification du contexte par l'IA : ${analysis.explanationI18n?.fr ?? analysis.explanation}` },
        },
      }, alert, "novus-ai");
      this.saveAlert({ ...alert, status: "dismissed", resolution: record, stage: "ai", explanation: analysis.explanation, explanationI18n: analysis.explanationI18n, riskScore: score, severity, updatedAt: this.now() });
      return;
    }
    if (alert.commentId === before.id) {
      this.saveAlert({
        ...alert,
        riskScore: Math.max(score, ...alert.relatedCommentIds.filter((id) => id !== before.id).map((id) => this.commentIndex.get(id)?.analysis.riskScore ?? 0)),
        severity: SEV_RANK[severity] >= SEV_RANK[alert.severity] || alert.occurrences === 1 ? severity : alert.severity,
        categories: [...new Set([...categories, ...alert.categories])],
        explanation: analysis.explanation,
        explanationI18n: analysis.explanationI18n,
        recommendedAction: analysis.recommendedAction,
        confidence: analysis.confidence,
        stage: "ai",
        updatedAt: this.now(),
      });
    }
  }

  private replaceComment(c: AnalyzedComment): void {
    this.commentIndex.set(c.id, c);
    const idx = this.comments.findLastIndex((x) => x.id === c.id);
    if (idx >= 0) this.comments[idx] = c;
    this.pending.comments.push(c);
    this.deps.hub?.updateComment(c);
  }

  // ---------------------------------------------------------------- actions

  private actionAdapter(): ModerationActionAdapter {
    return this.session?.source === "demo" ? this.simulated : this.manual;
  }

  private makeRecord(
    viewer: ViewerRef,
    action: ActionType,
    result: { status: ActionRecord["status"]; message: string; instructions?: string[]; suggestedMessage?: string; i18n?: ActionRecord["i18n"] },
    alert?: ModerationAlert,
    adapterId?: string,
    note?: string,
  ): ActionRecord {
    const now = this.now();
    const record: ActionRecord = {
      id: `act_${randomUUID()}`,
      sessionId: this.session?.id ?? "none",
      alertId: alert?.id,
      viewer,
      action,
      status: result.status,
      adapter: adapterId ?? this.actionAdapter().id,
      message: result.message,
      instructions: result.instructions,
      suggestedMessage: result.suggestedMessage,
      i18n: result.i18n,
      note,
      performedAt: now,
      responseTimeMs: alert ? now - alert.createdAt : undefined,
    };
    this.actions.push(record);
    this.viewers.get(viewer.id)?.actions.unshift(record);
    this.pending.actions.push(record);
    this.deps.hub?.pushAction(record);
    return record;
  }

  async actOnAlert(alertId: string, action: ActionType, note?: string): Promise<{ record: ActionRecord; alert: ModerationAlert } | null> {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;
    const record = await this.performAction(alert.viewer, action, alert, note);
    return { record, alert: this.alerts.get(alertId)! };
  }

  async actOnViewer(viewerId: string, action: ActionType, note?: string): Promise<ActionRecord | null> {
    const vs = this.viewers.get(viewerId);
    if (!vs) return null;
    const openId = this.openAlertByViewer.get(viewerId);
    return this.performAction(vs.viewer, action, openId ? this.alerts.get(openId) : undefined, note);
  }

  private async performAction(viewer: ViewerRef, action: ActionType, alert: ModerationAlert | undefined, note?: string): Promise<ActionRecord> {
    const adapter = this.actionAdapter();
    const result = await runAction(adapter, action, {
      viewer,
      alertText: alert?.text,
      reasons: alert?.reasons,
      language: this.settings.language,
    });
    const record = this.makeRecord(viewer, action, result, alert, adapter.id, note);
    const vs = this.viewers.get(viewer.id);

    if (action === "warn" && result.status !== "failed") {
      if (vs) vs.warnings += 1;
      this.context.addWarning(viewer.id, viewer.username);
    }
    if (action === "watch") await this.setFlagByUsername(viewer.username, "watchlist", viewer.id);

    if (alert) {
      let status = alert.status;
      if (action === "dismiss") status = "dismissed";
      else if (action === "watch") status = "watching";
      else if (result.status === "executed" || result.status === "simulated") status = "resolved";
      // manual_required: the alert stays open until the moderator confirms it was done in TikTok.
      this.saveAlert({ ...alert, status, resolution: record, updatedAt: this.now() });
    }
    if (vs) this.dirtyViewers.add(vs.viewer.id);
    return record;
  }

  /** Moderator confirms a MANUAL ACTION REQUIRED step was performed inside the platform app. */
  confirmManualAction(actionId: string): ActionRecord | null {
    const record = this.actions.find((a) => a.id === actionId);
    if (!record || record.status !== "manual_required") return null;
    record.confirmedAt = this.now();
    this.pending.actions.push(record);
    this.deps.hub?.pushAction(record);
    if (record.alertId) {
      const alert = this.alerts.get(record.alertId);
      if (alert) this.saveAlert({ ...alert, status: "resolved", resolution: record, updatedAt: this.now() });
    }
    return record;
  }

  // ---------------------------------------------------------------- flags & settings

  async setViewerFlag(viewerId: string, flag: ViewerFlag | null): Promise<ViewerProfile | null> {
    const vs = this.viewers.get(viewerId);
    if (!vs) return null;
    await this.setFlagByUsername(vs.viewer.username, flag, viewerId);
    return this.viewerProfile(viewerId);
  }

  private async setFlagByUsername(username: string, flag: ViewerFlag | null, viewerId?: string): Promise<void> {
    const u = username.toLowerCase();
    this.ignored.delete(u);
    const trusted = this.settings.trustedUsers.filter((x) => x !== u);
    const watchlist = this.settings.watchlist.filter((x) => x !== u);
    if (flag === "trusted") trusted.push(u);
    if (flag === "watchlist") watchlist.push(u);
    if (flag === "ignored") this.ignored.add(u);
    this.settings = { ...this.settings, trustedUsers: trusted, watchlist };
    if (viewerId) {
      this.context.setFlag(viewerId, username, flag === "ignored" ? null : flag);
      this.dirtyViewers.add(viewerId);
    }
    await Promise.all([this.deps.repo.saveSettings(this.settings), this.deps.repo.saveViewerFlag(u, flag)]).catch((e) => this.persistError(e));
    this.deps.hub?.pushExtras({ settings: this.settings });
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = {
      ...this.settings,
      ...patch,
      categories: { ...this.settings.categories, ...(patch.categories ?? {}) },
    };
    this.applySettingsSideEffects();
    await this.deps.repo.saveSettings(this.settings).catch((e) => this.persistError(e));
    this.deps.hub?.pushExtras({ settings: this.settings });
    return this.settings;
  }

  /** Take settings saved by another room (shared across rooms) without re-saving them. */
  adoptSettings(settings: Settings): void {
    this.settings = settings;
    this.applySettingsSideEffects();
    this.deps.hub?.pushExtras({ settings: this.settings });
  }

  private applySettingsSideEffects(): void {
    this.aiQueue.enabled = this.settings.aiEnabled;
    this.insights.streamerName = this.settings.streamerName;
    for (const vs of this.viewers.values()) {
      const f = this.flagFor(vs.viewer.username);
      this.context.setFlag(vs.viewer.id, vs.viewer.username, f === "ignored" ? null : f);
    }
  }

  // ---------------------------------------------------------------- read models

  stats(): LiveStats {
    const now = this.now();
    let active = 0;
    for (const v of this.viewers.values()) if (v.messageCount > 0 && v.lastSeen >= now - 5 * 60_000) active++;
    let open = 0;
    let critical = 0;
    for (const a of this.alerts.values()) {
      if (a.status === "open") {
        open++;
        if (a.severity === "critical") critical++;
      }
    }
    return {
      messagesTotal: this.counters.messages,
      messagesPerMinute: this.recentTimes.filter((t) => t >= now - 60_000).length,
      viewerCount: this.counters.viewerCount,
      activeChatters: active,
      uniqueChatters: [...this.viewers.values()].filter((v) => v.messageCount > 0).length,
      openAlerts: open,
      criticalAlerts: critical,
      gifts: this.counters.gifts,
      follows: this.counters.follows,
      joins: this.counters.joins,
    };
  }

  sortedAlerts(): ModerationAlert[] {
    const statusRank = { open: 0, watching: 1, resolved: 2, dismissed: 3 } as const;
    return [...this.alerts.values()].sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        SEV_RANK[b.severity] - SEV_RANK[a.severity] ||
        b.riskScore - a.riskScore ||
        b.updatedAt - a.updatedAt,
    );
  }

  getAlert(id: string): ModerationAlert | undefined {
    return this.alerts.get(id);
  }

  recentComments(limit = 300): AnalyzedComment[] {
    return this.comments.slice(-limit);
  }

  snapshot(): Omit<Snapshot, "room" | "rooms"> {
    return {
      session: this.session,
      stats: this.stats(),
      comments: this.recentComments(300),
      alerts: this.sortedAlerts().slice(0, 300),
      settings: this.settings,
      ai: this.aiQueue.status(),
      demo: this.deps.mock?.status() ?? { running: false, speed: 1, demoSecond: 0 },
      tiktok: this.deps.tiktok.status(),
      serverTime: this.now(),
    };
  }

  private toProfile(vs: ViewerState): ViewerProfile {
    const now = this.now();
    return {
      viewer: vs.viewer,
      firstSeen: vs.firstSeen,
      lastSeen: vs.lastSeen,
      messageCount: vs.messageCount,
      messagesPerMinute: vs.times.filter((t) => t >= now - 60_000).length,
      warnings: vs.warnings,
      alertIds: vs.alertIds,
      riskTrend: vs.riskTrend,
      recentComments: vs.recentComments,
      categories: vs.categories,
      flag: this.flagFor(vs.viewer.username),
      assessment: vs.assessment,
      actions: vs.actions,
      gifts: vs.gifts,
      maxRisk: vs.maxRisk,
      language: vs.language,
    };
  }

  viewerProfile(id: string): ViewerProfile | null {
    const vs = this.viewers.get(id);
    return vs ? this.toProfile(vs) : null;
  }

  viewerAlerts(id: string): ModerationAlert[] {
    return (this.viewers.get(id)?.alertIds ?? []).map((a) => this.alerts.get(a)).filter((a): a is ModerationAlert => Boolean(a));
  }

  viewerList(opts: { q?: string; sort?: "risk" | "messages" | "recent"; filter?: ViewerFlag | "flagged" | "all"; limit?: number }): ViewerListItem[] {
    const q = opts.q?.toLowerCase().replace(/^@/, "");
    let list = [...this.viewers.values()].filter((v) => v.messageCount > 0 || v.gifts > 0);
    if (q) list = list.filter((v) => v.viewer.username.toLowerCase().includes(q));
    if (opts.filter && opts.filter !== "all") {
      list = list.filter((v) => {
        const f = this.flagFor(v.viewer.username);
        return opts.filter === "flagged" ? v.maxRisk >= 25 || v.alertIds.length > 0 : f === opts.filter;
      });
    }
    const sort = opts.sort ?? "risk";
    list.sort((a, b) =>
      sort === "messages" ? b.messageCount - a.messageCount : sort === "recent" ? b.lastSeen - a.lastSeen : b.maxRisk - a.maxRisk || b.messageCount - a.messageCount,
    );
    return list.slice(0, opts.limit ?? 200).map((vs) => {
      const p = this.toProfile(vs);
      return {
        viewer: p.viewer,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        messageCount: p.messageCount,
        messagesPerMinute: p.messagesPerMinute,
        warnings: p.warnings,
        alertIds: p.alertIds,
        categories: p.categories,
        flag: p.flag,
        assessment: p.assessment,
        gifts: p.gifts,
        maxRisk: p.maxRisk,
        language: p.language,
        lastRisk: vs.riskTrend.at(-1)?.score ?? 0,
      };
    });
  }

  pulse(): ChatPulse {
    const now = this.now();
    const stats = this.stats();
    const topQuestions = this.insights.topQuestions(5);
    const attention = new Set([...this.alerts.values()].filter((a) => a.status === "open").map((a) => a.viewer.id));
    return {
      generatedAt: now,
      messagesTotal: stats.messagesTotal,
      activeViewers: stats.activeChatters,
      viewerCount: stats.viewerCount,
      messagesPerMinute: stats.messagesPerMinute,
      activityChangePct: this.insights.activityChangePct(now),
      trending: this.insights.trending(now),
      topQuestions,
      topUnanswered: topQuestions.find((q) => !q.answered) ?? null,
      repeatedRequests: this.insights.topRequests(),
      sentiment: this.insights.sentiment(now),
      sentimentSeries: this.insights.sentimentSeries(),
      importantMessages: this.insights.importantMessages(),
      spikes: this.insights.spikes(),
      viewersNeedingAttention: attention.size,
    };
  }

  markQuestionAnswered(id: string, answered: boolean): boolean {
    return this.insights.markAnswered(id, answered);
  }

  async catchUp(since: number, lang: "en" | "fr" = this.settings.language) {
    const now = this.now();
    const base = buildCatchUp({
      since,
      until: now,
      buckets: this.analytics.series(),
      alerts: [...this.alerts.values()],
      actions: this.actions,
      questions: this.insights.topQuestions(5, since),
      trending: this.insights.trending(now),
      sentiment: this.insights.sentiment(now),
      important: this.insights.importantMessages(since, 5),
      newViewers: [...this.viewers.values()].filter((v) => v.firstSeen >= since && v.messageCount > 0).length,
      language: lang,
    });
    if (this.settings.aiEnabled && this.deps.ai.available() && this.deps.ai.summarize) {
      try {
        const facts = [base.headline, ...base.sections.map((s) => `${s.title}: ${s.items.join(" | ")}`)].join("\n");
        const narrative = await this.deps.ai.summarize(facts, lang);
        if (narrative) return { ...base, narrative, source: "ai" as const };
      } catch {
        // Fall back to the deterministic briefing.
      }
    }
    return base;
  }

  analyticsSummary(): AnalyticsSummary {
    const alerts = [...this.alerts.values()];
    const responseTimes = this.actions.filter((a) => a.responseTimeMs !== undefined && a.adapter !== "novus-ai").map((a) => a.responseTimeMs!);
    const buckets = this.analytics.series();
    const peak = buckets.reduce<{ t: number; messages: number } | null>((best, b) => (!best || b.messages > best.messages ? { t: b.t, messages: b.messages } : best), null);
    const stats = this.stats();
    const end = this.session?.endedAt ?? this.now();
    return {
      session: this.session,
      totals: {
        messages: stats.messagesTotal,
        uniqueChatters: stats.uniqueChatters,
        alerts: alerts.length,
        critical: alerts.filter((a) => a.severity === "critical").length,
        warnings: alerts.filter((a) => a.severity === "warning").length,
        muteRecommendations: alerts.filter((a) => a.recommendedAction === "mute").length,
        blockRecommendations: alerts.filter((a) => a.recommendedAction === "block").length,
        reportRecommendations: alerts.filter((a) => a.recommendedAction === "report").length,
        actions: this.actions.filter((a) => a.adapter !== "novus-ai").length,
        manualActions: this.actions.filter((a) => a.status === "manual_required").length,
        gifts: stats.gifts,
        follows: stats.follows,
      },
      peak,
      buckets,
      topParticipants: [...this.viewers.values()]
        .filter((v) => v.messageCount > 0)
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 8)
        .map((v) => ({ viewer: v.viewer, messages: v.messageCount, maxRisk: v.maxRisk })),
      topQuestions: this.insights.topQuestions(6),
      topTopics: this.insights.trending(this.now(), 8),
      categoryCounts: { ...this.analytics.categoryCounts },
      avgResponseTimeMs: responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
      durationMs: this.session ? end - this.session.startedAt : 0,
      audience: {
        peakViewers: this.audience.peak,
        peakAt: this.audience.peakAt,
        avgViewers: this.audience.samples ? Math.round(this.audience.sum / this.audience.samples) : null,
        joins: stats.joins,
        follows: stats.follows,
        seenViewers: this.viewers.size,
      },
      gifts: {
        total: stats.gifts,
        diamonds: this.diamonds,
        senders: this.giftsBySender.size,
        top: [...this.giftsBySender.values()].sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts).slice(0, 15),
        byName: [...this.giftsByName.values()].sort((a, b) => b.diamonds - a.diamonds || b.count - a.count).slice(0, 20),
      },
      incidents: this.sortedAlerts()
        .slice(0, 20)
        .map((a) => ({
          t: a.createdAt,
          username: a.viewer.username,
          text: a.text,
          severity: a.severity,
          riskScore: a.riskScore,
          reasons: a.reasons.slice(0, 4),
          recommendedAction: a.recommendedAction,
          status: a.status,
        })),
      moderationLog: this.actions
        .filter((a) => a.adapter !== "novus-ai")
        .slice(-60)
        .map((a) => ({ t: a.performedAt, action: a.action, username: a.viewer.username, status: a.status, confirmed: Boolean(a.confirmedAt) })),
    };
  }

  /** Chat lines still held in memory for the running LIVE (for exports). */
  chatLines(): ChatLine[] {
    return this.comments.map((c) => ({ t: c.timestamp, username: c.viewer.username, text: c.text, severity: c.analysis.severity, riskScore: c.analysis.riskScore }));
  }

  report(): StreamReport {
    const analytics = this.analyticsSummary();
    return {
      sessionId: this.session?.id ?? "none",
      generatedAt: this.now(),
      analytics,
      markdown: buildReportMarkdown(analytics, this.sortedAlerts().slice(0, 10), this.actions),
    };
  }

  // ---------------------------------------------------------------- persistence

  private persistError(err: unknown): void {
    const now = Date.now();
    if (now - this.lastPersistError > 60_000) {
      this.lastPersistError = now;
      (this.deps.log ?? console.error)(`[novus] persistence error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async flushPersist(): Promise<void> {
    const batch = this.pending;
    this.pending = emptyBatch();
    batch.sessionId = this.session?.id;
    batch.viewers = [...this.dirtyViewers].map((id) => this.viewerProfile(id)).filter((p): p is ViewerProfile => Boolean(p));
    this.dirtyViewers.clear();
    // Collapse repeated upserts of the same row within a flush.
    batch.comments = [...new Map(batch.comments.map((c) => [c.id, c])).values()];
    batch.alerts = [...new Map(batch.alerts.map((a) => [a.id, a])).values()];
    batch.actions = [...new Map(batch.actions.map((a) => [a.id, a])).values()];
    const empty = !batch.events.length && !batch.comments.length && !batch.alerts.length && !batch.actions.length && !batch.viewers.length && !batch.analyses.length;
    if (!empty) await this.deps.repo.writeBatch(batch).catch((e) => this.persistError(e));
    // Keep the saved report fresh while LIVE so history survives a server restart.
    if (this.session?.status === "live" && this.now() - this.lastReportSave >= REPORT_SAVE_MS) {
      this.lastReportSave = this.now();
      await this.deps.repo.saveReport(this.report()).catch((e) => this.persistError(e));
    }
  }
}
