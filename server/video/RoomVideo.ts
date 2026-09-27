import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { VideoRecord } from "../../shared/types";
import { segmentPath, type VideoStore } from "./VideoStore";

/*
 * Records one followed account's LIVE in video.
 *
 * ffmpeg reads TikTok's stream and copies it as is (no re-encoding: a few % of a CPU)
 * into 60-second MPEG-TS pieces. Each finished piece is uploaded to storage, counted
 * (hours and gigabytes of the video option) and deleted locally, so the server's disk
 * holds at most a minute or two per LIVE. Recording stops as soon as the option's
 * hours or gigabytes are used up — never an overage.
 */

export interface ChildLike {
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  stderr?: { on(event: "data", listener: (chunk: Buffer) => void): unknown } | null;
}
export type SpawnLike = (cmd: string, args: string[], opts: { cwd: string }) => ChildLike;

export interface RoomVideoDeps {
  tenant: string;
  account: string;
  store: VideoStore;
  /** Scratch directory for the pieces being written. */
  tmpRoot: string;
  /** The LIVE's stream URL (`fresh`: ask TikTok again, the previous one may have expired). */
  streamUrl: (fresh: boolean) => Promise<string | null>;
  /** Hours and gigabytes left on the video option. */
  allowed: () => boolean;
  retentionDays: () => number;
  /** Count a stored piece against the option (seconds, bytes). */
  meter: (seconds: number, bytes: number) => void;
  changed?: () => void;
  spawn?: SpawnLike;
  ffmpeg?: string;
  pollMs?: number;
  now?: () => number;
  log?: (m: string) => void;
}

const SEGMENT_SECONDS = 60;
const MAX_RESTARTS = 6;
const RESTART_WINDOW_MS = 10 * 60_000;

export class RoomVideo {
  private rec: VideoRecord | null = null;
  private proc: ChildLike | null = null;
  private run = 0;
  private dir = "";
  private done = new Set<string>();
  private poller: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private restarts: number[] = [];
  private exited: Promise<void> = Promise.resolve();
  /** A LIVE whose stream kept dropping: no more attempts for it. */
  private gaveUpSession: string | null = null;
  private starting = false;

  constructor(private deps: RoomVideoDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** ffmpeg is writing this LIVE right now. */
  get recording(): boolean {
    return Boolean(this.proc);
  }

  get sessionId(): string | null {
    return this.rec?.sessionId ?? null;
  }

  /**
   * Record (or keep recording) this LIVE. Idempotent: called on every state change and
   * periodically, it also resumes after the stream dropped. Returns whether it records.
   */
  async ensure(sessionId: string): Promise<boolean> {
    if (this.proc && this.rec?.sessionId === sessionId) return true;
    if (this.starting) return false;
    this.starting = true;
    try {
      if (this.rec && this.rec.sessionId !== sessionId) await this.stop("done");
      if (this.gaveUpSession === sessionId) return false;
      if (!this.deps.allowed()) {
        if (this.rec) await this.stop("stopped_quota");
        return false;
      }
      const resuming = Boolean(this.rec);
      if (resuming) {
        const recent = this.restarts.filter((t) => this.now() - t < RESTART_WINDOW_MS);
        this.restarts = [...recent, this.now()];
        if (recent.length >= MAX_RESTARTS) {
          this.deps.log?.(`[video] @${this.deps.account}: stream keeps dropping — video stopped for this LIVE`);
          this.gaveUpSession = sessionId;
          await this.stop("failed");
          return false;
        }
      }
      const url = await this.deps.streamUrl(resuming);
      if (!url) return false;
      if (!this.rec) {
        const existing = await this.deps.store.getRecord(this.deps.tenant, sessionId).catch(() => null);
        const now = this.now();
        // Video switched off and on again during the same LIVE (or a server restart): append.
        this.rec = existing ?? { sessionId, account: this.deps.account, startedAt: now, status: "recording", segments: [], seconds: 0, bytes: 0, expiresAt: now + this.deps.retentionDays() * 86_400_000 };
        this.rec.status = "recording";
        this.rec.endedAt = undefined;
        this.run = this.rec.segments.length ? 1000 + this.rec.segments.length : 0;
        this.dir = join(this.deps.tmpRoot, `${this.deps.tenant}-${sessionId}`.replace(/[^A-Za-z0-9._-]/g, "_"));
        await mkdir(this.dir, { recursive: true });
        await this.save();
      }
      this.launch(url);
      this.deps.changed?.();
      return true;
    } finally {
      this.starting = false;
    }
  }

  private launch(url: string): void {
    this.run += 1;
    const run = this.run;
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      // Network streams: give up after 20 s without data (the controller resumes with a fresh URL).
      ...(/^https?:/.test(url) ? ["-rw_timeout", "20000000", "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"] : []),
      "-i", url,
      "-map", "0:v:0?",
      "-map", "0:a:0?",
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(SEGMENT_SECONDS),
      "-segment_format", "mpegts",
      "-segment_list", `list-r${run}.csv`,
      "-segment_list_type", "csv",
      `r${run}-%05d.ts`,
    ];
    const spawn = this.deps.spawn ?? ((cmd, a, o) => nodeSpawn(cmd, a, { cwd: o.cwd, stdio: ["ignore", "ignore", "pipe"] }));
    const proc = spawn(this.deps.ffmpeg ?? "ffmpeg", args, { cwd: this.dir });
    let errTail = "";
    proc.stderr?.on("data", (c: Buffer) => (errTail = (errTail + c.toString()).slice(-400)));
    this.proc = proc;
    this.exited = new Promise((resolve) => {
      proc.on("exit", (code) => {
        if (this.proc === proc) this.proc = null;
        if (code && errTail.trim()) this.deps.log?.(`[video] @${this.deps.account}: ffmpeg exited ${code}: ${errTail.trim().split("\n").pop()}`);
        // Upload what was written; the controller resumes if the LIVE goes on.
        void this.poll().then(() => this.deps.changed?.());
        resolve();
      });
    });
    this.poller ??= setInterval(() => void this.poll(), this.deps.pollMs ?? 5000);
    this.poller.unref?.();
    this.deps.log?.(`[video] @${this.deps.account}: recording video${run > 1 ? ` (resumed, part ${run})` : ""}`);
  }

  /** Upload every finished piece listed by ffmpeg (serialized). */
  poll(): Promise<void> {
    this.chain = this.chain.then(() => this.uploadFinished()).catch((e) => this.deps.log?.(`[video] @${this.deps.account}: ${e instanceof Error ? e.message : e}`));
    return this.chain;
  }

  private async uploadFinished(): Promise<void> {
    const rec = this.rec;
    if (!rec || !this.dir) return;
    const lists = (await readdir(this.dir).catch(() => [] as string[])).filter((f) => /^list-r\d+\.csv$/.test(f)).sort((a, b) => runOf(a) - runOf(b));
    for (const list of lists) {
      const run = runOf(list);
      const lines = (await readFile(join(this.dir, list), "utf8").catch(() => "")).split("\n").filter(Boolean);
      for (const line of lines) {
        const [file, start, end] = line.split(",");
        if (!file || this.done.has(file)) continue;
        await this.store(rec, file, Math.max(0, Number(end) - Number(start)) || SEGMENT_SECONDS, run);
      }
    }
  }

  private async store(rec: VideoRecord, file: string, seconds: number, run: number): Promise<void> {
    const local = join(this.dir, file);
    const size = await stat(local).then((s) => s.size).catch(() => 0);
    this.done.add(file);
    if (!size) return;
    const path = segmentPath(this.deps.tenant, rec.sessionId, file);
    await this.deps.store.put(path, local);
    const first = rec.segments.length === 0;
    const newRun = !first && !rec.segments.some((s) => s.path.includes(`/r${run}-`));
    rec.segments.push({ path, seconds: Math.round(seconds * 1000) / 1000, bytes: size, ...(newRun ? { discontinuity: true } : {}) });
    rec.seconds = Math.round((rec.seconds + seconds) * 1000) / 1000;
    rec.bytes += size;
    this.deps.meter(seconds, size);
    await rm(local, { force: true });
    await this.save();
    // The option's hours or gigabytes are used up: stop now.
    if (this.proc && !this.deps.allowed()) {
      this.deps.log?.(`[video] @${this.deps.account}: video option used up — recording stopped`);
      void this.stop("stopped_quota");
    }
  }

  private async save(): Promise<void> {
    if (this.rec) await this.deps.store.saveRecord(this.deps.tenant, this.rec).catch((e) => this.deps.log?.(`[video] save: ${e instanceof Error ? e.message : e}`));
  }

  /** Stop recording this LIVE (it ended, the option ran out, or the moderator turned video off). */
  async stop(status: VideoRecord["status"] = "done"): Promise<void> {
    const rec = this.rec;
    if (!rec) return;
    const proc = this.proc;
    if (proc) {
      // SIGINT lets ffmpeg close the current piece properly and list it.
      proc.kill("SIGINT");
      const killer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
      await this.exited;
      clearTimeout(killer);
    }
    await this.poll();
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    if (this.rec !== rec) return;
    rec.status = rec.segments.length ? status : "failed";
    rec.endedAt = this.now();
    await this.save();
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
    this.rec = null;
    this.done.clear();
    this.dir = "";
    this.deps.log?.(`[video] @${this.deps.account}: video saved (${Math.round(rec.seconds / 60)} min, ${(rec.bytes / 1024 ** 3).toFixed(2)} GB, ${rec.status})`);
    this.deps.changed?.();
  }
}

const runOf = (list: string) => Number(/r(\d+)/.exec(list)?.[1] ?? 0);
