"use client";

import { useId, useState } from "react";

// Validated categorical slots (reference palette): occupied, vacant, blocked.
// Light / dark steps are swapped by CSS variables declared in chart-theme.css.
export const SERIES = [
  { key: "occupied", label: "Occupied", cls: "fill-[var(--viz-1)]" },
  { key: "vacant", label: "Vacant", cls: "fill-[var(--viz-2)]" },
  { key: "blocked", label: "Blocked", cls: "fill-[var(--viz-3)]" },
] as const;

export type StackRow = { id: string; label: string; occupied: number; vacant: number; blocked: number; href?: string };

/** Horizontal stacked bar per building: part-to-whole of bed capacity. */
export function OccupancyStackChart({ rows }: { rows: StackRow[] }) {
  const [hover, setHover] = useState<{ row: StackRow; key: string; x: number; y: number } | null>(null);
  const labelW = 190;
  const barH = 20;
  const rowH = 32;
  const width = 640;
  const MAX_LABEL = 27;
  const shorten = (label: string) => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label);
  const plotW = width - labelW - 48;
  const max = Math.max(1, ...rows.map((r) => r.occupied + r.vacant + r.blocked));
  const height = rows.length * rowH + 8;
  const id = useId();

  return (
    <div className="viz-root relative" data-chart="stack">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-[var(--viz-ink-2)]" aria-label="Legend">
        {SERIES.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="2" className={s.cls} /></svg>{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-title`} onMouseLeave={() => setHover(null)}>
        <title id={`${id}-title`}>Bed capacity by building: occupied, vacant and blocked</title>
        {rows.map((row, i) => {
          const y = i * rowH + 6;
          const total = row.occupied + row.vacant + row.blocked;
          let x = labelW;
          return (
            <g key={row.id} data-row={row.label}>
              <text x={labelW - 8} y={y + barH / 2 + 4} textAnchor="end" className="fill-[var(--viz-ink-1)] text-[12px]"><title>{row.label}</title>{shorten(row.label)}</text>
              {SERIES.map((s) => {
                const value = row[s.key];
                const w = total === 0 ? 0 : (value / max) * plotW;
                const seg = { x, w };
                x += w;
                if (w <= 0) return null;
                const gap = 2;
                const isLast = x >= labelW + (total / max) * plotW - 0.01;
                return (
                  <g key={s.key} onMouseEnter={(ev) => setHover({ row, key: s.key, x: ev.clientX, y: ev.clientY })} onMouseMove={(ev) => setHover({ row, key: s.key, x: ev.clientX, y: ev.clientY })}>
                    <rect x={seg.x} y={y} width={Math.max(0, seg.w - gap)} height={barH} rx={isLast ? 4 : 0} className={s.cls} />
                    {seg.w - gap > 26 && <text x={seg.x + 6} y={y + barH / 2 + 4} className="text-[11px] fill-white">{value}</text>}
                  </g>
                );
              })}
              <text x={labelW + (total / max) * plotW + 6} y={y + barH / 2 + 4} className="fill-[var(--viz-ink-2)] text-[11px]">{total}</text>
            </g>
          );
        })}
        <line x1={labelW} x2={labelW} y1={0} y2={height} className="stroke-[var(--viz-axis)]" strokeWidth="1" />
      </svg>
      {hover && (
        <div role="tooltip" className="pointer-events-none fixed z-10 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow dark:border-zinc-700 dark:bg-zinc-900" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="font-medium">{hover.row.label}</div>
          <div>{SERIES.find((s) => s.key === hover.key)?.label}: {hover.row[hover.key as "occupied" | "vacant" | "blocked"]} of {hover.row.occupied + hover.row.vacant + hover.row.blocked} beds</div>
        </div>
      )}
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-[var(--viz-ink-2)]">Table view</summary>
        <table className="mt-1 w-full"><thead><tr><th className="text-left">Building</th><th className="text-right">Occupied</th><th className="text-right">Vacant</th><th className="text-right">Blocked</th><th className="text-right">Capacity</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.label}</td><td className="text-right tabular-nums">{r.occupied}</td><td className="text-right tabular-nums">{r.vacant}</td><td className="text-right tabular-nums">{r.blocked}</td><td className="text-right tabular-nums">{r.occupied + r.vacant + r.blocked}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

export type TrendPoint = { date: string; occupied: number; capacity: number };

/** Axis step giving 3–5 clean ticks (1, 2, 5 × 10^n). */
function niceStep(max: number): number {
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  return candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1];
}

/** Single-series line: occupied beds at the end of each day, last N days. */
export function OccupancyTrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const width = 640;
  const height = 180;
  const padL = 36;
  const padR = 16;
  const padT = 12;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const rawMax = Math.max(1, ...points.map((p) => Math.max(p.occupied, p.capacity)));
  const step = niceStep(rawMax);
  const maxY = Math.ceil(rawMax / step) * step;
  const yTicks = Array.from({ length: maxY / step + 1 }, (_, i) => i * step);
  const xOf = (i: number) => padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yOf = (v: number) => padT + plotH - (v / maxY) * plotH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.occupied).toFixed(1)}`).join(" ");
  const area = `${path} L${xOf(points.length - 1).toFixed(1)},${yOf(0)} L${xOf(0).toFixed(1)},${yOf(0)} Z`;
  const last = points[points.length - 1];

  function onMove(ev: React.MouseEvent<SVGSVGElement>) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((x - padL) / plotW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  return (
    <div className="viz-root" data-chart="trend">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-title`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <title id={`${id}-title`}>Occupied beds at the end of each day, last {points.length} days</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={yOf(t)} y2={yOf(t)} className="stroke-[var(--viz-grid)]" strokeWidth="1" />
            <text x={padL - 6} y={yOf(t) + 4} textAnchor="end" className="fill-[var(--viz-ink-3)] text-[10px] tabular-nums">{t}</text>
          </g>
        ))}
        <path d={area} className="fill-[var(--viz-1)]" opacity="0.1" />
        <path d={path} fill="none" className="stroke-[var(--viz-1)]" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <g>
            <circle cx={xOf(points.length - 1)} cy={yOf(last.occupied)} r="5" className="fill-[var(--viz-1)] stroke-[var(--viz-surface)]" strokeWidth="2" />
            <text x={xOf(points.length - 1) - 8} y={yOf(last.occupied) - 8} textAnchor="end" className="fill-[var(--viz-ink-1)] text-[11px]">{last.occupied} today</text>
          </g>
        )}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => points[i] && (
          <text key={i} x={xOf(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-[var(--viz-ink-3)] text-[10px]">{points[i].date.slice(5)}</text>
        ))}
        {hover !== null && points[hover] && (
          <g>
            <line x1={xOf(hover)} x2={xOf(hover)} y1={padT} y2={padT + plotH} className="stroke-[var(--viz-axis)]" strokeWidth="1" />
            <circle cx={xOf(hover)} cy={yOf(points[hover].occupied)} r="5" className="fill-[var(--viz-1)] stroke-[var(--viz-surface)]" strokeWidth="2" />
            <foreignObject x={Math.min(xOf(hover) + 8, width - 150)} y={padT} width="142" height="48">
              <div role="tooltip" className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] shadow dark:border-zinc-700 dark:bg-zinc-900">
                <div className="font-medium">{points[hover].date}</div>
                <div>{points[hover].occupied} occupied of {points[hover].capacity}</div>
              </div>
            </foreignObject>
          </g>
        )}
      </svg>
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-[var(--viz-ink-2)]">Table view</summary>
        <div className="max-h-48 overflow-auto"><table className="mt-1 w-full"><thead><tr><th className="text-left">Date</th><th className="text-right">Occupied</th><th className="text-right">Capacity</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.date}><td>{p.date}</td><td className="text-right tabular-nums">{p.occupied}</td><td className="text-right tabular-nums">{p.capacity}</td></tr>)}</tbody></table></div>
      </details>
    </div>
  );
}
