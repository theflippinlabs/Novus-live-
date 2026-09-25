import { randomUUID } from "node:crypto";
import type { LiveEvent, ViewerRef } from "../../shared/types";

// Maps payloads from the unofficial `tiktok-live-connector` library to Novus'
// normalized events. Every field is read defensively: the library reverse-engineers
// TikTok's web client, so shapes can drift without notice.

type Raw = Record<string, unknown> | null | undefined;
type Draft = Omit<LiveEvent, "sessionId" | "platform">;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);

function avatar(user: Record<string, unknown>): string | undefined {
  const pic = obj(user.profilePicture) ?? obj(user.avatarThumb);
  const list = (pic?.url ?? pic?.urls ?? pic?.urlList) as unknown;
  const first = Array.isArray(list) ? list.find((u) => typeof u === "string" && u.startsWith("https://")) : undefined;
  return typeof first === "string" && first.length <= 500 ? first : undefined;
}

export function mapViewer(raw: Raw): ViewerRef | null {
  const user = obj(raw?.user) ?? obj(raw);
  if (!user) return null;
  const username = str(user.uniqueId) ?? str(user.displayId) ?? str(user.nickname);
  if (!username) return null;
  const id = str(user.userId) ?? str(user.id) ?? username;
  return {
    id: `tt:${id}`.slice(0, 128),
    username: username.replace(/^@/, "").slice(0, 64),
    displayName: str(user.nickname)?.slice(0, 80),
    avatarUrl: avatar(user),
  };
}

function base(raw: Raw): { id: string; timestamp: number } {
  const common = obj(raw?.common);
  const msgId = str(common?.msgId) ?? str(raw?.msgId);
  return { id: `tt:${msgId ?? randomUUID()}`, timestamp: Date.now() };
}

export function mapChat(raw: Raw): Draft | null {
  const viewer = mapViewer(raw);
  // tiktok-live-connector v2 decodes TikTok's v3 protobuf, where the text is `content` (older: `comment`).
  const text = (str(raw?.content) ?? str(raw?.comment))?.slice(0, 500);
  if (!viewer || !text) return null;
  return { ...base(raw), type: "comment", viewer, text } as Draft;
}

/** Streakable gifts (giftType 1) fire repeatedly; only the final event of a streak is counted. */
export function mapGift(raw: Raw): Draft | null {
  const viewer = mapViewer(raw);
  if (!viewer) return null;
  const details = obj(raw?.giftDetails) ?? obj(raw?.gift);
  const giftType = num(details?.giftType) ?? num(details?.type);
  if (giftType === 1 && raw?.repeatEnd !== true && raw?.repeatEnd !== 1) return null;
  const count = Math.max(1, Math.min(100_000, num(raw?.repeatCount) ?? 1));
  const giftName = (str(details?.giftName) ?? str(details?.name) ?? `Gift ${str(raw?.giftId) ?? ""}`).slice(0, 64);
  const value = num(details?.diamondCount);
  return { ...base(raw), type: "gift", viewer, giftName, count, value } as Draft;
}

export function mapViewerCount(raw: Raw): Draft | null {
  // `total` is the current audience in the v3 protobuf; `totalUser` is cumulative.
  const count = num(raw?.viewerCount) ?? num(raw?.total) ?? num(raw?.totalUser);
  if (count === undefined) return null;
  return { ...base(raw), type: "viewer_count", count: Math.max(0, Math.round(count)) } as Draft;
}

export function mapJoin(raw: Raw): Draft | null {
  const viewer = mapViewer(raw);
  return viewer ? ({ ...base(raw), type: "join", viewer } as Draft) : null;
}

export function mapFollow(raw: Raw): Draft | null {
  const viewer = mapViewer(raw);
  return viewer ? ({ ...base(raw), type: "follow", viewer } as Draft) : null;
}
