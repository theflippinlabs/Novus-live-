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

/** Quality map `{ data: { sd: { main: { flv, hls } }, … } }` (a JSON string in TikTok's answers). */
function fromStreamData(raw: unknown): string[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const qualities = obj(obj(parsed)?.data);
  const out: string[] = [];
  for (const q of ["sd", "ld", "hd", "origin", "uhd"]) {
    const main = obj(obj(qualities?.[q])?.main);
    for (const u of [str(main?.flv), str(main?.hls)]) if (u) out.push(u);
  }
  return out;
}

/**
 * Stream URL from any of the room-info answers the connector can get: TikTok's room/info,
 * the TikTok "api-live" and LIVE page answers (`liveRoom.streamData`), or Euler Stream's room
 * info. Same rules: TikTok CDNs only, 480p first.
 */
export function findStreamUrl(answer: unknown): string | null {
  const direct = pickStreamUrl(answer);
  if (direct) return direct;
  // Euler Stream's room video: { pullMap: { flv_sd, hls_sd, flv_ld, hls_ld } }.
  const pull = obj(obj(answer)?.pullMap) ?? obj(obj(obj(answer)?.data)?.pullMap);
  if (pull) {
    const url = ["flv_sd", "hls_sd", "flv_ld", "hls_ld"].map((k) => str(pull[k])).find((u): u is string => Boolean(u) && isTikTokStreamUrl(u!));
    if (url) return url;
  }
  const sdFirst: string[] = [];
  const others: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    const o = v as Json;
    if (o.stream_url && pickStreamUrl({ stream_url: o.stream_url })) sdFirst.push(pickStreamUrl({ stream_url: o.stream_url })!);
    if (o.stream_data !== undefined) sdFirst.push(...fromStreamData(o.stream_data));
    for (const [k, val] of Object.entries(o)) {
      if (typeof val === "string" && /^https?:\/\//.test(val) && /\.(flv|m3u8)(\?|$)/.test(val) && !/^(avatar|cover)/i.test(k)) others.push(val);
      else if (val && typeof val === "object") walk(val, depth + 1);
    }
  };
  walk(answer, 0);
  return [...sdFirst, ...others].find((u) => isTikTokStreamUrl(u)) ?? null;
}

/** For diagnostics: hosts of the video URLs in an answer (never the signed URLs themselves). */
export function streamHosts(answer: unknown): string[] {
  const hosts = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8) return;
    if (typeof v === "string") {
      if (/^https?:\/\//.test(v) && /\.(flv|m3u8)(\?|$)/.test(v)) {
        try {
          hosts.add(new URL(v).hostname);
        } catch {
          /* ignore */
        }
      } else if (v.startsWith("{") && v.includes("flv")) {
        try {
          walk(JSON.parse(v), depth + 1);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    for (const val of Object.values(v as Json)) walk(val, depth + 1);
  };
  walk(answer, 0);
  return [...hosts].slice(0, 6);
}
