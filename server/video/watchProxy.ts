import { isTikTokStreamUrl } from "./streamUrl";

/*
 * Live › Watch the LIVE: TikTok's HLS stream relayed through the app.
 * Phones and browsers often cannot read TikTok's CDN directly (signed links tied to the
 * requester, cross-site rules), so the server fetches the playlist and its pieces and the
 * player only ever talks to the app. Only TikTok's CDNs are fetched (no open proxy).
 */

export const WATCH_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** base64url of a URL (kept opaque in the app's links). */
export const encodeUrl = (u: string) => Buffer.from(u, "utf8").toString("base64url");

/** The TikTok URL behind an app link, or null when it is not a TikTok CDN address. */
export function decodeUrl(token: unknown): string | null {
  if (typeof token !== "string" || !token || token.length > 4000) return null;
  try {
    const u = Buffer.from(token, "base64url").toString("utf8");
    return isTikTokStreamUrl(u) ? u : null;
  } catch {
    return null;
  }
}

/**
 * Point every address in an HLS playlist at the app: other playlists (`.m3u8`) to `playlist(u)`,
 * pieces and keys to `piece(u)`. Relative addresses are resolved against the playlist's own URL;
 * addresses outside TikTok's CDNs are dropped.
 */
export function rewritePlaylist(text: string, base: string, playlist: (u: string) => string, piece: (u: string) => string, onDrop?: (u: string) => void): string {
  const route = (raw: string): string | null => {
    let abs: string;
    try {
      abs = new URL(raw.trim(), base).toString();
    } catch {
      return null;
    }
    if (!isTikTokStreamUrl(abs)) {
      onDrop?.(abs);
      return null;
    }
    return new URL(abs).pathname.endsWith(".m3u8") ? playlist(abs) : piece(abs);
  };
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    if (line.startsWith("#")) {
      // Tags carrying an address: keys, init sections, alternative renditions.
      out.push(
        line.replace(/URI="([^"]+)"/g, (m, uri: string) => {
          const r = route(uri);
          return r ? `URI="${r}"` : m;
        }),
      );
      continue;
    }
    const r = route(line);
    if (r) out.push(r);
    else if (out.length && out[out.length - 1].startsWith("#EXTINF")) out.pop();
  }
  return out.join("\n");
}
