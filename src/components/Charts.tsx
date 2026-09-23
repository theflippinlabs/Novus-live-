import { useEffect, useRef, useState, type ReactNode } from "react";

// Small dependency-free SVG charts. Single-series each (no legend needed — the
// card title names the series), thin marks, recessive axes, hover/tap tooltip.

interface Point {
  t: number;
  v: number;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null) as React.RefObject<T>;
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(160, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const AXIS = "#74747e";
const GRID = "#222228";

function Frame({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  return (
    <div style={{ position: "relative" }}>
      {children}
      {tip}
    </div>
  );
}

export function BarChart({
  data,
  height = 140,
  color = "#d9d9e0",
  highlight = "#c9a55a",
  format = (p: Point) => `${p.v}`,
  label,
}: {
  data: Point[];
  height?: number;
  color?: string;
  highlight?: string;
  format?: (p: Point) => string;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 30;
  const padB = 18;
  const w = width - padL;
  const h = height - padB;
  const max = niceMax(Math.max(...data.map((d) => d.v), 1));
  const peak = data.reduce((best, d, i) => (d.v > (data[best]?.v ?? -1) ? i : best), 0);
  const slot = data.length ? Math.min(w / data.length, 28) : w;
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const ticks = [0, max / 2, max];

  const onMove = (clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left - padL;
    const i = Math.floor(x / slot);
    setHover(i >= 0 && i < data.length ? i : null);
  };

  const tip =
    hover !== null && data[hover] ? (
      <div className="chart-tip" style={{ left: padL + hover * slot + slot / 2, top: h - (data[hover].v / max) * h - 6 }}>
        {format(data[hover])}
      </div>
    ) : null;

  return (
    <div ref={ref}>
      <Frame tip={tip}>
        <svg
          className="chart"
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
          onTouchMove={(e) => onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={padL} x2={width} y1={h - (tk / max) * h} y2={h - (tk / max) * h} stroke={GRID} strokeWidth={1} />
              <text x={padL - 6} y={h - (tk / max) * h + 3} fill={AXIS} fontSize={10} textAnchor="end">
                {Math.round(tk)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const bh = (d.v / max) * h;
            const x = padL + i * slot + 1;
            const r = Math.min(4, barW / 2, bh);
            // rounded data-end (top), square at the baseline
            const path = bh <= 0 ? "" : `M${x},${h} V${h - bh + r} Q${x},${h - bh} ${x + r},${h - bh} H${x + barW - r} Q${x + barW},${h - bh} ${x + barW},${h - bh + r} V${h} Z`;
            return path ? <path key={d.t} d={path} fill={i === peak ? highlight : color} opacity={hover === null || hover === i ? 1 : 0.55} /> : null;
          })}
          {data.length > 1 ? (
            <>
              <text x={padL} y={height - 4} fill={AXIS} fontSize={10}>
                {new Date(data[0].t).toTimeString().slice(0, 5)}
              </text>
              <text x={width} y={height - 4} fill={AXIS} fontSize={10} textAnchor="end">
                {new Date(data[data.length - 1].t).toTimeString().slice(0, 5)}
              </text>
            </>
          ) : null}
        </svg>
      </Frame>
    </div>
  );
}

export function LineChart({
  data,
  height = 120,
  color = "#c9a55a",
  min,
  max: maxIn,
  format = (p: Point) => `${p.v}`,
  label,
  zeroLine,
}: {
  data: Point[];
  height?: number;
  color?: string;
  min?: number;
  max?: number;
  format?: (p: Point) => string;
  label: string;
  zeroLine?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 30;
  const padB = 18;
  const w = width - padL - 4;
  const h = height - padB;
  const lo = min ?? Math.min(0, ...data.map((d) => d.v));
  const hi = maxIn ?? niceMax(Math.max(...data.map((d) => d.v), 1));
  const x = (i: number) => padL + (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h;
  const d = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const onMove = (clientX: number, rect: DOMRect) => {
    if (!data.length) return;
    const rel = (clientX - rect.left - padL) / w;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1)))));
  };

  const tip =
    hover !== null && data[hover] ? (
      <div className="chart-tip" style={{ left: x(hover), top: y(data[hover].v) - 8 }}>
        {format(data[hover])}
      </div>
    ) : null;

  return (
    <div ref={ref}>
      <Frame tip={tip}>
        <svg
          className="chart"
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
          onTouchMove={(e) => onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        >
          {[lo, (lo + hi) / 2, hi].map((tk) => (
            <g key={tk}>
              <line x1={padL} x2={width} y1={y(tk)} y2={y(tk)} stroke={zeroLine && tk === 0 ? "#3a3a42" : GRID} strokeWidth={1} />
              <text x={padL - 6} y={y(tk) + 3} fill={AXIS} fontSize={10} textAnchor="end">
                {Math.abs(tk) < 10 && tk % 1 !== 0 ? tk.toFixed(1) : Math.round(tk)}
              </text>
            </g>
          ))}
          {data.length ? <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {hover !== null && data[hover] ? (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="#3a3a42" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(data[hover].v)} r={4.5} fill={color} stroke="#121215" strokeWidth={2} />
            </>
          ) : null}
          {data.length > 1 ? (
            <>
              <text x={padL} y={height - 4} fill={AXIS} fontSize={10}>
                {new Date(data[0].t).toTimeString().slice(0, 5)}
              </text>
              <text x={width - 4} y={height - 4} fill={AXIS} fontSize={10} textAnchor="end">
                {new Date(data[data.length - 1].t).toTimeString().slice(0, 5)}
              </text>
            </>
          ) : null}
        </svg>
      </Frame>
    </div>
  );
}

/** Tiny inline trend (viewer risk). The last point is marked and labelled. */
export function Sparkline({ values, width = 140, height = 36, color = "#d9d9e0" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <span className="muted small">—</span>;
  const max = 100;
  const x = (i: number) => (i / (values.length - 1)) * (width - 6) + 1;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={`Risk trend, latest ${last}`}>
      <line x1={0} x2={width} y1={y(50)} y2={y(50)} stroke={GRID} strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={4} fill={color} stroke="#0e0e11" strokeWidth={2} />
    </svg>
  );
}
