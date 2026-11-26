// Lightweight SVG charts. Colors come from CSS custom properties (--series-*, --seq-*), so light and
// dark modes each use their own validated steps. Every chart has a hover tooltip and a table view.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface Tip { x: number; y: number; content: ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.content}</div>;
}

function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Card wrapper with an accessible table view toggle. */
export function ChartCard({ title, subtitle, table, children, legend }: {
  title: string; subtitle?: string; legend?: ReactNode;
  table?: { columns: string[]; rows: (string | number)[][] }; children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card chart-card">
      <header className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        {table && (
          <button className="link-btn small" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </header>
      {legend}
      {showTable && table ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

/** Rounded-top bar path: 4px radius at the data end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function BarChart({ data, height = 200, format = String, highlight }: {
  data: { label: string; value: number; tip?: ReactNode }[];
  height?: number; format?: (v: number) => string; highlight?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(2, band - 2));
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)));

  return (
    <div ref={ref} className="viz" onMouseLeave={() => { setTip(null); setHover(null); }}>
      <svg width={width} height={height} role="img" aria-label="Bar chart">
        {ticks.map((t) => (
          <g key={t}>
            <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={pad.t + ih - (t / max) * ih} y2={pad.t + ih - (t / max) * ih} />
            <text className="viz-axis" x={pad.l - 6} y={pad.t + ih - (t / max) * ih + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * ih;
          const x = pad.l + i * band + (band - bw) / 2;
          return (
            <g key={i}>
              <path d={barPath(x, pad.t + ih - h, bw, h)} className={`viz-bar ${highlight === i ? "hl" : ""} ${hover !== null && hover !== i ? "dim" : ""}`} />
              <rect x={pad.l + i * band} y={pad.t} width={band} height={ih} fill="transparent"
                onMouseMove={(e) => {
                  setHover(i);
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({ x: e.clientX - box.left, y: pad.t + ih - h - 8, content: d.tip ?? <><b>{format(d.value)}</b><span>{d.label}</span></> });
                }} />
              {i % labelEvery === 0 && <text className="viz-axis" x={pad.l + i * band + band / 2} y={height - 6} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
        <line className="viz-baseline" x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export function LineChart({ data, height = 180, max: fixedMax, format = String }: {
  data: { label: string; value: number | null }[]; height?: number; max?: number; format?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 12, t: 12, b: 24 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = fixedMax ?? niceMax(Math.max(...data.map((d) => d.value ?? 0), 1));
  const x = (i: number) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  let path = "";
  data.forEach((d, i) => {
    if (d.value == null) return;
    path += `${path && data[i - 1]?.value != null ? "L" : "M"}${x(i)},${y(d.value)} `;
  });
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));
  const h = hover != null ? data[hover] : null;

  return (
    <div ref={ref} className="viz"
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const rel = (e.clientX - box.left - pad.l) / iw;
        setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1)))));
      }}
      onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label="Line chart">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text className="viz-axis" x={pad.l - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => i % labelEvery === 0 && (
          <text key={i} className="viz-axis" x={x(i)} y={height - 6} textAnchor="middle">{d.label}</text>
        ))}
        <path d={path} className="viz-line" />
        {hover != null && (
          <>
            <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />
            {h?.value != null && <circle className="viz-dot" cx={x(hover)} cy={y(h.value)} r={5} />}
          </>
        )}
      </svg>
      {hover != null && h && (
        <div className="viz-tip" style={{ left: x(hover), top: h.value != null ? y(h.value) - 10 : pad.t }}>
          <b>{h.value != null ? format(h.value) : "No data"}</b><span>{h.label}</span>
        </div>
      )}
    </div>
  );
}

/** Weekday × hour heatmap on a single-hue sequential ramp. */
export function Heatmap({ matrix, rowLabels, colLabel, format }: {
  matrix: number[][]; rowLabels: string[]; colLabel: (c: number) => string; format: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const cols = matrix[0]?.length ?? 24;
  const padL = 36, padT = 4, padB = 20;
  const cw = (width - padL) / cols;
  const ch = Math.min(26, Math.max(14, cw));
  const height = padT + ch * matrix.length + padB;
  const max = Math.max(1, ...matrix.flat());
  const steps = 7;
  const step = (v: number) => (v <= 0 ? 0 : Math.min(steps, 1 + Math.floor((v / max) * steps * 0.999)));

  return (
    <div ref={ref} className="viz" onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label="Focus heatmap by weekday and hour">
        {matrix.map((row, r) => (
          <g key={r}>
            <text className="viz-axis" x={padL - 6} y={padT + r * ch + ch / 2 + 4} textAnchor="end">{rowLabels[r]}</text>
            {row.map((v, c) => (
              <rect key={c} x={padL + c * cw + 1} y={padT + r * ch + 1} width={Math.max(1, cw - 2)} height={ch - 2} rx={3}
                className={`heat heat-${step(v)}`}
                onMouseMove={() => setTip({ x: padL + c * cw + cw / 2, y: padT + r * ch - 4, content: <><b>{format(v)}</b><span>{rowLabels[r]} {colLabel(c)}</span></> })} />
            ))}
          </g>
        ))}
        {Array.from({ length: cols }, (_, c) => c % 3 === 0 && (
          <text key={c} className="viz-axis" x={padL + c * cw + cw / 2} y={height - 4} textAnchor="middle">{colLabel(c)}</text>
        ))}
      </svg>
      <div className="heat-legend" aria-hidden>
        <span className="muted small">Less</span>
        {Array.from({ length: steps + 1 }, (_, i) => <span key={i} className={`heat-swatch heat-${i}`} />)}
        <span className="muted small">More</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Horizontal bars with labels on the left and values on the right (text in text colors). */
export function HBars({ rows, format = String }: { rows: { label: ReactNode; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="hbars">
      {rows.map((r, i) => (
        <li key={i} title={r.sub}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="hbar-value">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two-series stacked columns (completed vs abandoned), with legend + direct labels. */
export function StackedBars({ rows, series, height = 200 }: {
  rows: { label: string; a: number; b: number }[]; series: [string, string]; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const pad = { l: 32, r: 8, t: 16, b: 24 };
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.a + r.b)));
  const band = iw / rows.length;
  const bw = Math.min(24, band - 8);
  const gap = 2;

  return (
    <div ref={ref} className="viz" onMouseLeave={() => setTip(null)}>
      <div className="legend">
        <span><i className="sw s1" />{series[0]}</span>
        <span><i className="sw s2" />{series[1]}</span>
      </div>
      <svg width={width} height={height} role="img" aria-label={`${series[0]} vs ${series[1]} by session length`}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={pad.t + ih - (t / max) * ih} y2={pad.t + ih - (t / max) * ih} />
            <text className="viz-axis" x={pad.l - 6} y={pad.t + ih - (t / max) * ih + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = pad.l + i * band + (band - bw) / 2;
          const ha = (r.a / max) * ih, hb = (r.b / max) * ih;
          const total = r.a + r.b;
          return (
            <g key={r.label}
              onMouseMove={() => setTip({ x: x + bw / 2, y: pad.t + ih - ha - hb - 8, content: <><b>{r.label}</b><span>{series[0]}: {r.a}</span><span>{series[1]}: {r.b}</span></> })}>
              <rect x={pad.l + i * band} y={pad.t} width={band} height={ih} fill="transparent" />
              {/* bottom segment square, top segment carries the rounded data end */}
              {ha > 0 && (hb > 0
                ? <rect x={x} y={pad.t + ih - ha} width={bw} height={ha} className="viz-s1" />
                : <path d={barPath(x, pad.t + ih - ha, bw, ha)} className="viz-s1" />)}
              {hb > 0 && <path d={barPath(x, pad.t + ih - ha - hb, bw, Math.max(0, hb - (ha > 0 ? gap : 0)))} className="viz-s2" />}
              {total > 0 && <text className="viz-value" x={x + bw / 2} y={pad.t + ih - ha - hb - 4} textAnchor="middle">{Math.round((r.a / total) * 100)}%</text>}
              <text className="viz-axis" x={pad.l + i * band + band / 2} y={height - 6} textAnchor="middle">{r.label}</text>
            </g>
          );
        })}
        <line className="viz-baseline" x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
