import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type {
  AnomalyRecord,
  ComparisonResult,
  ForecastResult,
  ObservationPoint,
  SeasonalSummary,
  TrendAnalysisResult,
  YearOverYearPoint,
} from '../types/aethryx';

interface TimeSeriesTrendChartProps {
  observations: ObservationPoint[];
  trend: TrendAnalysisResult;
  anomalies?: AnomalyRecord[];
  forecast?: ForecastResult;
  showForecast?: boolean;
  variableLabel: string;
  units: string;
  regionName: string;
  sourceLabel: string;
  dateRange: string;
  isDemo?: boolean;
}

export function TimeSeriesTrendChart({
  observations,
  trend,
  anomalies = [],
  forecast,
  showForecast = false,
  variableLabel,
  units,
  regionName,
  sourceLabel,
  dateRange,
  isDemo = false,
}: TimeSeriesTrendChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const validObs = observations.filter(
    (o): o is ObservationPoint & { value: number } => o.value !== null && Number.isFinite(o.value)
  );

  if (validObs.length < 2) {
    return (
      <div className="bg-[#0D131F] border border-slate-800 rounded p-6 text-xs text-slate-400">
        Insufficient valid observations ({validObs.length}) to plot a time-series chart.
      </div>
    );
  }

  const forecastPts = showForecast && forecast?.available ? forecast.points : [];
  const allX = validObs.map((o) => o.decimalYear).concat(forecastPts.map((f) => f.decimalYear));
  const allY = validObs
    .map((o) => o.value)
    .concat(trend.regressionSeries.map((r) => r.ciLow))
    .concat(trend.regressionSeries.map((r) => r.ciHigh))
    .concat(forecastPts.map((f) => f.piLow95))
    .concat(forecastPts.map((f) => f.piHigh95));

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const spanX = maxX - minX || 1;
  const rawMinY = Math.min(...allY);
  const rawMaxY = Math.max(...allY);
  const padY = (rawMaxY - rawMinY) * 0.08 || 1;
  const minY = rawMinY - padY;
  const maxY = rawMaxY + padY;
  const spanY = maxY - minY || 1;

  const W = 860;
  const H = 320;
  const padL = 62;
  const padR = 24;
  const padT = 22;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const sx = (x: number) => padL + ((x - minX) / spanX) * plotW;
  const sy = (y: number) => padT + plotH - ((y - minY) / spanY) * plotH;

  const obsPath = validObs
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${sx(pt.decimalYear).toFixed(1)} ${sy(pt.value).toFixed(1)}`)
    .join(' ');

  const regPts = trend.regressionSeries;
  const regPath = regPts
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${sx(pt.decimalYear).toFixed(1)} ${sy(pt.fitted).toFixed(1)}`)
    .join(' ');

  const ciPolygon =
    regPts.length >= 2
      ? [
          ...regPts.map((p) => `${sx(p.decimalYear).toFixed(1)},${sy(p.ciHigh).toFixed(1)}`),
          ...regPts
            .slice()
            .reverse()
            .map((p) => `${sx(p.decimalYear).toFixed(1)},${sy(p.ciLow).toFixed(1)}`),
        ].join(' ')
      : '';

  const forecastLinePath =
    forecastPts.length >= 1
      ? [
          `M ${sx(validObs[validObs.length - 1].decimalYear).toFixed(1)} ${sy(
            validObs[validObs.length - 1].value
          ).toFixed(1)}`,
          ...forecastPts.map((p) => `L ${sx(p.decimalYear).toFixed(1)} ${sy(p.predicted).toFixed(1)}`),
        ].join(' ')
      : '';

  const forecastPiPolygon =
    forecastPts.length >= 2
      ? [
          ...forecastPts.map((p) => `${sx(p.decimalYear).toFixed(1)},${sy(p.piHigh95).toFixed(1)}`),
          ...forecastPts
            .slice()
            .reverse()
            .map((p) => `${sx(p.decimalYear).toFixed(1)},${sy(p.piLow95).toFixed(1)}`),
        ].join(' ')
      : '';

  const anomalySet = new Map(anomalies.map((a) => [a.date, a]));

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minY + t * spanY);
  const xTickCount = Math.min(6, validObs.length);
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const idx = Math.round((i / Math.max(1, xTickCount - 1)) * (validObs.length - 1));
    return validObs[idx];
  });

  function handleExportSvg() {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aethryx-${regionName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-trend.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hovered = hoverIdx !== null ? validObs[hoverIdx] : null;
  const hoveredReg = hovered ? regPts.find((r) => r.date === hovered.date) : null;

  return (
    <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-100">
            {variableLabel} ({units}) — {regionName}
            {isDemo && <span className="ml-2 text-amber-400 font-mono">[DEMO]</span>}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {dateRange} · Source: {sourceLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={handleExportSvg}
          className="px-2.5 py-1 text-[11px] font-medium text-slate-300 bg-[#07090E] border border-slate-700 rounded hover:border-cyan-500/60 hover:text-cyan-300 transition-colors inline-flex items-center gap-1.5"
        >
          <Download className="w-3 h-3" />
          <span>Export SVG</span>
        </button>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto bg-[#07090E] border border-slate-800/80 rounded select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Grid lines */}
          {yTicks.map((val, idx) => {
            const yPos = sy(val);
            return (
              <g key={idx}>
                <line x1={padL} y1={yPos} x2={W - padR} y2={yPos} stroke="#1E293B" strokeDasharray="3,3" />
                <text
                  x={padL - 8}
                  y={yPos + 3}
                  textAnchor="end"
                  fill="#94A3B8"
                  fontSize="10"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {xTicks.map((pt, idx) => (
            <text
              key={`${pt.date}-${idx}`}
              x={sx(pt.decimalYear)}
              y={H - 12}
              textAnchor="middle"
              fill="#94A3B8"
              fontSize="10"
              fontFamily="IBM Plex Mono, monospace"
            >
              {pt.date}
            </text>
          ))}

          {/* Axes */}
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#334155" />
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#334155" />

          {/* 95% Regression Confidence Band */}
          {ciPolygon && <polygon points={ciPolygon} fill="#F59E0B" fillOpacity="0.12" />}

          {/* Forecast 95% Prediction Interval */}
          {forecastPiPolygon && <polygon points={forecastPiPolygon} fill="#8B5CF6" fillOpacity="0.16" />}

          {/* Observed Line */}
          <path d={obsPath} fill="none" stroke="#06B6D4" strokeWidth="1.85" />

          {/* OLS Trend Line */}
          {regPath && (
            <path d={regPath} fill="none" stroke="#F59E0B" strokeWidth="2" strokeDasharray="6,4" />
          )}

          {/* Forecast Line */}
          {forecastLinePath && (
            <path d={forecastLinePath} fill="none" stroke="#A78BFA" strokeWidth="2" strokeDasharray="4,3" />
          )}

          {/* Anomaly Dots */}
          {validObs.map((pt, i) => {
            const anom = anomalySet.get(pt.date);
            if (!anom) return null;
            return (
              <circle
                key={`anom-${pt.date}-${i}`}
                cx={sx(pt.decimalYear)}
                cy={sy(pt.value)}
                r={4.2}
                fill={anom.severity === 'EXTREME' ? '#F43F5E' : '#F59E0B'}
                stroke="#07090E"
                strokeWidth="1.2"
              />
            );
          })}

          {/* Crosshair Hover */}
          {hovered && (
            <g>
              <line
                x1={sx(hovered.decimalYear)}
                y1={padT}
                x2={sx(hovered.decimalYear)}
                y2={H - padB}
                stroke="#38BDF8"
                strokeOpacity="0.5"
                strokeDasharray="2,2"
              />
              <circle
                cx={sx(hovered.decimalYear)}
                cy={sy(hovered.value)}
                r={4.5}
                fill="#22D3EE"
                stroke="#07090E"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* Invisible hit targets for crisp hover snapping */}
          {validObs.map((pt, idx) => (
            <rect
              key={`hit-${pt.date}-${idx}`}
              x={sx(pt.decimalYear) - plotW / validObs.length / 2}
              y={padT}
              width={Math.max(4, plotW / validObs.length)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          ))}
        </svg>

        {hovered && (
          <div className="mt-2 flex flex-wrap items-center gap-4 px-3 py-1.5 bg-[#07090E] border border-slate-800 rounded text-xs font-mono tabular-nums text-slate-200">
            <span>Date: {hovered.date}</span>
            <span className="text-cyan-400">
              Observed: {hovered.value.toFixed(4)} {units}
            </span>
            {hoveredReg && (
              <span className="text-amber-400">
                OLS Fit: {hoveredReg.fitted.toFixed(4)} {units}
              </span>
            )}
            {anomalySet.has(hovered.date) && (
              <span className="text-rose-400">
                Anomaly: {anomalySet.get(hovered.date)!.zScore.toFixed(2)}σ
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-cyan-400 inline-block" /> Observed ({units})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-amber-400 inline-block" /> OLS Regression + 95% CI
        </span>
        {anomalies.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Flagged Anomalies ({anomalies.length})
          </span>
        )}
        {forecastPts.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-violet-400 inline-block" /> Estimated Projection (95% PI — Not Observed)
          </span>
        )}
      </div>
    </div>
  );
}

export function SeasonalCycleChart({
  seasonalCycle,
  units,
}: {
  seasonalCycle: SeasonalSummary[];
  units: string;
}) {
  if (seasonalCycle.length === 0) {
    return (
      <div className="bg-[#0D131F] border border-slate-800 rounded p-4 text-xs text-slate-400">
        Monthly seasonal profile unavailable for annual-only aggregation.
      </div>
    );
  }

  const minV = Math.min(...seasonalCycle.map((s) => s.min));
  const maxV = Math.max(...seasonalCycle.map((s) => s.max));
  const span = maxV - minV || 1;
  const W = 540;
  const H = 200;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const sy = (v: number) => padT + plotH - ((v - minV) / span) * plotH;

  return (
    <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-2">
      <div className="text-xs font-semibold text-slate-100">
        Monthly Climatology Profile ({units}) — Mean &amp; Min/Max Envelope
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-[#07090E] border border-slate-800/80 rounded">
        {seasonalCycle.map((s, idx) => {
          const cx = padL + ((idx + 0.5) / seasonalCycle.length) * plotW;
          const yMin = sy(s.min);
          const yMax = sy(s.max);
          const yMean = sy(s.mean);
          return (
            <g key={s.month}>
              <line x1={cx} y1={yMax} x2={cx} y2={yMin} stroke="#334155" strokeWidth="4" strokeLinecap="round" />
              <circle cx={cx} cy={yMean} r={4} fill="#06B6D4" />
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fill="#94A3B8"
                fontSize="10"
                fontFamily="IBM Plex Mono, monospace"
              >
                {s.label}
              </text>
            </g>
          );
        })}
        <text x={padL - 6} y={padT + 8} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {maxV.toFixed(1)}
        </text>
        <text x={padL - 6} y={H - padB} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {minV.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

export function YearOverYearChart({
  yearOverYear,
  units,
}: {
  yearOverYear: YearOverYearPoint[];
  units: string;
}) {
  if (yearOverYear.length < 2) return null;
  const minV = Math.min(...yearOverYear.map((y) => y.mean));
  const maxV = Math.max(...yearOverYear.map((y) => y.mean));
  const pad = (maxV - minV) * 0.1 || 1;
  const lo = minV - pad;
  const hi = maxV + pad;
  const span = hi - lo || 1;

  const W = 540;
  const H = 200;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const barW = Math.max(4, plotW / yearOverYear.length - 3);

  return (
    <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-2">
      <div className="text-xs font-semibold text-slate-100">Annual Mean Progression ({units})</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-[#07090E] border border-slate-800/80 rounded">
        {yearOverYear.map((yr, idx) => {
          const x = padL + (idx / yearOverYear.length) * plotW + 1.5;
          const h = ((yr.mean - lo) / span) * plotH;
          const y = padT + plotH - h;
          const isUp = (yr.deltaFromPrior ?? 0) >= 0;
          return (
            <g key={yr.year}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(2, h)}
                fill={isUp ? '#06B6D4' : '#3B82F6'}
                fillOpacity="0.8"
                rx="1.5"
              >
                <title>{`${yr.year}: ${yr.mean.toFixed(3)} ${units}`}</title>
              </rect>
              {(idx === 0 || idx === yearOverYear.length - 1 || idx % Math.ceil(yearOverYear.length / 5) === 0) && (
                <text
                  x={x + barW / 2}
                  y={H - 10}
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="9"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {yr.year}
                </text>
              )}
            </g>
          );
        })}
        <text x={padL - 6} y={padT + 8} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {hi.toFixed(1)}
        </text>
        <text x={padL - 6} y={H - padB} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {lo.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

export function ComparisonChart({
  comparison,
  units,
  variableLabel,
}: {
  comparison: ComparisonResult;
  units: string;
  variableLabel: string;
}) {
  const obsA = comparison.regionA.observations.filter(
    (o): o is ObservationPoint & { value: number } => o.value !== null
  );
  const obsB = comparison.regionB.observations.filter(
    (o): o is ObservationPoint & { value: number } => o.value !== null
  );

  if (obsA.length < 2 || obsB.length < 2) return null;

  const allX = obsA.map((o) => o.decimalYear).concat(obsB.map((o) => o.decimalYear));
  const allY = obsA.map((o) => o.value).concat(obsB.map((o) => o.value));
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const W = 820;
  const H = 260;
  const padL = 54;
  const padR = 20;
  const padT = 18;
  const padB = 30;
  const sx = (x: number) => padL + ((x - minX) / spanX) * (W - padL - padR);
  const sy = (y: number) => padT + (H - padT - padB) - ((y - minY) / spanY) * (H - padT - padB);

  const pathA = obsA
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.decimalYear).toFixed(1)} ${sy(p.value).toFixed(1)}`)
    .join(' ');
  const pathB = obsB
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.decimalYear).toFixed(1)} ${sy(p.value).toFixed(1)}`)
    .join(' ');

  return (
    <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-100">
          Regional Comparison — {variableLabel} ({units})
        </span>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-cyan-300">
            <span className="w-3 h-0.5 bg-cyan-400 inline-block" />
            {comparison.regionA.region.name}
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" />
            {comparison.regionB.region.name}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-[#07090E] border border-slate-800/80 rounded">
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#334155" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#334155" />
        <path d={pathA} fill="none" stroke="#06B6D4" strokeWidth="1.8" />
        <path d={pathB} fill="none" stroke="#F59E0B" strokeWidth="1.8" />
        <text x={padL - 6} y={padT + 8} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {maxY.toFixed(2)}
        </text>
        <text x={padL - 6} y={H - padB} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {minY.toFixed(2)}
        </text>
        <text x={padL} y={H - 10} fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {obsA[0]?.date}
        </text>
        <text x={W - padR} y={H - 10} textAnchor="end" fill="#94A3B8" fontSize="9" fontFamily="monospace">
          {obsA[obsA.length - 1]?.date}
        </text>
      </svg>
    </div>
  );
}
