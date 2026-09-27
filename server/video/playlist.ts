import type { VideoRecord } from "../../shared/types";

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

export const videoInfo = (rec: VideoRecord) => ({
  sessionId: rec.sessionId,
  status: rec.status,
  seconds: Math.round(rec.seconds),
  bytes: rec.bytes,
  startedAt: rec.startedAt,
  endedAt: rec.endedAt,
  expiresAt: rec.expiresAt,
});
