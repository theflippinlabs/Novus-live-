import PDFDocument from "pdfkit";
import { CATEGORY_LABELS } from "../../shared/settings";
import { tr, word } from "../../shared/i18n";
import type { AnalyticsSummary, Category, ChatLine, HistoryEntry, StatsInsights } from "../../shared/types";
import { deriveInsights } from "../analytics/insights";

/*
 * Post-LIVE report as a PDF, laid out like an agency report:
 *   1. Summary — LIVE score, key takeaways, headline figures
 *   2. Performance — comparison with previous LIVEs, key ratios, key moments, recent trend
 *   3. Activity — messages & viewers per minute, alerts per minute, chat mood
 *   4. Audience & gifts, 5. Community (chatters, questions, topics), 6. Moderation
 *   Appendix — the chat transcript.
 *
 * Uses PDFKit's built-in Helvetica (WinAnsi), so characters it cannot encode (emoji,
 * most non-Latin scripts) are dropped from names and messages rather than printed as junk.
 */

type Lang = "en" | "fr";

// Print palette: warm ink on white, champagne gold accent (no blue).
const GOLD = "#b8894a";
const GOLD_LIGHT = "#e0b877";
const GOLD_SOFT = "#efe3cf";
const INK = "#15130f";
const MUTED = "#6b645a";
const FAINT = "#9c9488";
const LINE = "#e2dacd";
const CARD = "#faf7f2";
const DARK = "#0b0a0c";
const RED = "#c81e32";
const ORANGE = "#d9711c";
const GREEN = "#2e7d4f";

const T = {
  en: {
    title: "LIVE report",
    status: { live: "LIVE in progress", ended: "Ended", interrupted: "Interrupted (server restart) — stats up to the last save" },
    start: "Start",
    end: "End",
    duration: "Duration",
    summary: "Summary",
    score: "LIVE score",
    grade: (s: number) => (s >= 80 ? "Excellent LIVE" : s >= 60 ? "Good LIVE" : s >= 40 ? "Decent LIVE" : "Room to improve"),
    parts: { engagement: "Engagement", audience: "Audience", safety: "Safety", monetization: "Gifts" },
    scoreHint: "Indicative score: audience participation, followers won, chat safety and support (gifts).",
    essentials: "Key takeaways",
    figures: "Headline figures",
    messages: "Messages",
    chatters: "Chatters",
    peakViewers: "Peak viewers",
    avgViewers: "Average viewers",
    gifts: "Gifts",
    diamonds: "Diamonds",
    donors: "Donors",
    follows: "New followers",
    joins: "Joins announced",
    alerts: "Alerts",
    alertsSub: (c: number) => `${c} critical`,
    actions: "Moderation actions",
    response: "Avg. reaction time",
    performance: "Performance",
    vs: (n: number) => `Compared with your ${n} previous LIVE${n > 1 ? "s" : ""}`,
    metric: "Metric",
    thisLive: "This LIVE",
    average: "Average",
    change: "Change",
    same: "stable",
    metrics: { duration: "Duration (min)", messagesPerMin: "Messages / min", peakViewers: "Peak viewers", uniqueChatters: "Chatters", gifts: "Gifts", diamonds: "Diamonds", alertsPer1k: "Alerts / 1,000 msgs" },
    noHistory: "No previous LIVE of this account to compare with yet.",
    ratios: "Key ratios",
    r: {
      messagesPerMin: "messages per minute",
      messagesPerChatter: "messages per chatter",
      participation: "of viewers chatted",
      followsPer100: "followers per 100 viewers",
      giftsPerHour: "gifts per hour",
      diamondsPerHour: "diamonds per hour",
      donorRate: "of viewers sent a gift",
      alertsPer1k: "alerts per 1,000 msgs",
      handledPct: "of alerts handled",
      avgResponseSec: "seconds to react",
    },
    moments: "Key moments",
    m: {
      chat_peak: (v: string) => `Chat peak — ${v} messages in one minute`,
      audience_peak: (v: string) => `Audience peak — ${v} viewers`,
      tense: (v: string) => `Most tense moment — ${v} alert(s)`,
      quiet: (v: string) => `Quietest moment — ${v} messages`,
    },
    trend: "Your last LIVEs — peak viewers",
    activity: "Activity",
    perMinute: "Messages and viewers per minute",
    legendMsgs: "messages / min",
    legendViewers: "viewers",
    alertsPerMinute: "Alerts per minute",
    mood: "Chat mood",
    moodHint: "Above the line: positive chat. Below: tense or hostile chat.",
    audienceGifts: "Audience & gifts",
    seen: (n: string) => `Viewers seen individually: ${n} (TikTok only reports viewers who chat, gift, follow, or part of the joins).`,
    topDonors: "Top donors",
    share: "Share",
    giftTypes: "Gifts by type",
    rank: "#",
    user: "Viewer",
    count: "Count",
    gift: "Gift",
    community: "Community",
    topChatters: "Most active chatters",
    maxRisk: "Max risk",
    questions: "Most asked questions",
    answered: "answered",
    unanswered: "not answered",
    topics: "Trending topics",
    moderation: "Moderation",
    modSummary: (a: string, c: number, w: number, act: string, man: number) => `${a} alerts — ${c} critical, ${w} warnings. ${act} moderation actions (${man} done manually in TikTok).`,
    categories: "Detected categories",
    incidents: "Most serious incidents",
    log: "Moderation log",
    time: "Time",
    action: "Action",
    result: "Result",
    transcript: "Appendix — chat transcript",
    conversationTitle: "LIVE chat transcript",
    conversation: "Conversation",
    transcriptSummary: (messages: string, chatters: string) => `${messages} messages from ${chatters} chatters, in order. Flagged messages are in orange (warning) or red (critical). Emoji the PDF font cannot print are left out — the .txt file keeps them.`,
    transcriptNote: (shown: number, total: number) => (shown < total ? `${shown} of ${total} messages (most recent).` : `${total} messages.`),
    none: "—",
    generated: "Generated by NOVUS LIVE",
    page: "Page",
    confirmed: "confirmed",
    k: {
      score: (s: number, g: string) => `LIVE score: ${s}/100 — ${g}.`,
      better: (label: string, pct: number, v: string, avg: string) => `${label}: +${pct}% vs your average (${v} vs ${avg}).`,
      worse: (label: string, pct: number, v: string, avg: string) => `${label}: ${pct}% vs your average (${v} vs ${avg}).`,
      participation: (pct: string, chatters: string) => `${pct}% of the viewers wrote in the chat (${chatters} chatters).`,
      gifts: (d: string, pct: number, u: string) => `${d} diamonds received — ${pct}% from @${u}, your top supporter.`,
      giftsNone: "No gifts during this LIVE.",
      safety: (a: string, c: number, handled: string, sec: string) => `${a} alerts including ${c} critical — ${handled} handled, ${sec} to react on average.`,
      safe: "A calm LIVE: no alert.",
      peak: (time: string, v: string) => `Chat peak at ${time}: ${v} messages in one minute.`,
      open: (n: number, q: string) => `${n} question(s) left unanswered, e.g. “${q}”.`,
    },
  },
  fr: {
    title: "Rapport de LIVE",
    status: { live: "LIVE en cours", ended: "Terminé", interrupted: "Interrompu (redémarrage serveur) — stats jusqu'à la dernière sauvegarde" },
    start: "Début",
    end: "Fin",
    duration: "Durée",
    summary: "Synthèse",
    score: "Score du LIVE",
    grade: (s: number) => (s >= 80 ? "Excellent LIVE" : s >= 60 ? "Bon LIVE" : s >= 40 ? "LIVE correct" : "À améliorer"),
    parts: { engagement: "Engagement", audience: "Audience", safety: "Sécurité", monetization: "Cadeaux" },
    scoreHint: "Score indicatif : participation du public, abonnés gagnés, sécurité du chat et soutiens (cadeaux).",
    essentials: "L'essentiel",
    figures: "Chiffres clés",
    messages: "Messages",
    chatters: "Participants au chat",
    peakViewers: "Pic de spectateurs",
    avgViewers: "Spectateurs en moyenne",
    gifts: "Cadeaux",
    diamonds: "Diamants",
    donors: "Donateurs",
    follows: "Nouveaux abonnés",
    joins: "Arrivées annoncées",
    alerts: "Alertes",
    alertsSub: (c: number) => `dont ${c} critique${c > 1 ? "s" : ""}`,
    actions: "Actions de modération",
    response: "Temps de réaction moyen",
    performance: "Performance",
    vs: (n: number) => `Comparé à tes ${n} LIVE précédent${n > 1 ? "s" : ""}`,
    metric: "Indicateur",
    thisLive: "Ce LIVE",
    average: "Moyenne",
    change: "Écart",
    same: "stable",
    metrics: { duration: "Durée (min)", messagesPerMin: "Messages / min", peakViewers: "Pic de spectateurs", uniqueChatters: "Participants au chat", gifts: "Cadeaux", diamonds: "Diamants", alertsPer1k: "Alertes / 1 000 msg" },
    noHistory: "Pas encore d'autre LIVE de ce compte pour comparer.",
    ratios: "Ratios clés",
    r: {
      messagesPerMin: "messages par minute",
      messagesPerChatter: "messages par participant",
      participation: "des spectateurs ont écrit",
      followsPer100: "abonnés pour 100 spectateurs",
      giftsPerHour: "cadeaux par heure",
      diamondsPerHour: "diamants par heure",
      donorRate: "des spectateurs ont offert",
      alertsPer1k: "alertes pour 1 000 msg",
      handledPct: "des alertes traitées",
      avgResponseSec: "secondes pour réagir",
    },
    moments: "Moments forts",
    m: {
      chat_peak: (v: string) => `Pic du chat — ${v} messages en une minute`,
      audience_peak: (v: string) => `Pic d'audience — ${v} spectateurs`,
      tense: (v: string) => `Moment le plus tendu — ${v} alerte(s)`,
      quiet: (v: string) => `Creux — ${v} messages`,
    },
    trend: "Tes derniers LIVE — pic de spectateurs",
    activity: "Activité",
    perMinute: "Messages et spectateurs par minute",
    legendMsgs: "messages / min",
    legendViewers: "spectateurs",
    alertsPerMinute: "Alertes par minute",
    mood: "Ambiance du chat",
    moodHint: "Au-dessus de la ligne : chat positif. En dessous : chat tendu ou hostile.",
    audienceGifts: "Audience et cadeaux",
    seen: (n: string) => `Spectateurs vus individuellement : ${n} (TikTok ne signale que ceux qui écrivent, offrent, suivent, ou une partie des arrivées).`,
    topDonors: "Meilleurs donateurs",
    share: "Part",
    giftTypes: "Cadeaux par type",
    rank: "#",
    user: "Spectateur",
    count: "Nombre",
    gift: "Cadeau",
    community: "Communauté",
    topChatters: "Participants les plus actifs",
    maxRisk: "Risque max",
    questions: "Questions les plus posées",
    answered: "répondue",
    unanswered: "sans réponse",
    topics: "Sujets du moment",
    moderation: "Modération",
    modSummary: (a: string, c: number, w: number, act: string, man: number) => `${a} alertes — ${c} critique(s), ${w} avertissement(s). ${act} action(s) de modération (${man} faite(s) à la main dans TikTok).`,
    categories: "Catégories détectées",
    incidents: "Incidents les plus graves",
    log: "Journal de modération",
    time: "Heure",
    action: "Action",
    result: "Résultat",
    transcript: "Annexe — transcription du chat",
    conversationTitle: "Transcription du chat du LIVE",
    conversation: "Conversation",
    transcriptSummary: (messages: string, chatters: string) => `${messages} messages de ${chatters} participants, dans l'ordre. Les messages signalés sont en orange (avertissement) ou en rouge (critique). Les emojis que la police du PDF ne peut pas imprimer sont omis — le fichier .txt les garde.`,
    transcriptNote: (shown: number, total: number) => (shown < total ? `${shown} messages sur ${total} (les plus récents).` : `${total} messages.`),
    none: "—",
    generated: "Généré par NOVUS LIVE",
    page: "Page",
    confirmed: "confirmée",
    k: {
      score: (s: number, g: string) => `Score du LIVE : ${s}/100 — ${g}.`,
      better: (label: string, pct: number, v: string, avg: string) => `${label} : +${pct} % par rapport à ta moyenne (${v} contre ${avg}).`,
      worse: (label: string, pct: number, v: string, avg: string) => `${label} : ${pct} % par rapport à ta moyenne (${v} contre ${avg}).`,
      participation: (pct: string, chatters: string) => `${pct} % des spectateurs ont écrit dans le chat (${chatters} participants).`,
      gifts: (d: string, pct: number, u: string) => `${d} diamants reçus — ${pct} % offerts par @${u}, ton plus grand soutien.`,
      giftsNone: "Aucun cadeau pendant ce LIVE.",
      safety: (a: string, c: number, handled: string, sec: string) => `${a} alertes dont ${c} critique(s) — ${handled} traitées, ${sec} pour réagir en moyenne.`,
      safe: "Un LIVE calme : aucune alerte.",
      peak: (time: string, v: string) => `Pic du chat à ${time} : ${v} messages en une minute.`,
      open: (n: number, q: string) => `${n} question(s) restée(s) sans réponse, par exemple « ${q} ».`,
    },
  },
};

// Helvetica in PDFKit encodes WinAnsi: keep Latin-1 plus the few extra WinAnsi glyphs.
const PRINTABLE = /[^\x20-\x7e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/g;
// French number/date formatting uses narrow no-break spaces, which WinAnsi lacks.
const spaces = (s: string) => s.replace(/[\u202f\u2009\u2007\u00a0]/g, " ");
export const pdfText = (s: string) => spaces(s).replace(/[\r\n\t]+/g, " ").replace(PRINTABLE, "").replace(/\s{2,}/g, " ").trim();

const MAX_TRANSCRIPT = 15_000;

export interface PdfInput {
  entry: HistoryEntry;
  analytics: AnalyticsSummary;
  chat: ChatLine[];
  lang: Lang;
  timeZone: string;
  logo?: Buffer;
  /** Score, ratios, comparison with previous LIVEs (derived from `analytics` when absent). */
  insights?: StatsInsights;
  /** "report" (default): full LIVE report. "transcript": the whole chat conversation only. */
  kind?: "report" | "transcript";
}

export function buildReportPdf(input: PdfInput): Promise<Buffer> {
  const { entry, analytics: a, chat, lang, timeZone, logo, kind = "report" } = input;
  const I = input.insights ?? deriveInsights(a, []);
  const t = T[lang];
  const locale = lang === "fr" ? "fr-FR" : "en-GB";
  const dateFmt = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "full", timeStyle: "short" });
  const dayFmt = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" });
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
  const clockFmt = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDate = (v: number) => spaces(dateFmt.format(v));
  const fmtDay = (v: number) => spaces(dayFmt.format(v));
  const fmtTime = (v: number) => spaces(timeFmt.format(v));
  const fmtClock = (v: number) => spaces(clockFmt.format(v));
  const n = (v: number, digits = 0) => spaces(v.toLocaleString(locale, { maximumFractionDigits: digits }));
  const dur = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min ${String(s % 60).padStart(2, "0")} s`;
  };
  const liveTitle = pdfText(tr(entry.title, lang));

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 62, bottom: 56, left: 44, right: 44 },
    bufferPages: true,
    info: { Title: `NOVUS LIVE — ${liveTitle}`, Author: "NOVUS LIVE", Subject: kind === "report" ? t.title : t.conversationTitle },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const reset = (y = doc.y) => {
    doc.x = left;
    doc.y = y;
  };

  // ---------------------------------------------------------------- building blocks
  /** Big section title (starts a new page when asked). */
  const section = (text: string, newPage = false) => {
    if (newPage) doc.addPage();
    else ensure(90);
    if (!newPage) doc.moveDown(1);
    const y = doc.y;
    doc.rect(left, y + 2, 4, 18).fill(GOLD);
    doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text(text, left + 14, y, { lineBreak: false });
    reset(y + 32);
  };
  /** Small title inside a section. */
  const sub = (text: string, need = 60) => {
    ensure(need);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(text.toUpperCase(), left, doc.y, { characterSpacing: 1.1 });
    doc.moveDown(0.45);
    reset();
  };
  const para = (text: string, opts: { color?: string; size?: number; x?: number; w?: number } = {}) => {
    doc.font("Helvetica").fontSize(opts.size ?? 9.5).fillColor(opts.color ?? MUTED).text(text, opts.x ?? left, doc.y, { width: opts.w ?? width, lineGap: 1.5 });
  };
  const card = (x: number, y: number, w: number, h: number, fill = CARD) => {
    doc.roundedRect(x, y, w, h, 7).fillAndStroke(fill, LINE);
  };
  const tile = (x: number, y: number, w: number, h: number, value: string, label: string, note?: string) => {
    card(x, y, w, h);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(value, x + 11, y + 9, { width: w - 22, lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(7.6).fillColor(MUTED).text(label.toUpperCase(), x + 11, y + 31, { width: w - 22, lineBreak: false, ellipsis: true, characterSpacing: 0.4 });
    if (note) doc.font("Helvetica").fontSize(7.6).fillColor(GOLD).text(note, x + 11, y + 42, { width: w - 22, lineBreak: false, ellipsis: true });
  };
  const grid = <X>(items: X[], cols: number, h: number, draw: (item: X, x: number, y: number, w: number) => void) => {
    const gap = 8;
    const w = (width - (cols - 1) * gap) / cols;
    const rows = Math.ceil(items.length / cols);
    ensure(rows * (h + gap));
    const top = doc.y;
    items.forEach((it, i) => draw(it, left + (i % cols) * (w + gap), top + Math.floor(i / cols) * (h + gap), w));
    reset(top + rows * (h + gap));
  };
  /** Table with a header row, optional inline bar column, and automatic page breaks. */
  type Cell = string | { bar: number; text: string } | { text: string; color: string };
  const table = (cols: { label: string; w: number; align?: "left" | "right" }[], rows: Cell[][]) => {
    const rowH = 19;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, rowH).fill(CARD);
      let x = left;
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor(MUTED);
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x + 6, y + 6, { width: c.w * width - 12, align: c.align ?? "left", lineBreak: false, characterSpacing: 0.4 });
        x += c.w * width;
      }
      reset(y + rowH);
    };
    ensure(rowH * 3);
    drawHeader();
    for (const r of rows) {
      if (doc.y + rowH > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = left;
      r.forEach((cell, i) => {
        const c = cols[i];
        const cw = c.w * width;
        if (typeof cell === "object" && "color" in cell) {
          doc.font("Helvetica-Bold").fontSize(8.8).fillColor(cell.color).text(cell.text, x + 6, y + 5, { width: cw - 12, align: c.align ?? "left", lineBreak: false });
        } else if (typeof cell === "object") {
          const bw = Math.max(0, (cw - 60) * Math.min(1, cell.bar));
          doc.roundedRect(x + 6, y + 7, cw - 60, 5, 2.5).fill(GOLD_SOFT);
          if (bw > 0) doc.roundedRect(x + 6, y + 7, Math.max(4, bw), 5, 2.5).fill(GOLD);
          doc.font("Helvetica").fontSize(8.6).fillColor(INK).text(cell.text, x + cw - 50, y + 5, { width: 44, align: "right", lineBreak: false });
        } else {
          doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8.8).fillColor(INK).text(cell, x + 6, y + 5, { width: cw - 12, align: c.align ?? "left", lineBreak: false, ellipsis: true });
        }
        x += cw;
      });
      doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke();
      reset(y + rowH);
    }
    doc.moveDown(0.5);
    reset();
  };

  /** Time axis under a per-minute chart: a tick every 15 min (or 5 for short LIVEs). */
  const timeAxis = (x: number, y: number, w: number, t0: number, t1: number) => {
    const span = Math.max(60_000, t1 - t0);
    const stepMin = span > 3 * 3600_000 ? 60 : span > 90 * 60_000 ? 30 : span > 30 * 60_000 ? 15 : 5;
    const step = stepMin * 60_000;
    doc.font("Helvetica").fontSize(7).fillColor(FAINT);
    for (let tk = Math.ceil(t0 / step) * step; tk <= t1; tk += step) {
      const px = x + ((tk - t0) / span) * w;
      doc.moveTo(px, y).lineTo(px, y + 3).lineWidth(0.5).strokeColor(FAINT).stroke();
      doc.text(fmtTime(tk), px - 20, y + 5, { width: 40, align: "center", lineBreak: false });
    }
  };
  /** Horizontal gridlines with values on the left. */
  const yGrid = (x: number, y: number, w: number, h: number, max: number, fmt = (v: number) => n(v)) => {
    doc.font("Helvetica").fontSize(6.8).fillColor(FAINT);
    for (const f of [0, 0.5, 1]) {
      const gy = y + h - f * h;
      doc.moveTo(x, gy).lineTo(x + w, gy).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.text(fmt(max * f), x - 34, gy - 3.5, { width: 30, align: "right", lineBreak: false });
    }
  };

  // ---------------------------------------------------------------- cover / summary
  const bandH = 150;
  doc.rect(0, 0, doc.page.width, bandH).fill(DARK);
  doc.rect(0, bandH - 3, doc.page.width, 3).fill(GOLD);
  let textX = left;
  if (logo) {
    try {
      doc.image(logo, left, 30, { width: 86, height: 86 });
      textX = left + 104;
    } catch {
      /* unreadable logo: header text only */
    }
  }
  doc.font("Helvetica-Bold").fontSize(26).fillColor(GOLD_LIGHT).text("NOVUS", textX, 34, { characterSpacing: 6, lineBreak: false });
  doc.font("Helvetica").fontSize(12).fillColor("#e8dcc6").text("LIVE", textX + 150, 45, { characterSpacing: 7, lineBreak: false });
  doc.font("Helvetica").fontSize(10.5).fillColor("#b2aaa0").text((kind === "report" ? t.title : t.conversationTitle).toUpperCase(), textX, 72, { characterSpacing: 1.5, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(17).fillColor("#f1ece4").text(liveTitle, textX, 88, { width: width - (textX - left), lineBreak: false, ellipsis: true });
  doc.font("Helvetica").fontSize(9).fillColor("#b2aaa0").text(fmtDate(entry.startedAt), textX, 112, { width: width - (textX - left), lineBreak: false });

  reset(bandH + 18);
  const statusColor = entry.status === "live" ? RED : entry.status === "interrupted" ? ORANGE : GOLD;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(statusColor).text(t.status[entry.status].toUpperCase(), left, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.25);
  const colon = lang === "fr" ? " : " : ": ";
  para(`${t.start}${colon}${fmtDate(entry.startedAt)}    ·    ${t.end}${colon}${entry.endedAt ? fmtDate(entry.endedAt) : t.none}    ·    ${t.duration}${colon}${dur(a.durationMs || entry.durationMs)}`, { color: INK, size: 9 });

  if (kind === "report") {
    // ---- score + key takeaways, side by side
    doc.moveDown(1);
    const top = doc.y;
    const scoreW = 176;
    const boxH = 208;
    card(left, top, scoreW, boxH, DARK);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#b2aaa0").text(t.score.toUpperCase(), left + 16, top + 16, { characterSpacing: 1.2, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(52).fillColor(GOLD_LIGHT).text(String(I.score.total), left + 16, top + 32, { lineBreak: false });
    const numW = doc.widthOfString(String(I.score.total));
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#8a8276").text("/100", left + 18 + numW, top + 64, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#f1ece4").text(t.grade(I.score.total), left + 16, top + 92, { width: scoreW - 32, lineBreak: false });
    (["engagement", "audience", "safety", "monetization"] as const).forEach((k, i) => {
      const my = top + 116 + i * 22;
      doc.font("Helvetica").fontSize(8).fillColor("#b2aaa0").text(t.parts[k], left + 16, my, { lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#f1ece4").text(String(I.score[k]), left + 16, my, { width: scoreW - 32, align: "right", lineBreak: false });
      doc.roundedRect(left + 16, my + 11, scoreW - 32, 4, 2).fill("#2a2620");
      if (I.score[k] > 0) doc.roundedRect(left + 16, my + 11, Math.max(4, ((scoreW - 32) * I.score[k]) / 100), 4, 2).fill(GOLD);
    });

    const kx = left + scoreW + 14;
    const kw = width - scoreW - 14;
    card(kx, top, kw, boxH);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(t.essentials.toUpperCase(), kx + 16, top + 16, { characterSpacing: 1.2, lineBreak: false });
    let ky = top + 34;
    for (const point of keyPoints(a, I, t, n, fmtTime, lang)) {
      doc.font("Helvetica").fontSize(9);
      const h = doc.heightOfString(point, { width: kw - 44, lineGap: 1.5 });
      if (ky + h > top + boxH - 10) break;
      doc.circle(kx + 20, ky + 5, 2.3).fill(GOLD);
      doc.fillColor(INK).text(point, kx + 30, ky, { width: kw - 44, lineGap: 1.5 });
      ky += h + 7;
    }
    reset(top + boxH + 6);
    para(t.scoreHint, { size: 7.8, color: FAINT });

    // ---- headline figures
    sub(t.figures, 150);
    const fig: [string, string, string?][] = [
      [n(a.totals.messages), t.messages],
      [n(a.totals.uniqueChatters), t.chatters],
      [a.audience ? n(a.audience.peakViewers) : t.none, t.peakViewers, a.audience?.peakAt ? fmtTime(a.audience.peakAt) : undefined],
      [a.audience?.avgViewers != null ? n(a.audience.avgViewers) : t.none, t.avgViewers],
      [n(a.gifts?.total ?? a.totals.gifts), t.gifts],
      [a.gifts ? n(a.gifts.diamonds) : t.none, t.diamonds],
      [a.gifts ? n(a.gifts.senders) : t.none, t.donors],
      [n(a.audience?.follows ?? a.totals.follows), t.follows],
      [n(a.totals.alerts), t.alerts, a.totals.critical ? t.alertsSub(a.totals.critical) : undefined],
      [n(a.totals.actions), t.actions],
      [a.avgResponseTimeMs !== null ? `${n(a.avgResponseTimeMs / 1000, 1)} s` : t.none, t.response],
      [a.audience ? n(a.audience.joins) : t.none, t.joins],
    ];
    grid(fig, 4, 54, ([v, l, note], x, y, w) => tile(x, y, w, 54, v, l, note));

    // ---------------------------------------------------------------- performance
    section(t.performance, true);
    if (I.comparison) {
      sub(t.vs(I.comparison.lives), 180);
      table(
        [
          { label: t.metric, w: 0.4 },
          { label: t.thisLive, w: 0.2, align: "right" },
          { label: t.average, w: 0.2, align: "right" },
          { label: t.change, w: 0.2, align: "right" },
        ],
        I.comparison.metrics.map((m) => {
          const flat = Math.abs(m.deltaPct) < 5;
          const good = m.higherIsBetter ? m.deltaPct > 0 : m.deltaPct < 0;
          return [t.metrics[m.key], n(m.value, 1), n(m.average, 1), { text: flat ? `= ${t.same}` : `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct} %`, color: flat ? MUTED : good ? GREEN : ORANGE }];
        }),
      );
    } else {
      sub(t.performance, 40);
      para(t.noHistory);
    }

    sub(t.ratios, 150);
    const ratioKeys = (Object.keys(t.r) as (keyof typeof t.r)[]).filter((k) => I.ratios[k] !== null);
    grid(ratioKeys, 4, 48, (k, x, y, w) => {
      const v = I.ratios[k] as number;
      const val = k === "participation" || k === "donorRate" || k === "handledPct" ? `${n(v, 1)} %` : k === "diamondsPerHour" ? n(v) : n(v, 1);
      card(x, y, w, 48);
      doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(val, x + 10, y + 9, { width: w - 20, lineBreak: false });
      doc.font("Helvetica").fontSize(7.6).fillColor(MUTED).text(t.r[k], x + 10, y + 29, { width: w - 20, lineBreak: false, ellipsis: true });
    });

    if (I.moments.length) {
      sub(t.moments, 30 + I.moments.length * 20);
      for (const m of I.moments) {
        ensure(20);
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(fmtTime(m.t), left, y + 1, { width: 40, lineBreak: false });
        doc.circle(left + 52, y + 5.5, 3.5).fill(m.kind === "tense" ? RED : m.kind === "quiet" ? FAINT : GOLD);
        doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(t.m[m.kind](n(m.value)), left + 64, y, { width: width - 64, lineBreak: false });
        reset(y + 19);
      }
    }

    if (I.trend.length >= 2) {
      sub(t.trend, 150);
      const cx = left + 36;
      const cw = width - 36;
      const ch = 96;
      const y0 = doc.y + 4;
      const max = Math.max(1, ...I.trend.map((x) => x.peakViewers));
      yGrid(cx, y0, cw, ch, max);
      const slot = cw / I.trend.length;
      const bw = Math.min(34, slot * 0.6);
      I.trend.forEach((x, i) => {
        const h = (x.peakViewers / max) * ch;
        const bx = cx + i * slot + (slot - bw) / 2;
        if (h > 0) doc.roundedRect(bx, y0 + ch - h, bw, h, 3).fill(x.current ? GOLD : "#cfc1a8");
        doc.font(x.current ? "Helvetica-Bold" : "Helvetica").fontSize(7).fillColor(x.current ? INK : FAINT).text(fmtDay(x.startedAt), cx + i * slot, y0 + ch + 4, { width: slot, align: "center", lineBreak: false });
      });
      reset(y0 + ch + 20);
    }

    // ---------------------------------------------------------------- activity
    const buckets = a.buckets ?? [];
    if (buckets.length > 1) {
      section(t.activity, true);
      const t0 = buckets[0].t;
      const t1 = buckets[buckets.length - 1].t + 60_000;
      const cx = left + 36;
      const cw = width - 36;

      // Messages (bars) + viewers (line). One scale per measure is avoided: the viewers
      // line has its own labelled maximum, like a separate reading, and the legend says so.
      sub(t.perMinute, 190);
      const ch = 130;
      const y0 = doc.y + 6;
      const maxMsgs = Math.max(1, ...buckets.map((b) => b.messages));
      const maxViewers = Math.max(1, ...buckets.map((b) => b.viewers ?? 0));
      yGrid(cx, y0, cw, ch, maxMsgs);
      const step = cw / buckets.length;
      const peakIdx = buckets.reduce((best, b, i) => (b.messages > buckets[best].messages ? i : best), 0);
      buckets.forEach((b, i) => {
        const h = (b.messages / maxMsgs) * ch;
        if (h > 0) doc.rect(cx + i * step + step * 0.14, y0 + ch - h, Math.max(0.6, step * 0.72), h).fill(i === peakIdx ? GOLD : "#d9c7a6");
      });
      const pts = buckets.map((b, i) => [cx + i * step + step / 2, y0 + ch - ((b.viewers ?? 0) / maxViewers) * ch, b.viewers ?? 0] as const).filter((p) => p[2] > 0);
      if (pts.length > 1) {
        doc.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) doc.lineTo(x, y);
        doc.lineWidth(1.5).strokeColor(INK).stroke();
      }
      // Peak annotation.
      const pb = buckets[peakIdx];
      const px = cx + peakIdx * step + step / 2;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GOLD).text(`${n(pb.messages)} · ${fmtTime(pb.t)}`, Math.min(px - 30, cx + cw - 60), y0 - 11, { width: 60, align: "center", lineBreak: false });
      timeAxis(cx, y0 + ch, cw, t0, t1);
      reset(y0 + ch + 20);
      const ly = doc.y;
      doc.rect(left, ly + 1, 9, 9).fill("#d9c7a6");
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`${t.legendMsgs} (max ${n(maxMsgs)})`, left + 13, ly + 1, { lineBreak: false });
      if (pts.length > 1) {
        doc.moveTo(left + 190, ly + 5.5).lineTo(left + 206, ly + 5.5).lineWidth(1.5).strokeColor(INK).stroke();
        doc.text(`${t.legendViewers} (max ${n(maxViewers)})`, left + 211, ly + 1, { lineBreak: false });
      }
      reset(ly + 18);

      // Alerts per minute.
      const maxAlerts = Math.max(...buckets.map((b) => b.alerts));
      if (maxAlerts > 0) {
        sub(t.alertsPerMinute, 110);
        const ah = 56;
        const ay = doc.y + 4;
        yGrid(cx, ay, cw, ah, maxAlerts);
        buckets.forEach((b, i) => {
          const h = (b.alerts / maxAlerts) * ah;
          if (h > 0) doc.rect(cx + i * step + step * 0.14, ay + ah - h, Math.max(0.8, step * 0.72), h).fill(b.alerts >= Math.max(2, maxAlerts * 0.6) ? RED : ORANGE);
        });
        timeAxis(cx, ay + ah, cw, t0, t1);
        reset(ay + ah + 22);
      }

      // Mood (sentiment -1..1) around a zero line.
      if (buckets.some((b) => b.sentiment !== 0)) {
        sub(t.mood, 120);
        const mh = 70;
        const my = doc.y + 4;
        const mid = my + mh / 2;
        doc.moveTo(cx, mid).lineTo(cx + cw, mid).lineWidth(0.6).strokeColor(FAINT).dash(2, { space: 2 }).stroke().undash();
        doc.font("Helvetica").fontSize(6.8).fillColor(FAINT).text("+", cx - 12, my - 2, { lineBreak: false }).text("-", cx - 12, my + mh - 8, { lineBreak: false });
        const mp = buckets.map((b, i) => [cx + i * step + step / 2, mid - Math.max(-1, Math.min(1, b.sentiment)) * (mh / 2)] as const);
        doc.moveTo(mp[0][0], mp[0][1]);
        for (const [x, y] of mp.slice(1)) doc.lineTo(x, y);
        doc.lineWidth(1.4).strokeColor(GOLD).stroke();
        timeAxis(cx, my + mh, cw, t0, t1);
        reset(my + mh + 20);
        para(t.moodHint, { size: 7.8, color: FAINT });
      }
    }

    // ---------------------------------------------------------------- audience & gifts
    section(t.audienceGifts, true);
    if (a.audience) {
      grid(
        [
          [n(a.audience.peakViewers), t.peakViewers, a.audience.peakAt ? fmtTime(a.audience.peakAt) : undefined],
          [a.audience.avgViewers != null ? n(a.audience.avgViewers) : t.none, t.avgViewers],
          [n(a.audience.joins), t.joins],
          [n(a.audience.follows), t.follows],
        ] as [string, string, string?][],
        4,
        54,
        ([v, l, note], x, y, w) => tile(x, y, w, 54, v, l, note),
      );
      para(t.seen(n(a.audience.seenViewers)), { size: 7.8, color: FAINT });
    }
    if (a.gifts && a.gifts.total > 0) {
      if (a.gifts.top.length) {
        sub(t.topDonors, 120);
        const total = Math.max(1, a.gifts.diamonds);
        table(
          [
            { label: t.rank, w: 0.07 },
            { label: t.user, w: 0.35 },
            { label: t.gifts, w: 0.13, align: "right" },
            { label: t.diamonds, w: 0.15, align: "right" },
            { label: t.share, w: 0.3 },
          ],
          a.gifts.top.map((g, i) => [String(i + 1), `@${pdfText(g.viewer.username)}`, n(g.gifts), n(g.diamonds), { bar: g.diamonds / total, text: `${Math.round((g.diamonds / total) * 100)} %` }]),
        );
      }
      if (a.gifts.byName.length) {
        sub(t.giftTypes, 100);
        const maxD = Math.max(1, ...a.gifts.byName.map((g) => g.diamonds));
        table(
          [
            { label: t.gift, w: 0.4 },
            { label: t.count, w: 0.15, align: "right" },
            { label: t.diamonds, w: 0.45 },
          ],
          [...a.gifts.byName].sort((x, y) => y.diamonds - x.diamonds).map((g) => [pdfText(g.name) || "?", n(g.count), { bar: g.diamonds / maxD, text: n(g.diamonds) }]),
        );
      }
    }

    // ---------------------------------------------------------------- community
    if (a.topParticipants.length || a.topQuestions.length || a.topTopics.length) {
      section(t.community);
      if (a.topParticipants.length) {
        sub(t.topChatters, 120);
        const maxM = Math.max(1, ...a.topParticipants.map((p) => p.messages));
        table(
          [
            { label: t.rank, w: 0.07 },
            { label: t.user, w: 0.38 },
            { label: t.messages, w: 0.4 },
            { label: t.maxRisk, w: 0.15, align: "right" },
          ],
          a.topParticipants.map((p, i) => [String(i + 1), `@${pdfText(p.viewer.username)}`, { bar: p.messages / maxM, text: n(p.messages) }, String(p.maxRisk)]),
        );
      }
      if (a.topQuestions.length) {
        sub(t.questions, 60);
        for (const q of a.topQuestions) {
          ensure(18);
          const y = doc.y;
          doc.font("Helvetica-Bold").fontSize(8).fillColor(q.answered ? GREEN : ORANGE).text((q.answered ? t.answered : t.unanswered).toUpperCase(), left, y + 1, { width: 76, lineBreak: false });
          doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(`${pdfText(q.question)}   ×${q.count}`, left + 82, y, { width: width - 82, lineBreak: false, ellipsis: true });
          reset(y + 17);
        }
      }
      if (a.topTopics.length) {
        sub(t.topics, 40);
        para(a.topTopics.map((tp) => `${pdfText(tr(tp.topic, lang))} (${tp.count})`).join("   ·   "), { color: INK });
      }
    }

    // ---------------------------------------------------------------- moderation
    section(t.moderation);
    para(t.modSummary(n(a.totals.alerts), a.totals.critical, a.totals.warnings, n(a.totals.actions), a.totals.manualActions), { color: INK });
    const cats = (Object.entries(a.categoryCounts) as [Category, number][]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
    if (cats.length) {
      sub(t.categories, 30 + Math.min(cats.length, 10) * 17);
      const maxC = Math.max(...cats.map(([, v]) => v));
      for (const [c, v] of cats.slice(0, 10)) {
        ensure(17);
        const y = doc.y;
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(pdfText(CATEGORY_LABELS[c]?.[lang] ?? c.replace(/_/g, " ")), left, y, { width: 150, lineBreak: false, ellipsis: true });
        const bw = (width - 200) * (v / maxC);
        doc.roundedRect(left + 158, y + 2, width - 200, 7, 3.5).fill(GOLD_SOFT);
        doc.roundedRect(left + 158, y + 2, Math.max(7, bw), 7, 3.5).fill(GOLD);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(n(v), left + width - 36, y, { width: 36, align: "right", lineBreak: false });
        reset(y + 17);
      }
    }
    if (a.incidents?.length) {
      sub(t.incidents, 80);
      for (const inc of a.incidents) {
        const quote = `“${pdfText(inc.text)}”`;
        const why = pdfText(inc.reasons.map((r) => tr(r, lang)).join(", "));
        doc.font("Helvetica").fontSize(9);
        const h = 28 + doc.heightOfString(quote, { width: width - 28 }) + (why ? 12 : 0);
        ensure(h + 8);
        const y = doc.y;
        const color = inc.severity === "critical" ? RED : inc.severity === "warning" ? ORANGE : MUTED;
        card(left, y, width, h);
        doc.rect(left, y, 4, h).fill(color);
        doc.font("Helvetica-Bold").fontSize(8).fillColor(color).text(`${word(inc.severity, lang).toUpperCase()} · ${inc.riskScore}`, left + 14, y + 9, { lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(`${fmtTime(inc.t)}   @${pdfText(inc.username)}   »   ${word(inc.recommendedAction, lang).toUpperCase()}   (${word(inc.status, lang)})`, left + 110, y + 9, { width: width - 124, lineBreak: false, ellipsis: true });
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(quote, left + 14, y + 23, { width: width - 28 });
        if (why) doc.font("Helvetica").fontSize(7.8).fillColor(MUTED).text(why, left + 14, doc.y + 2, { width: width - 28, lineBreak: false, ellipsis: true });
        reset(y + h + 7);
      }
    }
    if (a.moderationLog?.length) {
      sub(t.log, 80);
      table(
        [
          { label: t.time, w: 0.14 },
          { label: t.action, w: 0.22 },
          { label: t.user, w: 0.38 },
          { label: t.result, w: 0.26 },
        ],
        a.moderationLog.map((l) => [fmtTime(l.t), word(l.action, lang).toUpperCase(), `@${pdfText(l.username)}`, `${word(l.status, lang)}${l.confirmed ? ` (${t.confirmed})` : ""}`]),
      );
    }
  } else {
    // Conversation file: a short summary, then every message.
    doc.moveDown(0.6);
    para(t.transcriptSummary(n(chat.length), n(new Set(chat.map((l) => l.username.toLowerCase())).size)), { color: INK });
  }

  // ---------------------------------------------------------------- transcript
  if (chat.length) {
    if (kind === "report") section(t.transcript, true);
    else sub(t.conversation, 40);
    // The report keeps the most recent messages; the conversation file has all of them.
    const shown = kind === "report" ? chat.slice(-MAX_TRANSCRIPT) : chat;
    if (kind === "report") para(t.transcriptNote(shown.length, chat.length), { size: 8.5 });
    doc.moveDown(0.4);
    for (const line of shown) {
      if (doc.y + 11 > bottom()) doc.addPage();
      const flagged = line.severity === "critical" || line.severity === "warning";
      const text = pdfText(line.text) || "(emoji)";
      doc.font("Helvetica").fontSize(7.5).fillColor(FAINT).text(`${fmtClock(line.t)}  `, left, doc.y, { continued: true });
      doc.font("Helvetica-Bold").fillColor(flagged ? (line.severity === "critical" ? RED : ORANGE) : INK).text(`@${pdfText(line.username)}: `, { continued: true });
      doc.font("Helvetica").fillColor(INK).text(text, { width });
    }
  }

  // ---------------------------------------------------------------- running header & footer
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the margins would make PDFKit start a new page.
    doc.page.margins.bottom = 0;
    doc.page.margins.top = 0;
    if (i > range.start) {
      doc.rect(0, 0, doc.page.width, 30).fill(DARK);
      doc.rect(0, 30, doc.page.width, 1.5).fill(GOLD);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD_LIGHT).text("NOVUS", left, 11, { characterSpacing: 3, lineBreak: false });
      doc.font("Helvetica").fontSize(7).fillColor("#e8dcc6").text("LIVE", left + 56, 12.5, { characterSpacing: 3, lineBreak: false });
      doc.font("Helvetica").fontSize(8).fillColor("#b2aaa0").text(`${liveTitle}  ·  ${fmtDay(entry.startedAt)}`, left + 100, 11.5, { width: width - 100, align: "right", lineBreak: false, ellipsis: true });
    }
    const y = doc.page.height - 34;
    doc.moveTo(left, y - 8).lineTo(left + width, y - 8).lineWidth(0.4).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(FAINT);
    doc.text(`${t.generated} · ${liveTitle}`, left, y, { width: width - 80, lineBreak: false, ellipsis: true });
    doc.text(`${t.page} ${i + 1}/${range.count}`, left + width - 80, y, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}

/** 4 to 7 plain-language takeaways from the numbers (no AI). */
function keyPoints(a: AnalyticsSummary, I: StatsInsights, t: (typeof T)["en"] | (typeof T)["fr"], n: (v: number, d?: number) => string, time: (v: number) => string, lang: Lang): string[] {
  const pct = (v: number) => (lang === "fr" ? `${v} %` : `${v}%`);
  const out: string[] = [t.k.score(I.score.total, t.grade(I.score.total))];
  const cmp = I.comparison?.metrics.filter((m) => m.key !== "duration" && Math.abs(m.deltaPct) >= 10) ?? [];
  const best = [...cmp].filter((m) => (m.higherIsBetter ? m.deltaPct > 0 : m.deltaPct < 0)).sort((x, y) => Math.abs(y.deltaPct) - Math.abs(x.deltaPct))[0];
  const worst = [...cmp].filter((m) => (m.higherIsBetter ? m.deltaPct < 0 : m.deltaPct > 0)).sort((x, y) => Math.abs(y.deltaPct) - Math.abs(x.deltaPct))[0];
  if (best) out.push((best.deltaPct > 0 ? t.k.better : t.k.worse)(t.metrics[best.key], best.deltaPct, n(best.value, 1), n(best.average, 1)));
  if (I.ratios.participation !== null) out.push(t.k.participation(n(I.ratios.participation, 1), n(a.totals.uniqueChatters)));
  const top = a.gifts?.top[0];
  if (a.gifts && a.gifts.diamonds > 0 && top) out.push(t.k.gifts(n(a.gifts.diamonds), Math.round((top.diamonds / a.gifts.diamonds) * 100), pdfText(top.viewer.username)));
  else out.push(t.k.giftsNone);
  if (a.totals.alerts > 0) out.push(t.k.safety(n(a.totals.alerts), a.totals.critical, I.ratios.handledPct !== null ? pct(I.ratios.handledPct) : "—", I.ratios.avgResponseSec !== null ? `${n(I.ratios.avgResponseSec, 1)} s` : "—"));
  else out.push(t.k.safe);
  if (a.peak) out.push(t.k.peak(time(a.peak.t), n(a.peak.messages)));
  const open = a.topQuestions.filter((q) => !q.answered);
  if (open.length) out.push(t.k.open(open.length, pdfText(open[0].question).slice(0, 70)));
  if (worst) out.push((worst.deltaPct > 0 ? t.k.better : t.k.worse)(t.metrics[worst.key], worst.deltaPct, n(worst.value, 1), n(worst.average, 1)));
  return out.slice(0, 7);
}
