import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatLine, LiveSessionInfo, Settings, StreamReport, ViewerFlag } from "../../shared/types";
import { OWNER_TENANT, type GiftLedgerRow, type PersistBatch, type Repository, type SessionFilter } from "./Repository";

interface FileState {
  settings: Settings | null;
  flags: Record<string, ViewerFlag>;
  reports: StreamReport[];
  sessions: LiveSessionInfo[];
  secrets?: Record<string, unknown>;
  /** Gifts per donor, LIVE and gift type (bounded). */
  gifts?: GiftLedgerRow[];
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

  constructor(
    private dataDir?: string,
    readonly tenant: string = OWNER_TENANT,
  ) {}

  /** Each space has its own state (and its own file when DATA_DIR is set). */
  scoped(tenant: string): Repository {
    return tenant === this.tenant ? this : new MemoryRepository(this.dataDir, tenant);
  }

  private get file(): string | null {
    if (!this.dataDir) return null;
    return join(this.dataDir, this.tenant === OWNER_TENANT ? "novus-state.json" : `novus-state-${this.tenant}.json`);
  }

  private loading: Promise<void> | null = null;

  init(): Promise<void> {
    // Several room runtimes share this repository; only the first init reads the file.
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    if (!this.file) return;
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<FileState>;
      this.state = { settings: parsed.settings ?? null, flags: parsed.flags ?? {}, reports: parsed.reports ?? [], sessions: parsed.sessions ?? [], secrets: parsed.secrets ?? {}, gifts: parsed.gifts ?? [] };
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

  // Secrets can be read before the rooms init the repository (e.g. push keys at boot):
  // load the file first so a save never overwrites it with an empty state.
  async loadSecret(id: string): Promise<unknown | null> {
    await this.init();
    return this.state.secrets?.[id] ?? null;
  }

  async saveSecret(id: string, value: unknown | null): Promise<void> {
    await this.init();
    const secrets = { ...this.state.secrets };
    if (value === null) delete secrets[id];
    else secrets[id] = value;
    this.state.secrets = secrets;
    await this.persist();
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

    // Donor directory: aggregate gift events per donor, LIVE and gift type.
    const gifts = batch.events.filter((e) => e.type === "gift");
    if (gifts.length) {
      const ledger = this.state.gifts ?? [];
      for (const g of gifts) {
        if (g.type !== "gift") continue;
        const session = this.state.sessions.find((x) => x.id === g.sessionId);
        if (session?.source === "demo") continue;
        let row = ledger.find((r) => r.viewerId === g.viewer.id && r.sessionId === g.sessionId && r.giftName === g.giftName);
        if (!row) {
          row = { viewerId: g.viewer.id, username: g.viewer.username, displayName: g.viewer.displayName, avatarUrl: g.viewer.avatarUrl, account: session?.account ?? null, sessionId: g.sessionId, giftName: g.giftName, gifts: 0, diamonds: 0, firstAt: g.timestamp, lastAt: g.timestamp };
          ledger.push(row);
        }
        row.gifts += g.count;
        row.diamonds += Math.max(0, (g.value ?? 0) * g.count);
        row.firstAt = Math.min(row.firstAt, g.timestamp);
        row.lastAt = Math.max(row.lastAt, g.timestamp);
      }
      this.state.gifts = ledger.slice(-20_000);
      await this.persist();
    }
  }

  async giftLedger(sinceMs?: number, account?: string): Promise<GiftLedgerRow[]> {
    return (this.state.gifts ?? []).filter((r) => (!sinceMs || r.lastAt >= sinceMs) && (!account || r.account === account)).map((r) => ({ ...r }));
  }

  async saveReport(report: StreamReport): Promise<void> {
    this.state.reports = [report, ...this.state.reports.filter((r) => r.sessionId !== report.sessionId)].slice(0, 200);
    await this.persist();
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
