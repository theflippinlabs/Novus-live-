import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupCues, lang2, toSrt } from "../server/video/Subtitles";
import { RoomVideo } from "../server/video/RoomVideo";
import { LocalVideoStore } from "../server/video/VideoStore";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe("Subtitle lines", () => {
  it("cuts words into short lines on pauses and sentence ends, on the video's timeline", () => {
    const w = (text: string, start: number, end: number) => ({ text, start, end, type: "word" });
    const cues = groupCues([w("Hello", 0, 0.4), { text: " ", type: "spacing" }, w("everyone.", 0.5, 1.6), w("Welcome", 3, 3.4), w("to", 3.5, 3.6), w("the", 3.7, 3.8), w("LIVE", 3.9, 4.3), { text: "(laughs)", start: 4.4, end: 5, type: "audio_event" }], 60);
    expect(cues).toEqual([
      { start: 60, end: 61.6, text: "Hello everyone." },
      { start: 63, end: 64.3, text: "Welcome to the LIVE" },
    ]);
    expect(toSrt(cues)).toBe("1\n00:01:00,000 --> 00:01:01,600\nHello everyone.\n\n2\n00:01:03,000 --> 00:01:04,300\nWelcome to the LIVE\n");
    expect(lang2("eng")).toBe("en");
    expect(lang2("fra")).toBe("fr");
    expect(lang2("fr")).toBe("fr");
  });
});

describe.skipIf(!hasFfmpeg)("Subtitles API", () => {
  it("transcribes the voice once, shows the spoken language at once, and needs the AI to translate", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("../server/app");
    const { RoomRegistry } = await import("../server/core/Rooms");
    const { RealtimeHub } = await import("../server/realtime/RealtimeHub");
    const { MemoryRepository } = await import("../server/persistence/MemoryRepository");
    const { createRuntime } = await import("./helpers");

    const root = mkdtempSync(join(tmpdir(), "novus-subs-"));
    const source = join(root, "live.flv");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-g", "20", "-c:a", "aac", "-f", "flv", source]);
    const repo = new MemoryRepository();
    const { runtime, tiktok } = createRuntime({ repo });
    await runtime.init();
    const main = { id: "main", kind: "main" as const, runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const store = new LocalVideoStore(join(root, "store"));
    const sent: { model: string | null; key: string | null; audio: number }[] = [];
    // Speech-to-text stand-in: English words with timings.
    const http = (async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get("file") as Blob;
      sent.push({ model: form.get("model_id") as string, key: (init.headers as Record<string, string>)["xi-api-key"], audio: file.size });
      return new Response(JSON.stringify({ language_code: "eng", text: "Hello everyone. Welcome", words: [{ text: "Hello", start: 1, end: 1.4, type: "word" }, { text: "everyone.", start: 1.5, end: 2.6, type: "word" }, { text: "Welcome", start: 5, end: 5.6, type: "word" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000, elevenLabsApiKey: "test-key" }, rooms: new RoomRegistry(main), video: { ready: true, store }, subtitlesHttp: http });

    const session = await runtime.startSession("demo", "mock", "Test LIVE");
    await runtime.endSession();
    const video = new RoomVideo({ tenant: "owner", account: "streamer", store, tmpRoot: join(root, "tmp"), streamUrl: async () => source, allowed: () => true, retentionDays: () => 30, meter: () => undefined, pollMs: 100 });
    await video.ensure(session.id);
    for (let i = 0; i < 100 && video.recording; i++) await new Promise((r) => setTimeout(r, 100));
    await video.stop("done");

    const before = (await request(app).get(`/api/history/${session.id}/subtitles`).expect(200)).body;
    expect(before).toMatchObject({ configured: true, ready: [], minutesNeeded: 1 });
    await request(app).post(`/api/history/${session.id}/subtitles`).send({ lang: "en" }).expect(200);
    let st = before;
    for (let i = 0; i < 100; i++) {
      st = (await request(app).get(`/api/history/${session.id}/subtitles?lang=en`).expect(200)).body;
      if (!st.job) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Spoken in English: the transcript is the English subtitles.
    expect(st.ready).toEqual(["en"]);
    expect(st.cues).toEqual([
      { start: 1, end: 2.6, text: "Hello everyone." },
      { start: 5, end: 5.8, text: "Welcome" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ model: "scribe_v2", key: "test-key" });
    expect(sent[0].audio).toBeGreaterThan(1000);
    const srt = (await request(app).get(`/api/history/${session.id}/subtitles.srt?lang=en`).expect(200)).text;
    expect(srt).toContain("00:00:01,000 --> 00:00:02,600");

    // French needs a translation of the transcript (no new transcription); no AI here.
    expect((await request(app).get(`/api/history/${session.id}/subtitles`).expect(200)).body.minutesNeeded).toBe(0);
    await request(app).post(`/api/history/${session.id}/subtitles`).send({ lang: "fr" }).expect(200);
    for (let i = 0; i < 50; i++) {
      st = (await request(app).get(`/api/history/${session.id}/subtitles`).expect(200)).body;
      if (!st.job) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(st.error).toBe("subtitles_ai_unavailable");
    expect(sent).toHaveLength(1);
  }, 60_000);
});
