import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubtitleCue, SubtitleStatus, VideoRecord, VideoSubtitles } from "../../shared/types";
import type { Translator } from "../ai/Translator";
import { buildPlaylist, videoParts } from "./playlist";
import type { VideoStore } from "./VideoStore";

/*
 * Subtitles of a LIVE video, in French or English, made on request.
 *
 * 1. The streamer's voice is turned into text with timings (ElevenLabs Scribe speech-to-text),
 *    part by part (about 20 minutes each): only the sound is sent, as a small mono AAC file.
 * 2. The text is cut into subtitle lines, and translated by the space's AI when the LIVE was
 *    in another language.
 *
 * The transcript is made once per video (kept as "src"); each other language is a translation of it.
 * Speech-to-text minutes have their own monthly allowance; translation counts in the AI allowance.
 */

export const SOURCE = "src";
const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const STT_MODEL = "scribe_v2";

/** ISO 639-3 codes from speech-to-text → the 2-letter codes the app uses. */
const ISO3: Record<string, string> = { eng: "en", fra: "fr", spa: "es", deu: "de", ita: "it", por: "pt", ara: "ar", nld: "nl", tur: "tr", pol: "pl", rus: "ru", ron: "ro", hin: "hi", jpn: "ja", kor: "ko", zho: "zh", cmn: "zh", vie: "vi", ind: "id", tha: "th" };
export const lang2 = (code: string | undefined): string => {
  const c = (code ?? "").toLowerCase();
  return c.length === 2 ? c : (ISO3[c] ?? c);
};

export interface SttWord {
  text: string;
  start?: number;
  end?: number;
  type?: string;
}

/** Words → subtitle lines: a new line on a pause, at the end of a sentence, or when a line gets long. */
export function groupCues(words: SttWord[], offset = 0): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cur: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (cur && cur.words.length) cues.push({ start: round(cur.start + offset), end: round(Math.max(cur.end, cur.start + 0.8) + offset), text: cur.words.join(" ").replace(/\s+([,.!?;:])/g, "$1").trim() });
    cur = null;
  };
  for (const w of words) {
    if ((w.type && w.type !== "word") || typeof w.start !== "number") continue;
    const text = w.text.trim();
    if (!text) continue;
    const end = typeof w.end === "number" ? w.end : w.start + 0.3;
    if (cur) {
      const c: { start: number; end: number; words: string[] } = cur;
      const length = c.words.join(" ").length + text.length + 1;
      if (w.start - c.end > 0.8 || end - c.start > 6 || length > 84) flush();
    }
    if (!cur) cur = { start: w.start, end, words: [] };
    cur.words.push(text);
    cur.end = end;
    if (/[.!?…]$/.test(text) && cur.end - cur.start > 1.2) flush();
  }
  flush();
  return cues;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** SubRip (.srt): what video players and editors read. */
export function toSrt(cues: SubtitleCue[]): string {
  const ts = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}

export interface SubtitleDeps {
  store: VideoStore;
  /** ElevenLabs API key (server-side only). Without it, subtitles are not offered. */
  apiKey?: string;
  ffmpeg?: string;
  /** Speech-to-text minutes left this month for the space, and the month's allowance. */
  minutes: (tenant: string) => { left: number; limit: number };
  meter: (tenant: string, minutes: number) => void;
  http?: typeof fetch;
  log?: (m: string) => void;
}

type Job = { lang: string; progress: number; phase: "transcribing" | "translating"; error?: string };

export class SubtitleService {
  private jobs = new Map<string, Job>();
  private errors = new Map<string, string>();

  constructor(private deps: SubtitleDeps) {}

  get configured(): boolean {
    return Boolean(this.deps.apiKey);
  }

  async status(tenant: string, sessionId: string): Promise<SubtitleStatus> {
    const langs = await this.deps.store.subtitleLangs(tenant, sessionId).catch(() => [] as string[]);
    const { left, limit } = this.deps.minutes(tenant);
    const key = `${tenant}|${sessionId}`;
    const job = this.jobs.get(key);
    return {
      configured: this.configured,
      ready: langs.filter((l) => l !== SOURCE),
      ...(job ? { job: { lang: job.lang, progress: Math.round(job.progress * 100) / 100, phase: job.phase } } : {}),
      ...(this.errors.get(key) ? { error: this.errors.get(key) } : {}),
      minutesLeft: Math.max(0, Math.floor(left)),
      minutesLimit: Math.floor(limit),
    };
  }

  /** Minutes of speech-to-text this video still needs (0 once transcribed). */
  async minutesNeeded(tenant: string, rec: VideoRecord): Promise<number> {
    const langs = await this.deps.store.subtitleLangs(tenant, rec.sessionId).catch(() => [] as string[]);
    return langs.includes(SOURCE) ? 0 : Math.ceil(rec.seconds / 60);
  }

  /**
   * Make the subtitles of `lang` (runs in the background; `status` shows the progress).
   * Throws a code when it cannot start: not configured, already running, or allowance too small.
   */
  async start(tenant: string, rec: VideoRecord, lang: "fr" | "en", translator: Translator | undefined, urls: (paths: string[]) => Promise<string[]>): Promise<void> {
    if (!this.configured) throw new Error("subtitles_not_configured");
    const key = `${tenant}|${rec.sessionId}`;
    if (this.jobs.has(key)) throw new Error("subtitles_running");
    const needed = await this.minutesNeeded(tenant, rec);
    if (needed > this.deps.minutes(tenant).left) throw new Error("subtitles_limit");
    const job: Job = { lang, progress: 0, phase: needed ? "transcribing" : "translating" };
    this.jobs.set(key, job);
    this.errors.delete(key);
    void this.run(tenant, rec, lang, translator, urls, job)
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.errors.set(key, msg.startsWith("subtitles_") ? msg : "subtitles_failed");
        this.deps.log?.(`[subtitles] @${rec.account} ${rec.sessionId}: ${msg}`);
      })
      .finally(() => this.jobs.delete(key));
  }

  private async run(tenant: string, rec: VideoRecord, lang: "fr" | "en", translator: Translator | undefined, urls: (paths: string[]) => Promise<string[]>, job: Job): Promise<void> {
    let source = await this.deps.store.getSubtitles(tenant, rec.sessionId, SOURCE);
    if (!source) {
      source = await this.transcribe(tenant, rec, urls, (p) => (job.progress = p * 0.8));
      await this.deps.store.saveSubtitles(tenant, rec.sessionId, source);
    }
    // Spoken in this language already: the transcript is the subtitles.
    if (source.source === lang) {
      await this.deps.store.saveSubtitles(tenant, rec.sessionId, { ...source, lang });
      job.progress = 1;
      return;
    }
    job.phase = "translating";
    job.progress = 0.8;
    if (!translator?.available()) throw new Error("subtitles_ai_unavailable");
    const texts = await translator.translate(
      source.cues.map((c) => c.text),
      lang,
    );
    await this.deps.store.saveSubtitles(tenant, rec.sessionId, { lang, cues: source.cues.map((c, i) => ({ ...c, text: texts[i] ?? c.text })) });
    job.progress = 1;
  }

  /** The whole video's speech, part by part, as subtitle lines on the video's timeline. */
  private async transcribe(tenant: string, rec: VideoRecord, urls: (paths: string[]) => Promise<string[]>, progress: (p: number) => void): Promise<VideoSubtitles> {
    const parts = videoParts(rec);
    const dir = await mkdtemp(join(tmpdir(), "novus-stt-"));
    const cues: SubtitleCue[] = [];
    const langs = new Map<string, number>();
    let offset = 0;
    try {
      for (const [n, part] of parts.entries()) {
        const segs = rec.segments.slice(part.from, part.to);
        const list = join(dir, `p${n}.m3u8`);
        await writeFile(list, buildPlaylist({ ...rec, segments: segs, status: "done" }, await urls(segs.map((s) => s.path))));
        const audio = join(dir, `p${n}.m4a`);
        await this.extractAudio(list, audio);
        const res = await this.stt(audio);
        cues.push(...groupCues(res.words, offset));
        const code = lang2(res.language_code);
        if (code) langs.set(code, (langs.get(code) ?? 0) + part.seconds);
        this.deps.meter(tenant, Math.ceil(part.seconds / 60));
        offset += segs.reduce((a, s) => a + s.seconds, 0);
        await rm(audio, { force: true });
        progress((n + 1) / parts.length);
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    // The language spoken the longest.
    const spoken = [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { lang: SOURCE, source: spoken, cues };
  }

  /** Sound only, mono 16 kHz AAC (about 15 MB per hour): what speech-to-text needs, small to send. */
  private extractAudio(list: string, out: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ff = spawn(this.deps.ffmpeg ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-allowed_extensions", "ALL", "-i", list, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "32k", "-y", out], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      ff.stderr?.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-300)));
      ff.on("error", reject);
      ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`audio: ${err.trim().split("\n").pop() ?? code}`))));
    });
  }

  private async stt(file: string): Promise<{ language_code?: string; words: SttWord[] }> {
    const form = new FormData();
    form.append("model_id", STT_MODEL);
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    form.append("file", new Blob([await readFile(file)], { type: "audio/mp4" }), "audio.m4a");
    const res = await (this.deps.http ?? fetch)(STT_URL, { method: "POST", headers: { "xi-api-key": this.deps.apiKey! }, body: form, signal: AbortSignal.timeout(15 * 60_000) });
    const body = (await res.json().catch(() => ({}))) as { language_code?: string; words?: SttWord[]; detail?: unknown };
    if (!res.ok) {
      const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? "").slice(0, 160);
      throw new Error(res.status === 401 ? "subtitles_key_refused" : `speech-to-text ${res.status}: ${detail}`);
    }
    return { language_code: body.language_code, words: body.words ?? [] };
  }
}
