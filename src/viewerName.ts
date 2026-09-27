import type { ViewerRef } from "../shared/types";

/** The TikTok display name ("pseudo") when it says more than the @handle. */
export function nicknameOf(viewer: ViewerRef): string | null {
  const nick = viewer.displayName?.trim();
  if (!nick) return null;
  return nick.replace(/^@/, "").toLowerCase() === viewer.username.toLowerCase() ? null : nick;
}
