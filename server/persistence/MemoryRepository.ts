import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatLine, LiveSessionInfo, Settings, StreamReport, ViewerFlag } from "../../shared/types";
import type { PersistBatch, Repository, SessionFilter } from "./Repository";

interface FileState {
  settings: Settings | null;
  flags: Record<string, ViewerFlag>;
  reports: StreamReport[];
  sessions: LiveSessionInfo[];
}

/**
 * Default store. Live data (comments/alerts) stays in the runtime's memory;
 * settings, viewer flags, sessions and post-LIVE reports are optionally
 * persisted to a JSON file when DATA_DIR is set.
 */
export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;
  private state: FileState = { settings: null, flags: {}, reports: [], sessions: [] };
  private writing: Promise<void> = Promise.resolve();
  /** Recent chat per session (memory mode only keeps the last few sessions). */
  private chat = new Map<string, ChatLine[]>();

  constructor(private dataDir?: string) {}

  private get file(): string | null {
    return this.dataDir ? join(this.dataDir, "novus-state.json") : null;
  }

  private loaded = false;

  async init(): Promise<void> {
    // Several room runtimes share this repository; only the first init reads the file.
    if (this.loaded || !this.file) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<FileState>;
      this.state = { settings: parsed.settings ?? null, flags: parsed.flags ?? {}, reports: parsed.reports ?? [], sessions: parsed.sessions ?? [] };
    } catch {
      // First run — nothing stored yet.
    }
  }

  private persist(): Promise<void> {
    const file = this.file;
    if (!file || !this.dataDir) return Promise.resolve();
    const dir = this.dataDir;
    this.writing = this.writing.then(async () => {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.state));
      await rename(tmp, file);
    });
    return this.writing;
  }

  async loadSettings(): Promise<Settings | null> {
    return this.state.settings;
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.state.settings = settings;
    await this.persist();
  }

  async loadViewerFlags(): Promise<Record<string, ViewerFlag>> {
    return { ...this.state.flags };
  }

  async saveViewerFlag(username: string, flag: ViewerFlag | null): Promise<void> {
    if (flag) this.state.flags[username] = flag;
    else delete this.state.flags[username];
    await this.persist();
  }

  async saveSession(session: LiveSessionInfo): Promise<void> {
    const rest = this.state.sessions.filter((s) => s.id !== session.id);
    const at = this.state.sessions.findIndex((s) => s.id === session.id);
    // Keep the original order when a session is updated (e.g. when it ends).
    this.state.sessions = (at >= 0 ? [...rest.slice(0, at), session, ...rest.slice(at)] : [session, ...rest]).slice(0, 200);
    await this.persist();
  }

  async writeBatch(batch: PersistBatch): Promise<void> {
    // Live rows stay in the runtime; only a bounded chat log is kept for history exports.
    for (const c of batch.comments) {
      const lines = this.chat.get(c.sessionId) ?? [];
      const line = { t: c.timestamp, username: c.viewer.username, text: c.text, severity: c.analysis.severity, riskScore: c.analysis.riskScore };
      const i = lines.findIndex((l) => l.t === line.t && l.username === line.username && l.text === line.text);
      if (i >= 0) lines[i] = line;
      else lines.push(line);
      if (lines.length > 5000) lines.splice(0, lines.length - 5000);
      this.chat.set(c.sessionId, lines);
    }
    while (this.chat.size > 20) this.chat.delete(this.chat.keys().next().value as string);
  }

  async saveReport(report: StreamReport): Promise<void> {
    this.state.reports = [report, ...this.state.reports.filter((r) => r.sessionId !== report.sessionId)].slice(0, 200);
    await this.persist();
  }

  async listReports(limit: number) {
    return this.state.reports.slice(0, limit).map((r) => ({ sessionId: r.sessionId, generatedAt: r.generatedAt }));
  }

  async getReport(sessionId: string): Promise<StreamReport | null> {
    return this.state.reports.find((r) => r.sessionId === sessionId) ?? null;
  }

  async listSessions(limit: number, filter: SessionFilter = {}): Promise<LiveSessionInfo[]> {
    const account = filter.account?.toLowerCase();
    return this.state.sessions
      .filter((s) => (account ? s.account === account : filter.withoutAccount ? !s.account : true))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  async getSession(sessionId: string): Promise<LiveSessionInfo | null> {
    return this.state.sessions.find((s) => s.id === sessionId) ?? null;
  }

  async getReports(sessionIds: string[]): Promise<StreamReport[]> {
    const ids = new Set(sessionIds);
    return this.state.reports.filter((r) => ids.has(r.sessionId));
  }

  async getChat(sessionId: string, limit: number): Promise<ChatLine[]> {
    return (this.chat.get(sessionId) ?? []).slice(-limit);
  }
}
