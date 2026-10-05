import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";

/*
 * Watch the LIVE in the app while moderating: TikTok's own stream, played by the phone straight
 * from TikTok (iPhone plays HLS natively; other browsers through hls.js). Muted at first, so it
 * starts on its own; one tap for the sound. Falls back to the recording (about a minute behind).
 */
export function WatchLive({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  const fr = lang === "fr";
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<{ url: string; delayed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The frame size, and where the picture sits inside TikTok's black bands (measured by the server).
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .watch()
      .then((r) => alive && setSrc(r))
      .catch((e) => alive && setError(errorText(e instanceof ApiError ? e.code : "watch_unavailable", lang)));
    return () => {
      alive = false;
    };
  }, [attempt, lang]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    // The signed TikTok link expires: on a playback error, ask for a fresh one (a few times).
    const retry = () => setTimeout(() => setAttempt((a) => (a < 5 ? a + 1 : a)), 1500);
    el.addEventListener("error", retry);
    const shape = () => el.videoWidth && el.videoHeight && setSize({ w: el.videoWidth, h: el.videoHeight });
    el.addEventListener("loadedmetadata", shape);
    el.addEventListener("resize", shape);
    let destroy = () => undefined as void;
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = src.url;
      void el.play().catch(() => undefined);
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) return;
        const hls = new Hls({ liveSyncDurationCount: 2 });
        hls.loadSource(src.url);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) retry();
        });
        void el.play().catch(() => undefined);
        destroy = () => hls.destroy();
      });
    }
    return () => {
      el.removeEventListener("error", retry);
      el.removeEventListener("loadedmetadata", shape);
      el.removeEventListener("resize", shape);
      destroy();
      el.removeAttribute("src");
      el.load();
    };
  }, [src]);

  // The black bands can change (a guest joins or leaves): measured again now and then.
  useEffect(() => {
    if (!src || src.delayed) return;
    let alive = true;
    const load = () =>
      void api
        .watchCrop()
        .then((r) => alive && setCrop(r.crop))
        .catch(() => undefined);
    const first = setTimeout(load, 3000);
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [src]);

  // Cut the bands only when they are worth it (more than 4 % of the picture).
  const box = (() => {
    const W = size?.w ?? 9;
    const H = size?.h ?? 16;
    const c = crop && size && crop.w <= W && crop.h <= H && (crop.w < W * 0.96 || crop.h < H * 0.96) ? crop : { x: 0, y: 0, w: W, h: H };
    return { ratio: c.w / c.h, style: { width: `${(W / c.w) * 100}%`, height: `${(H / c.h) * 100}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` } };
  })();

  return (
    <div className="card watch-live">
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <span className="small" style={{ flex: 1 }}>
          <span className="live-dot" /> {fr ? "LIVE en direct" : "LIVE now"}
          {src?.delayed ? <span className="muted"> · {fr ? "depuis l'enregistrement (≈ 1 min de décalage)" : "from the recording (≈ 1 min behind)"}</span> : null}
        </span>
        <button className="btn sm ghost" onClick={onClose} aria-label={fr ? "Fermer la vidéo" : "Close the video"}>
          ✕
        </button>
      </div>
      {error ? (
        <div className="small muted">
          {error}{" "}
          <button className="btn sm" onClick={() => setAttempt((a) => a + 1)}>
            {fr ? "Réessayer" : "Try again"}
          </button>
        </div>
      ) : (
        <>
          <div className="watch-frame" style={{ aspectRatio: String(box.ratio), width: `min(100%, calc(var(--watch-h) * ${box.ratio}))` }}>
            <video
              ref={ref}
              playsInline
              autoPlay
              muted={muted}
              style={{ ...box.style, transform: `scale(${zoom})` }}
              onClick={() => setMuted((m) => !m)}
            />
          </div>
          <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 8 }}>
            <button className="btn sm" onClick={() => setMuted((m) => !m)}>
              {muted ? `🔇 ${fr ? "Activer le son" : "Sound on"}` : `🔊 ${fr ? "Couper le son" : "Sound off"}`}
            </button>
            <button className="btn sm" onClick={() => setZoom((z) => (z === 1 ? 1.25 : z === 1.25 ? 1.5 : 1))}>
              🔍 Zoom ×{zoom}
            </button>
            <button
              className="btn sm"
              onClick={() => {
                const el = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
                if (!el) return;
                if (el.requestFullscreen) void el.requestFullscreen().catch(() => el.webkitEnterFullscreen?.());
                else el.webkitEnterFullscreen?.();
              }}
            >
              ⛶ {fr ? "Plein écran" : "Full screen"}
            </button>
          </div>
        </>
      )}
      <div className="small muted watch-note" style={{ marginTop: 6 }}>
        {fr ? "Les bandes noires de TikTok sont coupées automatiquement. Son coupé au départ : touche l'image ou « Activer le son »." : "TikTok's black bands are cut automatically. Muted at first: tap the picture or “Sound on”."}
      </div>
    </div>
  );
}
