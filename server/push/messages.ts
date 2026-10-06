import type { LiveSessionInfo, ModerationAlert, StreamReport, LiveSafetyEvent } from "../../shared/types";
import type { PushMessage } from "./Push";

// The text of each notification, in the space's language.

type Lang = "en" | "fr";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const room = (account: string) => encodeURIComponent(`tt:${account.toLowerCase()}`);

export function liveStartedMessage(account: string, lang: Lang): PushMessage {
  return {
    kind: "live",
    account,
    title: lang === "fr" ? `🔴 @${account} est en LIVE` : `🔴 @${account} is LIVE`,
    body: lang === "fr" ? "NOVUS surveille le chat. Touche pour ouvrir le LIVE." : "NOVUS is watching the chat. Tap to open the LIVE.",
    url: `/?view=live&room=${room(account)}`,
    tag: `live-${account}`,
  };
}

export function criticalAlertMessage(account: string, alert: ModerationAlert, grouped: number, lang: Lang): PushMessage {
  const more = grouped > 1 ? (lang === "fr" ? ` · +${grouped - 1} autre${grouped > 2 ? "s" : ""}` : ` · +${grouped - 1} more`) : "";
  return {
    kind: "alerts",
    account,
    title: lang === "fr" ? `⚠️ Alerte critique · @${account}` : `⚠️ Critical alert · @${account}`,
    body: `@${alert.viewer.username} : « ${clip(alert.text.replace(/\s+/g, " "), 90)} »${more}`,
    url: `/?view=alerts&room=${room(account)}`,
    tag: `alert-${account}`,
  };
}

/** A HIGH or CRITICAL safety event TikTok sent during the LIVE. */
export function safetyEventMessage(account: string, ev: LiveSafetyEvent, lang: Lang): PushMessage {
  return {
    kind: "alerts",
    account,
    title: lang === "fr" ? `🛡 Événement de sécurité TikTok · @${account}` : `🛡 TikTok safety event · @${account}`,
    body: clip(`${ev.title}${ev.description ? ` — ${ev.description}` : ""}`.replace(/\s+/g, " "), 140),
    url: `/?view=live&room=${room(account)}`,
    tag: `safety-${account}`,
  };
}

export function liveEndedMessage(account: string, session: LiveSessionInfo, report: StreamReport, lang: Lang): PushMessage {
  const t = report.analytics.totals;
  const mins = Math.max(1, Math.round((report.analytics.durationMs || (session.endedAt ?? Date.now()) - session.startedAt) / 60_000));
  const dur = mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")}` : `${mins} min`;
  const fmt = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB");
  const body =
    lang === "fr"
      ? `${dur} · ${fmt(t.messages)} messages · ${t.alerts} alerte${t.alerts === 1 ? "" : "s"}${t.critical ? ` (${t.critical} critique${t.critical === 1 ? "" : "s"})` : ""}. Le rapport est prêt.`
      : `${dur} · ${fmt(t.messages)} messages · ${t.alerts} alert${t.alerts === 1 ? "" : "s"}${t.critical ? ` (${t.critical} critical)` : ""}. The report is ready.`;
  return {
    kind: "summary",
    account,
    title: lang === "fr" ? `LIVE terminé · @${account}` : `LIVE ended · @${account}`,
    body,
    url: `/?view=analytics&room=${room(account)}`,
    tag: `live-${account}`,
  };
}

export function testMessage(lang: Lang): PushMessage {
  return {
    kind: "live",
    title: lang === "fr" ? "✦ NOVUS LIVE" : "✦ NOVUS LIVE",
    body: lang === "fr" ? "Les notifications fonctionnent sur cet appareil." : "Notifications work on this device.",
    url: "/?view=settings",
    tag: "test",
  };
}
