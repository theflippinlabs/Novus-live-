import { useEffect, useRef, useState } from "react";
import type { VideoInfo } from "../../shared/types";
import { api, ApiError } from "../api";
import { useLang } from "../i18n";
import { toast } from "../store";

const TX = {
  en: {
    title: "LIVE video",
    watch: "Watch",
    hide: "Close the video",
    download: "Download (MP4)",
    preparing: "Preparing… (this can take a minute)",
    recording: "Recording in progress — what's recorded so far",
    expires: (d: string) => `Kept until ${d}, then deleted automatically.`,
    stopped: "Recording stopped: the Video option's monthly limit was reached.",
    partial: "The stream dropped: the video is partial.",
    failed: "Download failed.",
  },
  fr: {
    title: "Vidéo du LIVE",
    watch: "Regarder",
    hide: "Fermer la vidéo",
    download: "Télécharger (MP4)",
    preparing: "Préparation… (peut prendre une minute)",
    recording: "Enregistrement en cours — ce qui est déjà enregistré",
    expires: (d: string) => `Conservée jusqu'au ${d}, puis supprimée automatiquement.`,
    stopped: "Enregistrement arrêté : la limite mensuelle de l'option Vidéo est atteinte.",
    partial: "Le flux a coupé : la vidéo est partielle.",
    failed: "Téléchargement impossible.",
  },
};

const dur = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)} h ` : ""}${Math.floor((s % 3600) / 60)} min`;

/** A LIVE's video (Video option): watch it here, or download it as one MP4. */
export function VideoCard({ sessionId }: { sessionId: string }) {
  const lang = useLang();
  const tx = TX[lang];
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const src = `/api/history/${encodeURIComponent(sessionId)}/video.m3u8`;

  useEffect(() => {
    let alive = true;
    api
      .video(sessionId)
      .then((v) => alive && setInfo(v))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Safari / iPhone play HLS natively; other browsers through hls.js (loaded only then).
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = src;
      return;
    }
    let destroy = () => undefined as void;
    void import("hls.js").then(({ default: Hls }) => {
      if (!Hls.isSupported()) return;
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(el);
      destroy = () => hls.destroy();
    });
    return () => destroy();
  }, [open, src]);

  if (!info) return null;
  const date = new Date(info.expiresAt).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long" });

  const download = async () => {
    setBusy(true);
    try {
      // A plain link: the phone saves the MP4 as it streams (no size limit in memory).
      const a = document.createElement("a");
      a.href = `/api/history/${encodeURIComponent(sessionId)}/video.mp4`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast(e instanceof ApiError ? tx.failed : tx.failed, "warn");
    } finally {
      setTimeout(() => setBusy(false), 4000);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◉</span> {tx.title} · {dur(info.seconds)} · {(info.bytes / 1024 ** 3).toFixed(2)} Go
      </div>
      {info.status === "recording" ? <div className="small" style={{ color: "var(--gold)" }}>{tx.recording}</div> : null}
      {info.status === "stopped_quota" ? <div className="small muted">{tx.stopped}</div> : null}
      {info.status === "failed" ? <div className="small muted">{tx.partial}</div> : null}
      {open ? <video ref={ref} className="live-video" controls playsInline preload="metadata" /> : null}
      <div className="grid-2" style={{ marginTop: 10 }}>
        <button className="btn gold" onClick={() => setOpen((o) => !o)}>
          {open ? tx.hide : `▶ ${tx.watch}`}
        </button>
        <button className="btn" onClick={() => void download()} disabled={busy}>
          {busy ? tx.preparing : `⤓ ${tx.download}`}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>{tx.expires(date)}</div>
    </div>
  );
}
