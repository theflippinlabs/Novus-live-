import { memo, useEffect, type ReactNode } from "react";
import type { Severity, ViewerRef } from "../../shared/types";
import { IconClose, SevGlyph } from "./Icons";

const SEV_LABEL: Record<Severity, string> = { normal: "OK", watch: "WATCH", warning: "WARNING", critical: "CRITICAL" };

export function SeverityBadge({ severity, score, compact }: { severity: Severity; score?: number; compact?: boolean }) {
  return (
    <span className={`sev ${severity}`} title={`${SEV_LABEL[severity]}${score !== undefined ? ` · risk ${score}` : ""}`}>
      <SevGlyph level={severity} />
      {compact ? null : SEV_LABEL[severity]}
      {score !== undefined ? <span>{score}</span> : null}
    </span>
  );
}

// Neutral/metallic avatar tones (no blue) derived from the username.
const TONES = ["#d9d9e0", "#b8b8c2", "#c9a55a", "#a89a80", "#cfc6b0", "#9d9da8", "#e0cfa0", "#bfb3a0"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const Avatar = memo(function Avatar({ viewer, size }: { viewer: ViewerRef; size?: "lg" }) {
  const tone = TONES[hash(viewer.username) % TONES.length];
  return (
    <span className={`avatar ${size ?? ""}`} style={{ background: tone }} aria-hidden="true">
      {viewer.avatarUrl ? <img src={viewer.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : viewer.username.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}
    </span>
  );
});

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="sheet-grip" />
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <IconClose width={20} height={20} />
        </button>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  gold,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  gold?: boolean;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={`${o.value === value ? "on" : ""} ${gold ? "gold-on" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The Novus mascot mark (cropped from the app logo). */
export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/icons/logo-mark.webp" width={size} height={size} alt="" style={{ borderRadius: size * 0.22 }} />;
}

/** The NOVUS LIVE banner (mascot, wordmark and LIVE dashboards), full width of its container. */
export function BrandLogo({ maxWidth = 480 }: { maxWidth?: number }) {
  return <img className="brand-logo" src="/icons/logo-banner.webp" width={960} height={508} alt="NOVUS LIVE" style={{ maxWidth }} />;
}
