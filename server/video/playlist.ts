import type { VideoInfo, VideoRecord } from "../../shared/types";

/** HLS playlist of a LIVE's pieces (iPhone/Safari play it natively; other browsers via hls.js). */
export function buildPlaylist(rec: VideoRecord, urls: string[]): string {
  const target = Math.max(1, ...rec.segments.map((s) => Math.ceil(s.seconds)));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${target}`, "#EXT-X-MEDIA-SEQUENCE:0", `#EXT-X-PLAYLIST-TYPE:${rec.status === "recording" ? "EVENT" : "VOD"}`];
  rec.segments.forEach((s, i) => {
    if (s.discontinuity) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${s.seconds.toFixed(3)},`, urls[i]);
  });
  if (rec.status !== "recording") lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

/** Length of one downloadable part: about 150 MB at TikTok's 480p, what a phone saves comfortably. */
export const PART_SECONDS = 20 * 60;

/** The video's pieces grouped into parts of about PART_SECONDS (indices into rec.segments). */
export function videoParts(rec: VideoRecord): { index: number; seconds: number; bytes: number; from: number; to: number }[] {
  const parts: { index: number; seconds: number; bytes: number; from: number; to: number }[] = [];
  rec.segments.forEach((s, i) => {
    const cur = parts[parts.length - 1];
    if (!cur || cur.seconds >= PART_SECONDS) parts.push({ index: parts.length, seconds: s.seconds, bytes: s.bytes, from: i, to: i + 1 });
    else {
      cur.seconds += s.seconds;
      cur.bytes += s.bytes;
      cur.to = i + 1;
    }
  });
  // A short tail joins the previous part.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last.seconds < 3 * 60) {
    const prev = parts[parts.length - 2];
    prev.seconds += last.seconds;
    prev.bytes += last.bytes;
    prev.to = last.to;
    parts.pop();
  }
  return parts.map((p) => ({ ...p, seconds: Math.round(p.seconds) }));
}

export const videoInfo = (rec: VideoRecord): VideoInfo => ({
  sessionId: rec.sessionId,
  status: rec.status,
  seconds: Math.round(rec.seconds),
  bytes: rec.bytes,
  startedAt: rec.startedAt,
  endedAt: rec.endedAt,
  expiresAt: rec.expiresAt,
  kept: Boolean(rec.kept),
  parts: videoParts(rec).map(({ index, seconds, bytes }) => ({ index, seconds, bytes })),
});
