import { word } from "../../shared/i18n";
import type { AnalyticsSummary, ChatLine, HistoryEntry, LiveSessionInfo } from "../../shared/types";
import type { RoomRegistry } from "../core/Rooms";
import type { Repository } from "../persistence/Repository";

/*
 * LIVE history across every room. A running LIVE is read from its room's runtime
 * (always current); finished ones come from the saved session + report. A session
 * still marked "live" in storage that no room is running was cut short by a server
 * restart: it is shown as "interrupted" with the stats of its last periodic save.
 */

export interface HistoryDetail {
  entry: HistoryEntry;
  analytics: AnalyticsSummary;
}

const CHAT_EXPORT_LIMIT = 20_000;

export class HistoryService {
  constructor(
    private repo: Repository,
    private rooms: RoomRegistry,
  ) {}

  private runningRoom(sessionId: string) {
    return this.rooms.all().find((r) => r.runtime.session?.id === sessionId && r.runtime.session.status === "live");
  }

  private toEntry(session: LiveSessionInfo, analytics: AnalyticsSummary | null, running: boolean, savedAt?: number): HistoryEntry {
    const status: HistoryEntry["status"] = running ? "live" : session.status === "live" ? "interrupted" : "ended";
    const end = session.endedAt ?? (running ? Date.now() : savedAt) ?? session.startedAt;
    return {
      sessionId: session.id,
      title: session.title,
      source: session.source,
      status,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? (status === "interrupted" ? savedAt : undefined),
      durationMs: analytics?.durationMs || Math.max(0, end - session.startedAt),
      messages: analytics?.totals.messages ?? 0,
      uniqueChatters: analytics?.totals.uniqueChatters ?? 0,
      gifts: analytics?.gifts?.total ?? analytics?.totals.gifts ?? 0,
      diamonds: analytics?.gifts?.diamonds ?? 0,
      peakViewers: analytics?.audience?.peakViewers ?? 0,
      alerts: analytics?.totals.alerts ?? 0,
    };
  }

  /** LIVEs of one room: a followed account's own LIVEs, or demos/connector LIVEs for the main room. */
  async list(limit = 60, room?: { kind: "main" | "tiktok"; username?: string }): Promise<HistoryEntry[]> {
    const filter = room?.kind === "tiktok" && room.username ? { account: room.username } : room?.kind === "main" ? { withoutAccount: true } : {};
    const sessions = await this.repo.listSessions(limit, filter);
    const reports = new Map((await this.repo.getReports(sessions.map((s) => s.id))).map((r) => [r.sessionId, r]));
    return sessions
      .map((s) => {
        const room = this.runningRoom(s.id);
        if (room) return this.toEntry(room.runtime.session ?? s, room.runtime.analyticsSummary(), true);
        const report = reports.get(s.id);
        return this.toEntry(s, report?.analytics ?? null, false, report?.generatedAt);
      })
      // Hide empty artifacts (a session opened and closed within seconds with nothing in it).
      .filter((e) => e.status === "live" || e.messages > 0 || e.gifts > 0 || e.peakViewers > 0 || e.durationMs >= 60_000);
  }

  async detail(sessionId: string): Promise<HistoryDetail | null> {
    const room = this.runningRoom(sessionId);
    if (room?.runtime.session) {
      const analytics = room.runtime.analyticsSummary();
      return { entry: this.toEntry(room.runtime.session, analytics, true), analytics };
    }
    const session = await this.repo.getSession(sessionId);
    if (!session) return null;
    const report = await this.repo.getReport(sessionId);
    if (!report) return null;
    return { entry: this.toEntry(session, report.analytics, false, report.generatedAt), analytics: report.analytics };
  }

  async chat(sessionId: string): Promise<ChatLine[]> {
    const saved = await this.repo.getChat(sessionId, CHAT_EXPORT_LIMIT);
    const room = this.runningRoom(sessionId);
    if (!room) return saved;
    // Add lines of the running LIVE that are not flushed to storage yet.
    const last = saved.length ? saved[saved.length - 1].t : 0;
    return saved.concat(room.runtime.chatLines().filter((l) => l.t > last));
  }
}

/** Chat as CSV (Excel-friendly: BOM, quoted fields). */
export function chatCsv(lines: ChatLine[], timeZone: string, lang: "en" | "fr" = "en"): string {
  const fmt = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { timeZone, dateStyle: "short", timeStyle: "medium" });
  // Neutralize spreadsheet formulas (CSV injection): a cell must not start with = + - @.
  const q = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  const header = lang === "fr" ? ["heure", "pseudo", "message", "gravité", "risque"] : ["time", "username", "message", "severity", "risk"];
  // French spreadsheets expect ";" as the separator.
  const sep = lang === "fr" ? ";" : ",";
  const rows = [header.join(sep)];
  for (const l of lines) rows.push([q(fmt.format(l.t)), q(l.username), q(l.text), word(l.severity, lang), String(l.riskScore)].join(sep));
  return "\uFEFF" + rows.join("\r\n") + "\r\n";
}
