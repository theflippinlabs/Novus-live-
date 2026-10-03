/*
 * Where a LIVE's video can be read. The TikTok room info the connector fetches on connect
 * carries the stream's pull URLs (documented by tiktok-live-connector: `roomInfo.stream_url`).
 * We take 480p ("sd") when offered — enough to see what happened, and the lightest to store.
 */

/** Only TikTok's own CDNs: the recorder never fetches an arbitrary address. */
const TIKTOK_CDN = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|tiktokv\.com|tiktokv\.us|tiktok\.com|byteoversea\.com|ibytedtos\.com|ttlivecdn\.com)$/i;

export function isTikTokStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && TIKTOK_CDN.test(u.hostname);
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Best stream URL in a room info response (with or without its `data` wrapper), or null. */
export function pickStreamUrl(roomInfo: unknown): string | null {
  const root = obj(roomInfo);
  const info = obj(root?.data) ?? root;
  const stream = obj(info?.stream_url);
  if (!stream) return null;
  const candidates: (string | undefined)[] = [];

  // Quality map in the SDK data: { data: { sd: { main: { flv, hls } }, ld, hd, origin } }.
  const sdk = obj(obj(obj(stream.live_core_sdk_data)?.pull_data));
  const raw = str(sdk?.stream_data);
  if (raw) {
    try {
      const qualities = obj(obj(JSON.parse(raw))?.data);
      for (const q of ["sd", "ld", "hd", "origin"]) {
        const main = obj(obj(qualities?.[q])?.main);
        candidates.push(str(main?.flv), str(main?.hls));
      }
    } catch {
      /* not JSON: use the plain fields */
    }
  }
  const flv = obj(stream.flv_pull_url);
  for (const q of ["SD2", "SD1", "HD1", "FULL_HD1"]) candidates.push(str(flv?.[q]));
  candidates.push(str(stream.hls_pull_url), str(stream.rtmp_pull_url));
  return candidates.find((u): u is string => Boolean(u) && isTikTokStreamUrl(u!)) ?? null;
}

/**
 * URL to WATCH the LIVE in the app (HLS, which iPhone plays natively; hls.js elsewhere), or null.
 * The phone reads it straight from TikTok's CDN: nothing goes through the server.
 */
export function pickWatchUrl(roomInfo: unknown): string | null {
  const root = obj(roomInfo);
  const info = obj(root?.data) ?? root;
  const stream = obj(info?.stream_url);
  if (!stream) return null;
  const candidates: (string | undefined)[] = [];
  const sdk = obj(obj(obj(stream.live_core_sdk_data)?.pull_data));
  const raw = str(sdk?.stream_data);
  if (raw) {
    try {
      const qualities = obj(obj(JSON.parse(raw))?.data);
      for (const q of ["sd", "hd", "ld", "origin"]) candidates.push(str(obj(obj(qualities?.[q])?.main)?.hls));
    } catch {
      /* not JSON: use the plain fields */
    }
  }
  const map = obj(stream.hls_pull_url_map);
  for (const q of ["SD1", "SD2", "HD1", "FULL_HD1"]) candidates.push(str(map?.[q]));
  candidates.push(str(stream.hls_pull_url));
  return candidates.find((u): u is string => Boolean(u) && isTikTokStreamUrl(u!) && new URL(u!).pathname.endsWith(".m3u8")) ?? null;
}
