import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricSeries, MetricUnit } from '../../api/observabilityApi';
import { formatMetric, shortPod } from '../../utils/observability';

const PALETTE = ['#0284c7', '#7c3aed', '#d97706', '#059669', '#db2777', '#0891b2', '#65a30d', '#ea580c'];
const PAD = { top: 10, right: 12, bottom: 22, left: 58 };

interface LineChartProps {
  series: MetricSeries[];
  unit: MetricUnit;
  limit?: number;
  height?: number;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Rounds the axis maximum up to a readable step so ticks land on even values.
const niceMax = (max: number) => {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
};

export const LineChart: React.FC<LineChartProps> = ({ series, unit, limit, height = 180 }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(200, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(() => series.filter((s) => s.points.length > 0), [series]);

  const bounds = useMemo(() => {
    let minT = Infinity;
    let maxT = -Infinity;
    let maxV = 0;
    for (const s of visible)
      for (const [t, v] of s.points) {
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
        if (Number.isFinite(v) && v > maxV) maxV = v;
      }
    if (limit && limit > maxV && limit < maxV * 4) maxV = limit;
    return { minT, maxT: maxT === minT ? minT + 60000 : maxT, maxV: niceMax(maxV * 1.1) };
  }, [visible, limit]);

  if (!visible.length) {
    return (
      <div ref={wrapRef} className="flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-md" style={{ height }}>
        No data
      </div>
    );
  }

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - bounds.minT) / (bounds.maxT - bounds.minT)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / bounds.maxV) * innerH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * bounds.maxV);
  const xTickCount = Math.max(2, Math.min(6, Math.floor(innerW / 90)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => bounds.minT + ((bounds.maxT - bounds.minT) * i) / (xTickCount - 1));

  const path = (s: MetricSeries) =>
    s.points
      .filter(([, v]) => Number.isFinite(v))
      .map(([t, v], i) => `${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');

  // Nearest point of every series to the hovered time.
  const hoverT = hoverX === null ? null : bounds.minT + ((hoverX - PAD.left) / innerW) * (bounds.maxT - bounds.minT);
  const hoverRows =
    hoverT === null
      ? []
      : visible.map((s, i) => {
          let best = s.points[0];
          for (const p of s.points) if (Math.abs(p[0] - hoverT) < Math.abs(best[0] - hoverT)) best = p;
          return { name: shortPod(s.name), color: PALETTE[i % PALETTE.length], t: best[0], v: best[1] };
        });

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    setHoverX(Math.min(Math.max(px, PAD.left), PAD.left + innerW));
  };

  const tooltipLeft = hoverX !== null && hoverX > width / 2;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label="Metric chart" className="block">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400" fontSize={10}>
              {formatMetric(v, unit)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="fill-slate-400" fontSize={10}>
            {hhmm(t)}
          </text>
        ))}
        {limit !== undefined && limit > 0 && limit <= bounds.maxV && (
          <g>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(limit)} y2={y(limit)} stroke="#e11d48" strokeDasharray="4 4" strokeWidth={1} />
            <text x={PAD.left + innerW - 2} y={y(limit) - 4} textAnchor="end" fontSize={10} fill="#e11d48">
              limit
            </text>
          </g>
        )}
        {visible.map((s, i) => (
          <path key={s.name + i} d={path(s)} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.6} strokeLinejoin="round" />
        ))}
        {hoverX !== null && (
          <g pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeWidth={1} />
            {hoverRows.map((r) => (
              <circle key={r.name + r.color} cx={x(r.t)} cy={y(r.v)} r={3} fill={r.color} stroke="#fff" strokeWidth={1} />
            ))}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverX(null)}
        />
      </svg>

      {hoverX !== null && hoverRows.length > 0 && (
        <div
          className="absolute top-1 z-10 pointer-events-none rounded-md border border-slate-200 bg-white/95 shadow-sm px-2 py-1.5 text-[11px] min-w-[140px]"
          style={tooltipLeft ? { right: width - hoverX + 8 } : { left: hoverX + 8 }}
        >
          <div className="font-semibold text-slate-700 mb-0.5">{hhmm(hoverRows[0].t)}</div>
          {hoverRows.map((r) => (
            <div key={r.name + r.color} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 font-mono text-slate-600">
                <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                {r.name}
              </span>
              <span className="font-mono text-slate-900">{formatMetric(r.v, unit)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 pl-1">
        {visible.map((s, i) => (
          <span key={s.name + i} className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600" title={s.name}>
            <span className="w-2 h-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {shortPod(s.name)}
          </span>
        ))}
      </div>
    </div>
  );
};
