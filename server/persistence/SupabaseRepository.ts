import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatLine, LiveSessionInfo, Settings, StreamReport, ViewerFlag } from "../../shared/types";
import type { PersistBatch, Repository } from "./Repository";

// Supabase/Postgres store. Uses the service-role key, which is only ever read
// on the server (SUPABASE_SERVICE_ROLE_KEY) — it is never sent to the browser.
// Schema: supabase/migrations/*_init.sql

const iso = (t?: number) => (t ? new Date(t).toISOString() : null);

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private async check<T>(p: PromiseLike<{ error: { message: string } | null; data?: T | null }>, what: string): Promise<T | undefined> {
    const { error, data } = await p;
    if (error) throw new Error(`Supabase ${what}: ${error.message}`);
    return data ?? undefined;
  }

  async init(): Promise<void> {
    await this.check(this.db.from("settings").select("id").limit(1), "init");
  }

  async loadSettings(): Promise<Settings | null> {
    const data = await this.check<{ value: Settings }[]>(this.db.from("settings").select("value").eq("id", "default").limit(1), "loadSettings");
    return data?.[0]?.value ?? null;
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.check(this.db.from("settings").upsert({ id: "default", value: settings, updated_at: new Date().toISOString() }), "saveSettings");
  }

  async loadViewerFlags(): Promise<Record<string, ViewerFlag>> {
    const data = await this.check<{ username: string; flag: ViewerFlag }[]>(this.db.from("viewer_flags").select("username, flag"), "loadViewerFlags");
    return Object.fromEntries((data ?? []).map((r) => [r.username, r.flag]));
  }

  async saveViewerFlag(username: string, flag: ViewerFlag | null): Promise<void> {
    if (flag) await this.check(this.db.from("viewer_flags").upsert({ username, flag, updated_at: new Date().toISOString() }), "saveViewerFlag");
    else await this.check(this.db.from("viewer_flags").delete().eq("username", username), "deleteViewerFlag");
  }

  async saveSession(s: LiveSessionInfo): Promise<void> {
    await this.check(
      this.db.from("live_sessions").upsert({
        id: s.id,
        platform: s.platform,
        source: s.source,
        title: s.title,
        status: s.status,
        started_at: iso(s.startedAt),
        ended_at: iso(s.endedAt),
      }),
      "saveSession",
    );
  }

  async writeBatch(b: PersistBatch): Promise<void> {
    const ops: PromiseLike<unknown>[] = [];
    if (b.events.length)
      ops.push(
        this.check(
          this.db.from("live_events").upsert(
            b.events.map((e) => ({ id: e.id, session_id: e.sessionId, platform: e.platform, type: e.type, payload: e, occurred_at: iso(e.timestamp) })),
          ),
          "events",
        ),
      );
    if (b.comments.length)
      ops.push(
        this.check(
          this.db.from("live_comments").upsert(
            b.comments.map((c) => ({
              id: c.id,
              session_id: c.sessionId,
              viewer_id: c.viewer.id,
              username: c.viewer.username,
              text: c.text,
              language: c.language ?? null,
              risk_score: c.analysis.riskScore,
              severity: c.analysis.severity,
              categories: c.analysis.categories,
              reasons: c.analysis.reasons,
              stage: c.analysis.stage,
              occurred_at: iso(c.timestamp),
            })),
          ),
          "comments",
        ),
      );
    if (b.alerts.length)
      ops.push(
        this.check(
          this.db.from("moderation_alerts").upsert(
            b.alerts.map((a) => ({
              id: a.id,
              session_id: a.sessionId,
              viewer_id: a.viewer.id,
              username: a.viewer.username,
              comment_id: a.commentId,
              text: a.text,
              risk_score: a.riskScore,
              severity: a.severity,
              categories: a.categories,
              reasons: a.reasons,
              explanation: a.explanation,
              recommended_action: a.recommendedAction,
              confidence: a.confidence,
              status: a.status,
              occurrences: a.occurrences,
              created_at: iso(a.createdAt),
              updated_at: iso(a.updatedAt),
            })),
          ),
          "alerts",
        ),
      );
    if (b.viewers.length) {
      ops.push(
        this.check(
          this.db.from("viewer_profiles").upsert(
            b.viewers.map((v) => ({
              id: v.viewer.id,
              username: v.viewer.username,
              display_name: v.viewer.displayName ?? null,
              avatar_url: v.viewer.avatarUrl ?? null,
              first_seen: iso(v.firstSeen),
              last_seen: iso(v.lastSeen),
            })),
          ),
          "viewers",
        ),
      );
    }
    if (b.viewers.length && b.sessionId) ops.push(this.writeViewerSessionStats(b.sessionId, b.viewers));
    if (b.analyses.length)
      ops.push(
        this.check(
          this.db.from("ai_analyses").insert(
            b.analyses.map((a) => ({
              session_id: a.sessionId,
              comment_id: a.commentId,
              provider: a.provider,
              model: a.model ?? null,
              risk_score: a.riskScore,
              severity: a.severity,
              categories: a.categories,
              explanation: a.explanation,
              recommended_action: a.recommendedAction,
              confidence: a.confidence,
              created_at: iso(a.createdAt),
            })),
          ),
          "analyses",
        ),
      );
    await Promise.all(ops);
    // Actions reference alerts (FK), so they are written after the alerts above land.
    if (b.actions.length)
      await Promise.all([
        this.check(
          this.db.from("moderation_actions").upsert(
            b.actions.map((a) => ({
              id: a.id,
              session_id: a.sessionId,
              alert_id: a.alertId ?? null,
              viewer_id: a.viewer.id,
              username: a.viewer.username,
              action: a.action,
              status: a.status,
              adapter: a.adapter,
              message: a.message,
              instructions: a.instructions ?? null,
              note: a.note ?? null,
              response_time_ms: a.responseTimeMs ?? null,
              performed_at: iso(a.performedAt),
              confirmed_at: iso(a.confirmedAt),
            })),
          ),
          "actions",
        ),
      ]);
  }

  /** Per-session viewer stats are written separately because they are keyed by (session, viewer). */
  async writeViewerSessionStats(sessionId: string, rows: PersistBatch["viewers"]): Promise<void> {
    if (!rows.length) return;
    await this.check(
      this.db.from("viewer_session_stats").upsert(
        rows.map((v) => ({
          session_id: sessionId,
          viewer_id: v.viewer.id,
          messages: v.messageCount,
          warnings: v.warnings,
          alerts: v.alertIds.length,
          max_risk: v.maxRisk,
          categories: v.categories,
          flag: v.flag,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "session_id,viewer_id" },
      ),
      "viewer_session_stats",
    );
  }

  async saveReport(r: StreamReport): Promise<void> {
    await this.check(
      this.db.from("stream_summaries").upsert({ session_id: r.sessionId, generated_at: iso(r.generatedAt), analytics: r.analytics, markdown: r.markdown }),
      "saveReport",
    );
  }

  async listReports(limit: number) {
    const data = await this.check<{ session_id: string; generated_at: string }[]>(
      this.db.from("stream_summaries").select("session_id, generated_at").order("generated_at", { ascending: false }).limit(limit),
      "listReports",
    );
    return (data ?? []).map((r) => ({ sessionId: r.session_id, generatedAt: Date.parse(r.generated_at) }));
  }

  async getReport(sessionId: string): Promise<StreamReport | null> {
    const data = await this.check<{ session_id: string; generated_at: string; analytics: StreamReport["analytics"]; markdown: string }[]>(
      this.db.from("stream_summaries").select("*").eq("session_id", sessionId).limit(1),
      "getReport",
    );
    const r = data?.[0];
    return r ? { sessionId: r.session_id, generatedAt: Date.parse(r.generated_at), analytics: r.analytics, markdown: r.markdown } : null;
  }

  async listSessions(limit: number): Promise<LiveSessionInfo[]> {
    const data = await this.check<SessionRow[]>(this.db.from("live_sessions").select("*").order("started_at", { ascending: false }).limit(limit), "listSessions");
    return (data ?? []).map(toSession);
  }

  async getSession(sessionId: string): Promise<LiveSessionInfo | null> {
    const data = await this.check<SessionRow[]>(this.db.from("live_sessions").select("*").eq("id", sessionId).limit(1), "getSession");
    return data?.[0] ? toSession(data[0]) : null;
  }

  async getReports(sessionIds: string[]): Promise<StreamReport[]> {
    if (!sessionIds.length) return [];
    const data = await this.check<{ session_id: string; generated_at: string; analytics: StreamReport["analytics"]; markdown: string }[]>(
      this.db.from("stream_summaries").select("*").in("session_id", sessionIds),
      "getReports",
    );
    return (data ?? []).map((r) => ({ sessionId: r.session_id, generatedAt: Date.parse(r.generated_at), analytics: r.analytics, markdown: r.markdown }));
  }

  async getChat(sessionId: string, limit: number): Promise<ChatLine[]> {
    const out: ChatLine[] = [];
    // PostgREST caps a response at 1000 rows: page through the session's chat.
    for (let from = 0; out.length < limit; from += 1000) {
      const data = await this.check<{ username: string; text: string; severity: ChatLine["severity"]; risk_score: number; occurred_at: string }[]>(
        this.db
          .from("live_comments")
          .select("username, text, severity, risk_score, occurred_at")
          .eq("session_id", sessionId)
          .order("occurred_at", { ascending: true })
          .range(from, Math.min(from + 999, limit - 1)),
        "getChat",
      );
      const rows = data ?? [];
      for (const r of rows) out.push({ t: Date.parse(r.occurred_at), username: r.username, text: r.text, severity: r.severity, riskScore: r.risk_score });
      if (rows.length < 1000) break;
    }
    return out;
  }
}

interface SessionRow {
  id: string;
  platform: LiveSessionInfo["platform"];
  source: LiveSessionInfo["source"];
  title: string;
  status: LiveSessionInfo["status"];
  started_at: string;
  ended_at: string | null;
}

function toSession(r: SessionRow): LiveSessionInfo {
  return {
    id: r.id,
    platform: r.platform,
    source: r.source,
    title: r.title,
    status: r.status,
    startedAt: Date.parse(r.started_at),
    ...(r.ended_at ? { endedAt: Date.parse(r.ended_at) } : {}),
  };
}
