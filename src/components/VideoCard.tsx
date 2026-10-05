import { useEffect, useRef, useState } from "react";
import type { VideoInfo, VideoPart } from "../../shared/types";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { toast } from "../store";
import { SubtitleControls, SubtitleOverlay } from "./Subtitles";
import type { SubtitleCue } from "../../shared/types";

const TX = {
  en: {
    title: "LIVE video",
    watch: "Watch",
    hide: "Close the video",
    save: "Save to the phone",
    part: (i: number, n: number) => `Part ${i} of ${n}`,
    preparing: "Preparing the video…",
    downloading: (got: string, total: string) => `Downloading… ${got} / ${total}`,
    cancel: "Cancel",
    ready: "Downloaded ✓",
    saveFile: "Save (Photos / Files)",
    where: "On iPhone: “Save Video” puts it in Photos, “Save to Files” in the Files app. On a computer it goes to Downloads.",
    keep: "Keep in Novus",
    keepHint: (d: string) => `Kept in Novus › More › LIVE videos until ${d}, then deleted automatically. Tap “Keep in Novus” to keep it for good.`,
    keptHint: "Kept in Novus for good (no automatic deletion). It counts against the Video option's storage.",
    unkeep: "Stop keeping",
    recording: "Recording in progress — what's recorded so far",
    stopped: "Recording stopped: the Video option's monthly limit was reached.",
    partial: "The stream dropped: the video is partial.",
    failed: "Download failed — try again.",
    long: "Long LIVE: it is saved in parts of about 20 minutes, which a phone keeps easily.",
  },
  fr: {
    title: "Vidéo du LIVE",
    watch: "Regarder",
    hide: "Fermer la vidéo",
    save: "Enregistrer sur le téléphone",
    part: (i: number, n: number) => `Partie ${i} sur ${n}`,
    preparing: "Préparation de la vidéo…",
    downloading: (got: string, total: string) => `Téléchargement… ${got} / ${total}`,
    cancel: "Annuler",
    ready: "Téléchargée ✓",
    saveFile: "Enregistrer (Photos / Fichiers)",
    where: "Sur iPhone : « Enregistrer la vidéo » la met dans Photos, « Enregistrer dans Fichiers » dans l'app Fichiers. Sur ordinateur, elle va dans Téléchargements.",
    keep: "Garder dans Novus",
    keepHint: (d: string) => `Gardée dans Novus › Plus › Vidéos des LIVE jusqu'au ${d}, puis supprimée automatiquement. Touche « Garder dans Novus » pour la garder pour de bon.`,
    keptHint: "Gardée dans Novus pour de bon (pas de suppression automatique). Elle compte dans le stockage de l'option Vidéo.",
    unkeep: "Ne plus garder",
    recording: "Enregistrement en cours — ce qui est déjà enregistré",
    stopped: "Enregistrement arrêté : la limite mensuelle de l'option Vidéo est atteinte.",
    partial: "Le flux a coupé : la vidéo est partielle.",
    failed: "Téléchargement impossible — réessaie.",
    long: "LIVE long : il s'enregistre en parties d'environ 20 minutes, qu'un téléphone garde facilement.",
  },
};

const dur = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)} h ` : ""}${Math.floor((s % 3600) / 60)} min`;
const size = (b: number, lang: "en" | "fr") => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} ${lang === "fr" ? "Go" : "GB"}` : `${Math.max(1, Math.round(b / 1024 ** 2))} ${lang === "fr" ? "Mo" : "MB"}`);

type Download = { index: number; phase: "preparing" | "downloading"; got: number; total: number; abort: AbortController } | { index: number; phase: "ready"; file: File; url: string };

/** A LIVE's video (Video option): watch it here, save it to the phone with progress, or keep it in Novus. */
export function VideoCard({ sessionId, initial, heading }: { sessionId: string; initial?: VideoInfo; heading?: string }) {
  const lang = useLang();
  const tx = TX[lang];
  const [info, setInfo] = useState<VideoInfo | null>(initial ?? null);
  const [open, setOpen] = useState(false);
  const [dl, setDl] = useState<Download | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[] | null>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const src = `/api/history/${encodeURIComponent(sessionId)}/video.m3u8`;

  useEffect(() => {
    if (initial) {
      setInfo(initial);
      return;
    }
    let alive = true;
    api
      .video(sessionId)
      .then((v) => alive && setInfo(v))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [sessionId, initial]);

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

  // Leaving: stop a download in progress and free a downloaded file.
  const current = useRef<Download | null>(null);
  current.current = dl;
  useEffect(
    () => () => {
      const d = current.current;
      if (d?.phase === "ready") URL.revokeObjectURL(d.url);
      else d?.abort.abort();
    },
    [],
  );

  if (!info) return null;
  const date = new Date(info.expiresAt).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long" });
  const parts = info.parts.length ? info.parts : [{ index: 0, seconds: info.seconds, bytes: info.bytes }];

  const download = async (part: VideoPart) => {
    const abort = new AbortController();
    setDl({ index: part.index, phase: "preparing", got: 0, total: part.bytes, abort });
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(sessionId)}/video.mp4?part=${part.index}`, { credentials: "same-origin", signal: abort.signal });
      if (!res.ok || !res.body) throw new ApiError(res.status, `http_${res.status}`);
      const total = Number(res.headers.get("Content-Length")) || part.bytes;
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "novus-live-video.mp4";
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let got = 0;
      let shown = 0;
      setDl({ index: part.index, phase: "downloading", got, total, abort });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as BlobPart);
        got += value.byteLength;
        // Refresh the bar a few times a second, not on every chunk.
        if (Date.now() - shown > 200) {
          shown = Date.now();
          setDl({ index: part.index, phase: "downloading", got, total, abort });
        }
      }
      const file = new File(chunks, name, { type: "video/mp4" });
      setDl({ index: part.index, phase: "ready", file, url: URL.createObjectURL(file) });
    } catch (e) {
      if (abort.signal.aborted) return setDl(null);
      setDl(null);
      toast(e instanceof ApiError ? errorText(e.code, lang) : tx.failed, "warn");
    }
  };

  /** iPhone: the share sheet ("Save Video" → Photos, "Save to Files"); elsewhere a regular download. */
  const save = async (file: File, url: string) => {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: file.name });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const toggleKeep = async () => {
    setKeeping(true);
    try {
      setInfo(await api.keepVideo(sessionId, !info.kept));
    } catch (e) {
      toast(e instanceof ApiError ? errorText(e.code, lang) : tx.failed, "warn");
    } finally {
      setKeeping(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span className="gold">◉</span> {heading ?? tx.title} · {dur(info.seconds)} · {size(info.bytes, lang)}
      </div>
      {info.status === "recording" ? <div className="small" style={{ color: "var(--gold)" }}>{tx.recording}</div> : null}
      {info.status === "stopped_quota" ? <div className="small muted">{tx.stopped}</div> : null}
      {info.status === "failed" ? <div className="small muted">{tx.partial}</div> : null}
      {open ? (
        <>
          <div className="video-wrap">
            <video ref={ref} className="live-video" controls playsInline preload="metadata" />
            <SubtitleOverlay video={ref} cues={cues} />
          </div>
          {info.status !== "recording" ? <SubtitleControls sessionId={sessionId} onCues={setCues} /> : null}
        </>
      ) : null}
      <div className="grid-2" style={{ marginTop: 10 }}>
        <button className="btn gold" onClick={() => setOpen((o) => !o)}>
          {open ? tx.hide : `▶ ${tx.watch}`}
        </button>
        <button className="btn" onClick={() => void toggleKeep()} disabled={keeping || info.status === "recording"}>
          {info.kept ? `★ ${tx.unkeep}` : `☆ ${tx.keep}`}
        </button>
      </div>

      <div className="card-title" style={{ marginTop: 14, fontSize: 12 }}>
        ⤓ {tx.save}
      </div>
      {parts.length > 1 ? <div className="small muted">{tx.long}</div> : null}
      {parts.map((p) => {
        const mine = dl?.index === p.index ? dl : null;
        const busy = Boolean(dl && dl.phase !== "ready");
        return (
          <div key={p.index} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ flex: 1 }} className="small">
                {parts.length > 1 ? `${tx.part(p.index + 1, parts.length)} · ` : ""}
                {dur(p.seconds)} · {size(p.bytes, lang)}
              </span>
              {mine?.phase === "ready" ? (
                <button className="btn sm gold" onClick={() => void save(mine.file, mine.url)}>
                  {tx.saveFile}
                </button>
              ) : mine ? (
                <button className="btn sm" onClick={() => mine.abort.abort()}>
                  {tx.cancel}
                </button>
              ) : (
                <button className="btn sm" onClick={() => void download(p)} disabled={busy}>
                  ⤓ MP4
                </button>
              )}
            </div>
            {mine && mine.phase !== "ready" ? (
              <>
                <div className="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={mine.phase === "preparing" ? 0 : Math.round((mine.got / mine.total) * 100)}>
                  <span className={mine.phase === "preparing" ? "indeterminate" : ""} style={{ width: mine.phase === "preparing" ? "30%" : `${Math.min(100, (mine.got / mine.total) * 100)}%` }} />
                </div>
                <div className="small muted">
                  {mine.phase === "preparing" ? tx.preparing : `${tx.downloading(size(mine.got, lang), size(mine.total, lang))} · ${Math.min(100, Math.round((mine.got / mine.total) * 100))} %`}
                </div>
              </>
            ) : null}
            {mine?.phase === "ready" ? <div className="small" style={{ color: "var(--ok)" }}>{tx.ready}</div> : null}
          </div>
        );
      })}
      <div className="small muted" style={{ marginTop: 8 }}>{tx.where}</div>
      <div className="small muted" style={{ marginTop: 6 }}>{info.kept ? tx.keptHint : tx.keepHint(date)}</div>
    </div>
  );
}
