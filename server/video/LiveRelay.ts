import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChildLike, SpawnLike } from "./RoomVideo";

/*
 * Live › Watch the LIVE: the account's LIVE as a short live HLS stream the phone can play.
 *
 * ffmpeg reads the same TikTok stream the recorder uses and copies it (no re-encoding: a few %
 * of a CPU) into 2-second pieces, keeping only the last few. One relay per LIVE, shared by
 * everyone watching it, started on the first request and stopped when nobody has asked for
 * a while. About 6 to 10 seconds behind the LIVE.
 */

const IDLE_MS = 45_000;
const PIECE_SECONDS = 2;
const MAX_RESTARTS = 4;

export interface LiveRelayDeps {
  /** Scratch directory for the pieces. */
  tmpRoot: string;
  ffmpeg?: string;
  spawn?: SpawnLike;
  log?: (m: string) => void;
}

interface Relay {
  dir: string;
  proc: ChildLike | null;
  lastUse: number;
  restarts: number;
  streamUrl: (fresh: boolean) => Promise<string | null>;
  idle: ReturnType<typeof setInterval>;
}

export class LiveRelay {
  private relays = new Map<string, Relay>();

  constructor(private deps: LiveRelayDeps) {}

  /** Keep (or start) the relay of a LIVE; false when TikTok gives no stream. */
  async ensure(key: string, streamUrl: (fresh: boolean) => Promise<string | null>): Promise<boolean> {
    const cur = this.relays.get(key);
    if (cur) {
      cur.lastUse = Date.now();
      return true;
    }
    const url = await streamUrl(false);
    if (!url) return false;
    const dir = join(this.deps.tmpRoot, `watch-${key.replace(/[^A-Za-z0-9._-]/g, "_")}`);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(dir, { recursive: true });
    const relay: Relay = { dir, proc: null, lastUse: Date.now(), restarts: 0, streamUrl, idle: setInterval(() => void this.reap(key), 10_000) };
    relay.idle.unref?.();
    this.relays.set(key, relay);
    this.launch(key, relay, url);
    return true;
  }

  /** The live playlist, once its first pieces exist (waits a few seconds after starting). */
  async playlist(key: string): Promise<string | null> {
    const relay = this.relays.get(key);
    if (!relay) return null;
    relay.lastUse = Date.now();
    for (let i = 0; i < 40; i++) {
      const text = await readFile(join(relay.dir, "live.m3u8"), "utf8").catch(() => null);
      if (text && text.includes("#EXTINF")) return text;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  /** Absolute file of one piece (only names ffmpeg writes), or null. */
  async piece(key: string, name: string): Promise<string | null> {
    const relay = this.relays.get(key);
    if (!relay || !/^p-\d{1,8}\.ts$/.test(name)) return null;
    relay.lastUse = Date.now();
    const file = join(relay.dir, name);
    return (await stat(file).catch(() => null)) ? file : null;
  }

  async stopAll(): Promise<void> {
    for (const key of [...this.relays.keys()]) await this.stop(key);
  }

  private launch(key: string, relay: Relay, url: string): void {
    const net = /^https?:/.test(url) ? ["-rw_timeout", "15000000", "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"] : [];
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      ...net,
      "-i", url,
      "-map", "0:v:0?",
      "-map", "0:a:0?",
      "-c", "copy",
      "-f", "hls",
      "-hls_time", String(PIECE_SECONDS),
      "-hls_list_size", "6",
      "-hls_flags", "delete_segments+omit_endlist",
      "-hls_segment_filename", "p-%d.ts",
      "live.m3u8",
    ];
    const spawn = this.deps.spawn ?? ((cmd, a, o) => nodeSpawn(cmd, a, { cwd: o.cwd, stdio: ["ignore", "ignore", "pipe"] }));
    const proc = spawn(this.deps.ffmpeg ?? "ffmpeg", args, { cwd: relay.dir });
    let err = "";
    proc.stderr?.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-300)));
    relay.proc = proc;
    proc.on("exit", (code) => {
      if (relay.proc !== proc) return;
      relay.proc = null;
      if (this.relays.get(key) !== relay) return;
      // Still watched: the stream dropped or the link expired, go again with a fresh one.
      if (Date.now() - relay.lastUse < IDLE_MS && relay.restarts < MAX_RESTARTS) {
        relay.restarts += 1;
        if (code && err.trim()) this.deps.log?.(`[watch] ${key}: ffmpeg exited ${code}: ${err.trim().split("\n").pop()} — restarting`);
        void relay.streamUrl(true).then((u) => (u && this.relays.get(key) === relay ? this.launch(key, relay, u) : this.stop(key)));
      } else void this.stop(key);
    });
  }

  private async reap(key: string): Promise<void> {
    const relay = this.relays.get(key);
    if (relay && Date.now() - relay.lastUse > IDLE_MS) await this.stop(key);
  }

  private async stop(key: string): Promise<void> {
    const relay = this.relays.get(key);
    if (!relay) return;
    this.relays.delete(key);
    clearInterval(relay.idle);
    relay.proc?.kill("SIGKILL");
    relay.proc = null;
    await rm(relay.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
