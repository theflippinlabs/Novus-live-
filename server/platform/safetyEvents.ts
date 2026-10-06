import { createHash } from "node:crypto";
import type {
  LiveSafetyEvent,
  SafetyEventType,
  SafetySeverity,
} from "../../shared/types";

/*
 * LIVE safety events: provider messages that clearly report a warning, restriction,
 * interruption or moderation action on the LIVE, turned into one NOVUS format.
 *
 * Only what the provider actually sends is mapped — nothing is inferred or simulated. No
 * TikTok message identifies who reported a LIVE, so `reporter` stays empty and
 * `reporterDisclosed` false; a future provider that does disclose it maps it explicitly.
 *
 * To support another provider, write one SafetyEventAdapter (its event names and a `map`)
 * and register it next to the TikTok one where the provider's connection is wired.
 */

export type SafetyDraft = Omit<
  LiveSafetyEvent,
  "sessionId" | "platform" | "context" | "analysis"
>;

export interface SafetyEventAdapter {
  /** Provider name, prefixed to `source`. */
  provider: string;
  /** Provider event names to listen to on the existing connection. */
  events: readonly string[];
  /** One normalized event, or null when the message is not a safety event. */
  map(event: string, raw: unknown): SafetyDraft | null;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined =>
  v && typeof v === "object" ? (v as Raw) : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : typeof v === "number" || typeof v === "bigint"
      ? String(v)
      : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
/** TikTok `Text`: its default pattern without the {0:user} placeholders. */
const text = (v: unknown): string | undefined => {
  const t = obj(v);
  const pattern = str(t?.defaultPattern) ?? str(t?.key);
  return (
    pattern
      ?.replace(/\{\d+:[^}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || undefined
  );
};
const clip = (v: string | undefined, n = 300) =>
  v ? v.slice(0, n) : undefined;
const nonZero = (v: unknown) => {
  const s = str(v);
  return s && s !== "0" ? s : undefined;
};

/** Stable id: the provider's message id, else a hash of the content (a resent message keeps its id). */
function eventId(raw: Raw, event: string, parts: unknown[]): string {
  const msgId = nonZero(obj(raw.common)?.msgId);
  if (msgId) return `tt:safety:${msgId}`;
  return `tt:safety:${event}:${createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
}

/** TikTok's punishment info (who broke a rule, what was restricted, why, until when). */
function punish(v: unknown) {
  const p = obj(v);
  if (!p) return null;
  const info = {
    type: str(p.punishType),
    typeId: num(p.punishTypeId),
    reason: str(p.showReason) ?? str(p.punishReason),
    duration: nonZero(p.duration),
    endTime: nonZero(p.endTime),
    violationUid: nonZero(p.violationUidStr) ?? nonZero(p.violationUid),
    id: nonZero(p.punishId),
  };
  return info.type || info.reason || (info.typeId && info.typeId > 0)
    ? info
    : null;
}

/** TikTok punishment kinds (PunishTypeId) → what they restrict. */
const PUNISH: Record<
  number,
  { en: string; type: SafetyEventType; severity: SafetySeverity }
> = {
  9: {
    en: "Multi-guest (link mic) restricted",
    type: "restriction",
    severity: "high",
  },
  25: {
    en: "Game partnership restricted",
    type: "restriction",
    severity: "high",
  },
  26: { en: "Game partnership removed", type: "restriction", severity: "high" },
  55: { en: "Co-host LIVE restricted", type: "restriction", severity: "high" },
  57: { en: "Matches restricted", type: "restriction", severity: "high" },
  59: { en: "Voice chat restricted", type: "restriction", severity: "high" },
  64: { en: "LIVE goal restricted", type: "restriction", severity: "high" },
  70: {
    en: "LIVE audience limited",
    type: "visibility_action",
    severity: "critical",
  },
  76: { en: "LIVE tools banned", type: "restriction", severity: "critical" },
};

const CONTROL = { paused: 1, resumed: 2, ended: 3, suspended: 4 } as const;

export const tiktokSafetyAdapter: SafetyEventAdapter = {
  provider: "tiktok",
  events: [
    "perception",
    "controlMessage",
    "partnershipPunish",
    "imDelete",
    "roomVerify",
  ],
  map(event, input) {
    const raw = obj(input);
    if (!raw) return null;
    const now = Date.now();
    const base = (
      eventType: SafetyEventType,
      severity: SafetySeverity,
      title: string,
      extra: Partial<SafetyDraft>,
      parts: unknown[],
    ): SafetyDraft => ({
      id: eventId(raw, event, parts),
      timestamp: now,
      type: "safety",
      eventType,
      severity,
      source: `tiktok:${event}`,
      title: clip(title, 140)!,
      reporterDisclosed: false,
      captured: "novus",
      ...extra,
    });

    switch (event) {
      // TikTok's violation warning / punishment notice shown to the host.
      case "perception": {
        const dialog = obj(raw.dialog);
        const p = punish(raw.punishInfo);
        const title =
          text(dialog?.title) ?? text(raw.toast) ?? text(raw.floatText);
        const warning = raw.showViolationWarning === true;
        if (!p && !warning && !title) return null;
        const kind = p?.typeId ? PUNISH[p.typeId] : undefined;
        const eventType = kind?.type ?? (p ? "restriction" : "warning");
        const description = [
          text(dialog?.subTitle),
          p?.reason,
          str(dialog?.policyTip),
        ]
          .filter(Boolean)
          .join(" — ");
        return base(
          eventType,
          kind?.severity ?? "high",
          title ??
            kind?.en ??
            (p
              ? "TikTok restriction on the LIVE"
              : "TikTok warning on the LIVE"),
          {
            description: clip(description || undefined, 500),
            ...(p?.violationUid
              ? { target: { id: `tt:${p.violationUid}` } }
              : {}),
            raw: {
              showViolationWarning: warning,
              title,
              subTitle: text(dialog?.subTitle),
              policyTip: str(dialog?.policyTip),
              punish: p,
              endTime: nonZero(raw.endTime),
            },
          },
          [title, p, warning],
        );
      }
      // LIVE paused / suspended by TikTok (a normal end is not a safety event unless it carries a punishment).
      case "controlMessage": {
        const action = num(raw.action);
        const p = punish(raw.punishInfo);
        const dialog = obj(raw.perceptionDialog);
        const title =
          text(dialog?.title) ?? text(raw.floatText) ?? str(raw.tips);
        const description = clip(
          [text(dialog?.subTitle), p?.reason, text(raw.perceptionAudienceText)]
            .filter(Boolean)
            .join(" — ") || undefined,
          500,
        );
        const rawOut = { action, tips: str(raw.tips), title, punish: p };
        if (action === CONTROL.suspended)
          return base(
            "restriction",
            "critical",
            title ?? "LIVE suspended by TikTok",
            {
              description,
              raw: rawOut,
              ...(p?.violationUid
                ? { target: { id: `tt:${p.violationUid}` } }
                : {}),
            },
            [action, title, p],
          );
        if (action === CONTROL.paused)
          return base(
            "interruption",
            p || dialog ? "high" : "warning",
            title ?? "LIVE paused",
            {
              description:
                description ??
                "TikTok reported the LIVE as paused; it did not say why.",
              raw: rawOut,
            },
            [action, title, p, Math.floor(now / 60_000)],
          );
        if (action === CONTROL.resumed)
          return base("interruption", "info", "LIVE resumed", { raw: rawOut }, [
            action,
            Math.floor(now / 60_000),
          ]);
        if (action === CONTROL.ended && (p || dialog))
          return base(
            "restriction",
            "critical",
            title ?? "LIVE ended by TikTok",
            { description, raw: rawOut },
            [action, title, p],
          );
        return null;
      }
      case "partnershipPunish": {
        const p = punish(raw.punishInfo);
        if (!p) return null;
        const kind = p.typeId ? PUNISH[p.typeId] : undefined;
        return base(
          kind?.type ?? "restriction",
          kind?.severity ?? "high",
          kind?.en ?? p.type ?? "TikTok partnership restriction",
          { description: clip(p.reason, 500), raw: { punish: p } },
          [p],
        );
      }
      // Comments removed from the LIVE in TikTok (by TikTok or a moderator; TikTok does not say who).
      case "imDelete": {
        const ids = Array.isArray(raw.deleteMsgIds)
          ? raw.deleteMsgIds.map(str).filter(Boolean)
          : [];
        const users = Array.isArray(raw.deleteUserIds)
          ? raw.deleteUserIds.map(nonZero).filter(Boolean)
          : [];
        if (!ids.length && !users.length) return null;
        return base(
          "content_action",
          "info",
          ids.length > 1
            ? `${ids.length} comments removed in TikTok`
            : "Comment removed in TikTok",
          {
            description:
              "TikTok removed comments from the LIVE; it does not say who removed them.",
            ...(users.length === 1 ? { target: { id: `tt:${users[0]}` } } : {}),
            raw: { messages: ids.slice(0, 20), users: users.slice(0, 20) },
          },
          [ids, users],
        );
      }
      // TikTok asks the host to verify the LIVE (and may close it).
      case "roomVerify": {
        const content = str(raw.content);
        const close = raw.closeRoom === true;
        if (!content && !close) return null;
        return base(
          close ? "restriction" : "warning",
          close ? "critical" : "high",
          close
            ? "LIVE closed pending TikTok verification"
            : "TikTok verification requested",
          {
            description: clip(content, 500),
            raw: {
              action: num(raw.action),
              noticeType: str(raw.noticeType),
              closeRoom: close,
            },
          },
          [content, close, num(raw.action)],
        );
      }
    }
    return null;
  },
};

const RANK: Record<SafetySeverity, number> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};
export const severityAtLeast = (s: SafetySeverity, min: SafetySeverity) =>
  RANK[s] >= RANK[min];

/** Totals shown on the LIVE and in history. */
export function safetyCounts(
  events: Pick<LiveSafetyEvent, "eventType" | "severity">[],
) {
  return {
    total: events.length,
    warnings: events.filter((e) => e.eventType === "warning").length,
    restrictions: events.filter(
      (e) =>
        e.eventType === "restriction" || e.eventType === "visibility_action",
    ).length,
    critical: events.filter((e) => e.severity === "critical").length,
  };
}
