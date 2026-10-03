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
  // The box takes the video's shape (TikTok LIVEs are vertical); zoom cuts the black bands TikTok adds.
  const [ratio, setRatio] = useState(9 / 16);
  const [zoom, setZoom] = useState(1);

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
    const shape = () => el.videoWidth && el.videoHeight && setRatio(el.videoWidth / el.videoHeight);
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
          <div className="watch-frame" style={{ aspectRatio: String(ratio) }}>
            <video ref={ref} controls={zoom === 1} playsInline autoPlay muted style={{ transform: `scale(${zoom})` }} onClick={() => zoom !== 1 && ref.current && (ref.current.muted = !ref.current.muted)} />
          </div>
          <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 8 }}>
            <button className="btn sm" onClick={() => setZoom((z) => (z === 1 ? 1.5 : z === 1.5 ? 2 : 1))}>
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
      <div className="small muted" style={{ marginTop: 6 }}>
        {fr ? "Son coupé au départ : touche le haut-parleur du lecteur pour l'entendre (en zoom, touche l'image). Zoom : agrandit l'image et coupe les bandes noires." : "Muted at first: tap the player's speaker to hear it (when zoomed, tap the picture). Zoom enlarges the picture and cuts the black bands."}
      </div>
    </div>
  );
}
