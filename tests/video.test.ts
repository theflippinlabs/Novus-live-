import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlaylist } from "../server/video/playlist";
import { RoomVideo } from "../server/video/RoomVideo";
import { isTikTokStreamUrl, pickStreamUrl } from "../server/video/streamUrl";
import { LocalVideoStore } from "../server/video/VideoStore";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe("LIVE stream URL", () => {
  it("prefers 480p from TikTok's room info and only accepts TikTok's CDNs", () => {
    const streamData = JSON.stringify({ data: { hd: { main: { flv: "https://pull-flv-l1.tiktokcdn.com/stage/hd.flv" } }, sd: { main: { flv: "https://pull-flv-l1.tiktokcdn.com/stage/sd.flv" } } } });
    const info = { data: { stream_url: { live_core_sdk_data: { pull_data: { stream_data: streamData } }, flv_pull_url: { HD1: "https://pull-flv-l1.tiktokcdn.com/hd1.flv" } } } };
    expect(pickStreamUrl(info)).toBe("https://pull-flv-l1.tiktokcdn.com/stage/sd.flv");
    expect(pickStreamUrl({ stream_url: { flv_pull_url: { SD1: "http://pull-f5.tiktokcdn-us.com/sd1.flv" } } })).toBe("http://pull-f5.tiktokcdn-us.com/sd1.flv");
    expect(pickStreamUrl({ data: { stream_url: { hls_pull_url: "https://evil.example.com/x.m3u8" } } })).toBeNull();
    expect(pickStreamUrl({ data: { status: 4 } })).toBeNull();
    expect(isTikTokStreamUrl("file:///etc/passwd")).toBe(false);
    expect(isTikTokStreamUrl("https://tiktokcdn.com.evil.io/x")).toBe(false);
  });
});

describe("Video playlist", () => {
  it("lists the pieces, marks reconnections and closes finished LIVEs", () => {
    const rec = { sessionId: "s", account: "a", startedAt: 0, status: "done" as const, seconds: 120, bytes: 2, expiresAt: 1, segments: [{ path: "t/s/r1-00000.ts", seconds: 60, bytes: 1 }, { path: "t/s/r2-00000.ts", seconds: 59.5, bytes: 1, discontinuity: true }] };
    const m3u8 = buildPlaylist(rec, ["u1", "u2"]);
    expect(m3u8).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(m3u8).toContain("#EXTINF:60.000,\nu1");
    expect(m3u8).toContain("#EXT-X-DISCONTINUITY\n#EXTINF:59.500,\nu2");
    expect(m3u8.trim().endsWith("#EXT-X-ENDLIST")).toBe(true);
    expect(buildPlaylist({ ...rec, status: "recording" }, ["u1", "u2"])).not.toContain("ENDLIST");
  });
});

describe.skipIf(!hasFfmpeg)("Video recorder (ffmpeg)", () => {
  const root = mkdtempSync(join(tmpdir(), "novus-video-test-"));
  const source = join(root, "live.flv");
  // A 150-second "LIVE" with picture and sound (FLV, like TikTok's stream).
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "150", "-c:v", "libx264", "-preset", "ultrafast", "-g", "20", "-c:a", "aac", "-f", "flv", source]);

  it("cuts the stream into stored 60-second pieces, counts them and stops at the option's cap", async () => {
    const store = new LocalVideoStore(join(root, "store"));
    const metered: { seconds: number; bytes: number }[] = [];
    let allowed = true;
    const video = new RoomVideo({
      tenant: "t1",
      account: "streamer",
      store,
      tmpRoot: join(root, "tmp"),
      streamUrl: async () => source,
      allowed: () => allowed,
      retentionDays: () => 30,
      meter: (seconds, bytes) => metered.push({ seconds, bytes }),
      pollMs: 200,
    });
    expect(await video.ensure("s1")).toBe(true);
    expect(video.recording).toBe(true);
    // The whole file is read at once; wait for ffmpeg to finish.
    for (let i = 0; i < 100 && video.recording; i++) await new Promise((r) => setTimeout(r, 100));
    await video.poll();
    await video.stop("done");
    const rec = await store.getRecord("t1", "s1");
    expect(rec?.status).toBe("done");
    expect(rec!.segments.length).toBeGreaterThanOrEqual(2);
    expect(rec!.seconds).toBeGreaterThan(140);
    expect(rec!.seconds).toBeLessThan(160);
    for (const s of rec!.segments) expect(existsSync(store.localFile(s.path)!)).toBe(true);
    expect(metered.reduce((a, m) => a + m.bytes, 0)).toBe(rec!.bytes);
    // Stored pieces play back as one video.
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", store.localFile(rec!.segments[0].path)!]);
    expect(Number(probe.stdout.toString())).toBeGreaterThan(50);

    // The option is used up: nothing is recorded.
    allowed = false;
    expect(await video.ensure("s2")).toBe(false);
    expect(await store.getRecord("t1", "s2")).toBeNull();
  }, 60_000);
});

describe.skipIf(!hasFfmpeg)("Video API", () => {
  it("serves a LIVE's video to people of the space: info, playlist, pieces and one MP4", async () => {
    const request = (await import("supertest")).default;
    const { createApp } = await import("../server/app");
    const { RoomRegistry } = await import("../server/core/Rooms");
    const { RealtimeHub } = await import("../server/realtime/RealtimeHub");
    const { MemoryRepository } = await import("../server/persistence/MemoryRepository");
    const { createRuntime } = await import("./helpers");

    const root = mkdtempSync(join(tmpdir(), "novus-video-api-"));
    const source = join(root, "live.flv");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "70", "-c:v", "libx264", "-preset", "ultrafast", "-g", "20", "-c:a", "aac", "-f", "flv", source]);
    const repo = new MemoryRepository();
    const { runtime, tiktok } = createRuntime({ repo });
    await runtime.init();
    const main = { id: "main", kind: "main" as const, runtime, hub: new RealtimeHub(50), tiktok, dispose: async () => undefined };
    const store = new LocalVideoStore(join(root, "store"));
    const app = createApp({ config: { production: false, webDir: "x", trustProxy: false, apiRateLimitPerMinute: 1000, ingestRateLimitPerMinute: 1000 }, rooms: new RoomRegistry(main), video: { ready: true, store } });

    const session = await runtime.startSession("demo", "mock", "Test LIVE");
    await runtime.endSession();
    const video = new RoomVideo({ tenant: "owner", account: "streamer", store, tmpRoot: join(root, "tmp"), streamUrl: async () => source, allowed: () => true, retentionDays: () => 30, meter: () => undefined, pollMs: 100 });
    await video.ensure(session.id);
    for (let i = 0; i < 100 && video.recording; i++) await new Promise((r) => setTimeout(r, 100));
    await video.stop("done");

    const info = (await request(app).get(`/api/history/${session.id}/video`).expect(200)).body;
    expect(info.status).toBe("done");
    expect(info.seconds).toBeGreaterThanOrEqual(69);
    const list = (await request(app).get(`/api/history/${session.id}/video.m3u8`).expect(200)).text;
    expect(list).toContain("#EXT-X-ENDLIST");
    const piece = list.split("\n").find((l) => l.startsWith("/api/video-files/"))!;
    await request(app).get(piece).expect(200).expect("Content-Type", /video\/mp2t/);
    // No path tricks.
    await request(app).get("/api/video-files/other/x/r1-00000.ts").expect(404);

    const mp4 = await request(app).get(`/api/history/${session.id}/video.mp4`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const file = join(root, "out.mp4");
    expect((mp4.body as Buffer).length, `mp4 bytes: ${(mp4.body as Buffer).toString().slice(0, 80)}`).toBeGreaterThan(100_000);
    (await import("node:fs")).writeFileSync(file, mp4.body as Buffer);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    expect(Number(probe.stdout.toString())).toBeGreaterThan(65);

    await request(app).get(`/api/history/unknown/video`).expect(404);
  }, 60_000);
});
