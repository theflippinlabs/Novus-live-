import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VideoRecord, VideoSubtitles } from "../../shared/types";

/*
 * Where LIVE videos live. Production: a private Supabase Storage bucket (only the server's
 * service-role key writes; viewers get short-lived signed URLs). Without Supabase: files
 * under DATA_DIR, served by the app to signed-in users of the space.
 */

export const VIDEO_BUCKET = "live-videos";

/** Segment files and their catalog, per space. */
export interface VideoStore {
  readonly kind: "supabase" | "local";
  /** Upload one finished segment (the local file is left for the caller to delete). */
  put(path: string, file: string): Promise<void>;
  /** Short-lived URLs for playback; `local` URLs are app routes (same auth as the page). */
  urls(paths: string[], expiresSec: number): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
  /** Local store only: absolute file of a stored segment. */
  localFile?(path: string): string | null;

  saveRecord(tenant: string, rec: VideoRecord): Promise<void>;
  getRecord(tenant: string, sessionId: string): Promise<VideoRecord | null>;
  listRecords(tenant: string, sessionIds: string[]): Promise<VideoRecord[]>;
  /** Every video of a space (newest first). */
  listAll(tenant: string): Promise<VideoRecord[]>;
  /** Every space's videos past their retention. */
  expired(now: number): Promise<{ tenant: string; record: VideoRecord }[]>;
  deleteRecord(tenant: string, sessionId: string): Promise<void>;
  saveSubtitles(tenant: string, sessionId: string, subs: VideoSubtitles): Promise<void>;
  getSubtitles(tenant: string, sessionId: string, lang: string): Promise<VideoSubtitles | null>;
  /** Languages with subtitles for a video. */
  subtitleLangs(tenant: string, sessionId: string): Promise<string[]>;
  deleteSubtitles(tenant: string, sessionId: string): Promise<void>;
}

/** "<tenant>/<session>/<file>": only safe characters, never "..". */
export const segmentPath = (tenant: string, sessionId: string, file: string) => {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
  return `${clean(tenant)}/${clean(sessionId)}/${clean(file)}`;
};

export class SupabaseVideoStore implements VideoStore {
  readonly kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async put(path: string, file: string): Promise<void> {
    const body = await readFile(file);
    const { error } = await this.db.storage.from(VIDEO_BUCKET).upload(path, body, { contentType: "video/mp2t", upsert: true });
    if (error) throw new Error(`video upload: ${error.message}`);
  }

  async urls(paths: string[], expiresSec: number): Promise<string[]> {
    if (!paths.length) return [];
    const { data, error } = await this.db.storage.from(VIDEO_BUCKET).createSignedUrls(paths, expiresSec);
    if (error || !data) throw new Error(`video urls: ${error?.message ?? "none"}`);
    const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
    return paths.map((p) => byPath.get(p) ?? "");
  }

  async remove(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += 500) {
      const { error } = await this.db.storage.from(VIDEO_BUCKET).remove(paths.slice(i, i + 500));
      if (error) throw new Error(`video remove: ${error.message}`);
    }
  }

  async saveRecord(tenant: string, rec: VideoRecord): Promise<void> {
    const { error } = await this.db
      .from("live_videos")
      .upsert({ tenant, session_id: rec.sessionId, data: rec, expires_at: new Date(rec.expiresAt).toISOString(), updated_at: new Date().toISOString() });
    if (error) throw new Error(`video record: ${error.message}`);
  }

  async getRecord(tenant: string, sessionId: string): Promise<VideoRecord | null> {
    const { data, error } = await this.db.from("live_videos").select("data").eq("tenant", tenant).eq("session_id", sessionId).limit(1);
    if (error) throw new Error(`video record: ${error.message}`);
    return (data?.[0]?.data as VideoRecord | undefined) ?? null;
  }

  async listRecords(tenant: string, sessionIds: string[]): Promise<VideoRecord[]> {
    if (!sessionIds.length) return [];
    const { data, error } = await this.db.from("live_videos").select("data").eq("tenant", tenant).in("session_id", sessionIds.slice(0, 500));
    if (error) throw new Error(`video records: ${error.message}`);
    return (data ?? []).map((r) => r.data as VideoRecord);
  }

  async listAll(tenant: string): Promise<VideoRecord[]> {
    const { data, error } = await this.db.from("live_videos").select("data").eq("tenant", tenant).order("updated_at", { ascending: false }).limit(500);
    if (error) throw new Error(`video records: ${error.message}`);
    return (data ?? []).map((r) => r.data as VideoRecord);
  }

  async expired(now: number): Promise<{ tenant: string; record: VideoRecord }[]> {
    const { data, error } = await this.db.from("live_videos").select("tenant, data").lt("expires_at", new Date(now).toISOString()).limit(200);
    if (error) throw new Error(`video expired: ${error.message}`);
    return (data ?? []).map((r) => ({ tenant: r.tenant as string, record: r.data as VideoRecord }));
  }

  async deleteRecord(tenant: string, sessionId: string): Promise<void> {
    const { error } = await this.db.from("live_videos").delete().eq("tenant", tenant).eq("session_id", sessionId);
    if (error) throw new Error(`video delete: ${error.message}`);
    await this.deleteSubtitles(tenant, sessionId);
  }

  async saveSubtitles(tenant: string, sessionId: string, subs: VideoSubtitles): Promise<void> {
    const { error } = await this.db.from("live_video_subtitles").upsert({ tenant, session_id: sessionId, lang: subs.lang, data: subs, updated_at: new Date().toISOString() });
    if (error) throw new Error(`subtitles: ${error.message}`);
  }

  async getSubtitles(tenant: string, sessionId: string, lang: string): Promise<VideoSubtitles | null> {
    const { data, error } = await this.db.from("live_video_subtitles").select("data").eq("tenant", tenant).eq("session_id", sessionId).eq("lang", lang).limit(1);
    if (error) throw new Error(`subtitles: ${error.message}`);
    return (data?.[0]?.data as VideoSubtitles | undefined) ?? null;
  }

  async subtitleLangs(tenant: string, sessionId: string): Promise<string[]> {
    const { data, error } = await this.db.from("live_video_subtitles").select("lang").eq("tenant", tenant).eq("session_id", sessionId);
    if (error) throw new Error(`subtitles: ${error.message}`);
    return (data ?? []).map((r) => r.lang as string);
  }

  async deleteSubtitles(tenant: string, sessionId: string): Promise<void> {
    const { error } = await this.db.from("live_video_subtitles").delete().eq("tenant", tenant).eq("session_id", sessionId);
    if (error) throw new Error(`subtitles delete: ${error.message}`);
  }
}

/** Files under a directory; the catalog is kept in memory (tests, local runs). */
export class LocalVideoStore implements VideoStore {
  readonly kind = "local" as const;
  private records = new Map<string, VideoRecord>();
  constructor(private dir: string) {}

  localFile(path: string): string | null {
    const full = normalize(join(this.dir, path));
    return full.startsWith(normalize(this.dir)) ? full : null;
  }

  async put(path: string, file: string): Promise<void> {
    const dest = this.localFile(path);
    if (!dest) throw new Error("bad path");
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file, dest);
  }

  async urls(paths: string[]): Promise<string[]> {
    return paths.map((p) => `/api/video-files/${p.split("/").map(encodeURIComponent).join("/")}`);
  }

  async remove(paths: string[]): Promise<void> {
    for (const p of paths) {
      const f = this.localFile(p);
      if (f) await rm(f, { force: true });
    }
  }

  async saveRecord(tenant: string, rec: VideoRecord): Promise<void> {
    this.records.set(`${tenant}|${rec.sessionId}`, structuredClone(rec));
  }
  async getRecord(tenant: string, sessionId: string): Promise<VideoRecord | null> {
    return structuredClone(this.records.get(`${tenant}|${sessionId}`) ?? null);
  }
  async listRecords(tenant: string, sessionIds: string[]): Promise<VideoRecord[]> {
    return sessionIds.map((id) => this.records.get(`${tenant}|${id}`)).filter((r): r is VideoRecord => Boolean(r));
  }
  async listAll(tenant: string): Promise<VideoRecord[]> {
    return [...this.records.entries()].filter(([k]) => k.startsWith(`${tenant}|`)).map(([, r]) => structuredClone(r)).sort((a, b) => b.startedAt - a.startedAt);
  }
  async expired(now: number): Promise<{ tenant: string; record: VideoRecord }[]> {
    return [...this.records.entries()].filter(([, r]) => r.expiresAt < now).map(([k, record]) => ({ tenant: k.split("|")[0], record }));
  }
  async deleteRecord(tenant: string, sessionId: string): Promise<void> {
    this.records.delete(`${tenant}|${sessionId}`);
    await this.deleteSubtitles(tenant, sessionId);
  }
  private subs = new Map<string, VideoSubtitles>();
  async saveSubtitles(tenant: string, sessionId: string, subs: VideoSubtitles): Promise<void> {
    this.subs.set(`${tenant}|${sessionId}|${subs.lang}`, structuredClone(subs));
  }
  async getSubtitles(tenant: string, sessionId: string, lang: string): Promise<VideoSubtitles | null> {
    return structuredClone(this.subs.get(`${tenant}|${sessionId}|${lang}`) ?? null);
  }
  async subtitleLangs(tenant: string, sessionId: string): Promise<string[]> {
    return [...this.subs.keys()].filter((k) => k.startsWith(`${tenant}|${sessionId}|`)).map((k) => k.split("|")[2]);
  }
  async deleteSubtitles(tenant: string, sessionId: string): Promise<void> {
    for (const k of [...this.subs.keys()]) if (k.startsWith(`${tenant}|${sessionId}|`)) this.subs.delete(k);
  }
}

/** Stream a local segment file (local store only). */
export const openLocal = (file: string) => createReadStream(file);
