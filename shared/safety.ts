import type { LiveSafetyEvent, SafetyContext } from "./types";

/*
 * Plain facts about what happened before a safety event, read from its context snapshot only
 * (shown in the app and given to the AI). No cause and no reporter are ever derived here.
 */

const pct = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;

export function safetyFacts(
  ctx: SafetyContext | undefined,
  lang: "en" | "fr",
): string[] {
  if (!ctx) return [];
  const fr = lang === "fr";
  const out: string[] = [];
  const change = pct(ctx.comments, ctx.commentsBefore);
  out.push(
    fr
      ? `${ctx.comments} commentaire${ctx.comments > 1 ? "s" : ""}${change !== null && Math.abs(change) >= 20 ? ` (${change > 0 ? "+" : ""}${change} % par rapport aux ${Math.round(ctx.windowSec / 60)} min d'avant)` : ""}`
      : `${ctx.comments} comment${ctx.comments === 1 ? "" : "s"}${change !== null && Math.abs(change) >= 20 ? ` (${change > 0 ? "+" : ""}${change}% vs the ${Math.round(ctx.windowSec / 60)} min before)` : ""}`,
  );
  if (ctx.flaggedComments)
    out.push(
      fr
        ? `${ctx.flaggedComments} commentaire${ctx.flaggedComments > 1 ? "s" : ""} signalé${ctx.flaggedComments > 1 ? "s" : ""} par la modération`
        : `${ctx.flaggedComments} comment${ctx.flaggedComments > 1 ? "s" : ""} flagged by moderation`,
    );
  if (ctx.actions.length) {
    const by = new Map<string, number>();
    for (const a of ctx.actions) by.set(a.action, (by.get(a.action) ?? 0) + 1);
    out.push(
      (fr ? "Actions de modération : " : "Moderation actions: ") +
        [...by].map(([a, n]) => `${a} ×${n}`).join(", "),
    );
  }
  if (ctx.viewers && ctx.viewers.start !== ctx.viewers.end)
    out.push(
      fr
        ? `Spectateurs : de ${ctx.viewers.start} à ${ctx.viewers.end}`
        : `Viewers: from ${ctx.viewers.start} to ${ctx.viewers.end}`,
    );
  else if (ctx.viewers)
    out.push(
      fr ? `Spectateurs : ${ctx.viewers.end}` : `Viewers: ${ctx.viewers.end}`,
    );
  if (ctx.joins)
    out.push(
      fr
        ? `${ctx.joins} arrivée${ctx.joins > 1 ? "s" : ""}`
        : `${ctx.joins} join${ctx.joins > 1 ? "s" : ""}`,
    );
  if (ctx.gifts)
    out.push(
      fr
        ? `${ctx.gifts} cadeau${ctx.gifts > 1 ? "x" : ""} (${ctx.diamonds} diamants)`
        : `${ctx.gifts} gift${ctx.gifts > 1 ? "s" : ""} (${ctx.diamonds} diamonds)`,
    );
  if (ctx.follows)
    out.push(
      fr
        ? `${ctx.follows} nouvel${ctx.follows > 1 ? "s" : ""} abonné${ctx.follows > 1 ? "s" : ""}`
        : `${ctx.follows} new follower${ctx.follows > 1 ? "s" : ""}`,
    );
  return out;
}

/** What the app says about the reporter: only what the provider explicitly disclosed. */
export function reporterLabel(
  ev: Pick<LiveSafetyEvent, "reporter" | "reporterDisclosed">,
  lang: "en" | "fr",
): string {
  if (ev.reporterDisclosed && ev.reporter?.username)
    return `@${ev.reporter.username}`;
  return lang === "fr"
    ? "Non communiqué par TikTok"
    : "Not disclosed by TikTok";
}
