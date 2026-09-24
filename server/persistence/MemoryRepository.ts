import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LiveSessionInfo, Settings, StreamReport, ViewerFlag } from "../../shared/types";
import type { PersistBatch, Repository } from "./Repository";

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
    this.state.sessions = [session, ...this.state.sessions.filter((s) => s.id !== session.id)].slice(0, 50);
    await this.persist();
  }

  async writeBatch(_batch: PersistBatch): Promise<void> {
    // Live rows are kept by the runtime ring buffers; nothing to do in memory mode.
  }

  async saveReport(report: StreamReport): Promise<void> {
    this.state.reports = [report, ...this.state.reports.filter((r) => r.sessionId !== report.sessionId)].slice(0, 20);
    await this.persist();
  }

  async listReports(limit: number) {
    return this.state.reports.slice(0, limit).map((r) => ({ sessionId: r.sessionId, generatedAt: r.generatedAt }));
  }

  async getReport(sessionId: string): Promise<StreamReport | null> {
    return this.state.reports.find((r) => r.sessionId === sessionId) ?? null;
  }
}
