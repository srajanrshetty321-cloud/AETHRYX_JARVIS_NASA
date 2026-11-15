import { useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { DatasetProvenanceBar } from '../components/DatasetProvenanceBar';
import { TimeSeriesTrendChart } from '../components/ScienceCharts';
import type { AnomalyAnalysisResult, AnomalyMethod, FullAnalysisBundle } from '../types/aethryx';

interface AnomalyMonitorViewProps {
  analysis: FullAnalysisBundle | null;
  onUpdateAnomalies: (anomalies: AnomalyAnalysisResult) => void;
  onNavigate: (tab: string) => void;
}

export function AnomalyMonitorView({
  analysis,
  onUpdateAnomalies,
  onNavigate,
}: AnomalyMonitorViewProps) {
  const [method, setMethod] = useState<AnomalyMethod>(analysis?.anomalies.method || 'SEASONAL_DEVIATION');
  const [threshold, setThreshold] = useState<number>(analysis?.anomalies.threshold || 2.0);
  const [recomputing, setRecomputing] = useState(false);

  if (!analysis) {
    return (
      <div className="bg-[#0D131F] border border-slate-800 rounded p-8 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
        <h2 className="text-base font-semibold text-slate-100">No Dataset Loaded for Anomaly Detection</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Retrieve a NASA time-series in Data Laboratory to evaluate Z-score, Tukey IQR, seasonal climatology
          deviations, and moving-average spikes.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('laboratory')}
          className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 inline-flex items-center gap-1.5"
        >
          <span>Open Data Laboratory</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  async function recompute(nextMethod: AnomalyMethod, nextThreshold: number) {
    if (!analysis) return;
    setRecomputing(true);
    try {
      const res = await fetch('/api/analysis/anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observations: analysis.observations,
          method: nextMethod,
          threshold: nextThreshold,
        }),
      });
      const data = await res.json();
      if (res.ok && data.anomalies) {
        onUpdateAnomalies(data.anomalies);
      }
    } finally {
      setRecomputing(false);
    }
  }

  const { anomalies, provenance, region, observations, trend } = analysis;

  return (
    <div className="space-y-5">
      <DatasetProvenanceBar provenance={provenance} />

      <div className="bg-[#0D131F] border border-slate-800 rounded p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="text-slate-400 flex items-center gap-2">
            <span>Detection Method</span>
            <select
              value={method}
              onChange={(e) => {
                const m = e.target.value as AnomalyMethod;
                setMethod(m);
                recompute(m, threshold);
              }}
              className="bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            >
              <option value="SEASONAL_DEVIATION">Seasonal Climatology Deviation</option>
              <option value="Z_SCORE">Global Z-Score</option>
              <option value="IQR">Tukey Interquartile Range (IQR)</option>
              <option value="MOVING_AVERAGE">Local Moving-Average Deviation</option>
            </select>
          </label>

          <label className="text-slate-400 flex items-center gap-2">
            <span>Threshold ({threshold.toFixed(1)}σ)</span>
            <input
              type="range"
              min="1.5"
              max="3.5"
              step="0.1"
              value={threshold}
              disabled={method === 'IQR'}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="accent-cyan-400"
            />
          </label>

          <button
            type="button"
            onClick={() => recompute(method, threshold)}
            disabled={recomputing}
            className="px-3 py-1.5 bg-cyan-500 text-slate-950 font-semibold rounded hover:bg-cyan-400 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`} />
            <span>Re-Evaluate</span>
          </button>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-300">
          {anomalies.anomalyCount} flagged out of {anomalies.totalChecked} valid observations
        </div>
      </div>

      <TimeSeriesTrendChart
        observations={observations}
        trend={trend}
        anomalies={anomalies.anomalies}
        variableLabel={provenance.variableName}
        units={provenance.units}
        regionName={region.name}
        sourceLabel={`${provenance.nasaSource} (${provenance.productId})`}
        dateRange={`${provenance.actualStartDate || provenance.selectedStartDate} to ${
          provenance.actualEndDate || provenance.selectedEndDate
        }`}
        isDemo={provenance.dataMode === 'DEMO'}
      />

      <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Detected Anomalies Log</h2>
          <span className="text-[11px] text-slate-400">
            Baseline Mean: {anomalies.baselineMean} {provenance.units} · SD: {anomalies.baselineStdDev}
          </span>
        </div>

        {anomalies.anomalies.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded">
            No observations exceeded the {anomalies.threshold}σ threshold under {anomalies.method}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Observed</th>
                  <th className="py-2 pr-3">Expected Baseline</th>
                  <th className="py-2 pr-3">Deviation</th>
                  <th className="py-2 pr-3">Z-Score</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2">Statistical Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {anomalies.anomalies.map((a) => (
                  <tr key={a.date} className="hover:bg-slate-800/30">
                    <td className="py-2 pr-3 font-mono text-slate-200">{a.date}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-cyan-300">
                      {a.observed.toFixed(3)} {provenance.units}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-slate-300">
                      {a.expectedBaseline.toFixed(3)} {provenance.units}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-slate-200">
                      {a.deviation >= 0 ? '+' : ''}
                      {a.deviation.toFixed(3)}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-amber-300">
                      {a.zScore.toFixed(2)}σ
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px]">
                      <span
                        className={
                          a.severity === 'EXTREME'
                            ? 'text-rose-400 font-semibold'
                            : a.severity === 'ELEVATED'
                              ? 'text-amber-400'
                              : 'text-slate-300'
                        }
                      >
                        {a.severity}
                      </span>
                    </td>
                    <td className="py-2 text-slate-300">{a.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-[11px] text-slate-500 pt-1">{anomalies.limitations.join(' ')}</div>
      </div>
    </div>
  );
}
