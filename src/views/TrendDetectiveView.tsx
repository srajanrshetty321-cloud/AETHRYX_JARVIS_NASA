import { useState } from 'react';
import { ArrowRight, BarChart3, Download, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { DatasetProvenanceBar } from '../components/DatasetProvenanceBar';
import {
  SeasonalCycleChart,
  TimeSeriesTrendChart,
  YearOverYearChart,
} from '../components/ScienceCharts';
import type { FullAnalysisBundle } from '../types/aethryx';

interface TrendDetectiveViewProps {
  analysis: FullAnalysisBundle | null;
  onNavigate: (tab: string) => void;
  onExportReport: (format: 'pdf' | 'html' | 'csv') => void;
}

export function TrendDetectiveView({
  analysis,
  onNavigate,
  onExportReport,
}: TrendDetectiveViewProps) {
  const [showForecast, setShowForecast] = useState(false);

  if (!analysis) {
    return (
      <div className="bg-[#0D131F] border border-slate-800 rounded p-8 text-center space-y-3">
        <BarChart3 className="w-8 h-8 text-cyan-400 mx-auto" />
        <h2 className="text-base font-semibold text-slate-100">No Trend Investigation Loaded</h2>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Retrieve NASA Earth observations in the Data Laboratory first to compute OLS linear regression,
          Mann-Kendall significance, Sen's slope, seasonal cycles, and confidence intervals.
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

  const { region, provenance, observations, trend, anomalies, forecast } = analysis;

  return (
    <div className="space-y-5">
      <DatasetProvenanceBar provenance={provenance} />

      {/* Classification Banner */}
      <div className="bg-[#0D131F] border border-slate-800 rounded p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="flex items-center gap-2">
            {trend.classification === 'INCREASING' ? (
              <TrendingUp className="w-4 h-4 text-amber-400" />
            ) : trend.classification === 'DECREASING' ? (
              <TrendingDown className="w-4 h-4 text-cyan-400" />
            ) : (
              <Info className="w-4 h-4 text-slate-400" />
            )}
            <span className="text-xs font-mono font-semibold text-cyan-300">
              TREND VERDICT (α = {trend.alpha}): {trend.classification}
            </span>
          </div>
          <p className="text-sm text-slate-100">{trend.classificationExplanation}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {forecast.available && (
            <button
              type="button"
              onClick={() => setShowForecast((v) => !v)}
              className={`px-3 py-1.5 text-xs rounded border font-medium transition-colors ${
                showForecast
                  ? 'bg-violet-500/20 border-violet-500 text-violet-200'
                  : 'bg-[#07090E] border-slate-700 text-slate-300 hover:border-violet-500/60'
              }`}
            >
              {showForecast ? 'Hide Estimate Forecast' : 'Overlay Forecast Estimate'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onExportReport('pdf')}
            className="px-3 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* Primary Time Series + OLS Regression + CI95 + Optional Forecast */}
      <TimeSeriesTrendChart
        observations={observations}
        trend={trend}
        anomalies={anomalies.anomalies}
        forecast={forecast}
        showForecast={showForecast}
        variableLabel={provenance.variableName}
        units={provenance.units}
        regionName={region.name}
        sourceLabel={`${provenance.nasaSource} (${provenance.productId})`}
        dateRange={`${provenance.actualStartDate || provenance.selectedStartDate} to ${
          provenance.actualEndDate || provenance.selectedEndDate
        }`}
        isDemo={provenance.dataMode === 'DEMO'}
      />

      {/* Statistical Diagnostics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Sen's Slope (Non-Parametric)</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
            {trend.sensSlope.slopePerYear >= 0 ? '+' : ''}
            {trend.sensSlope.slopePerYear.toFixed(4)}
            <span className="text-xs font-normal text-slate-400 ml-1">{provenance.units}/yr</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400">
            95% CI: [{trend.sensSlope.ci95LowPerYear.toFixed(4)}, {trend.sensSlope.ci95HighPerYear.toFixed(4)}]
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Mann-Kendall Rank Test</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
            p = {trend.mannKendall.pValue.toFixed(4)}
            <span className="text-xs font-normal text-slate-400 ml-2">
              {trend.mannKendall.significant ? 'Significant' : 'Not Sig.'}
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400">
            S = {trend.mannKendall.sStatistic} · Z = {trend.mannKendall.zStatistic.toFixed(3)} · τ ={' '}
            {trend.mannKendall.tau.toFixed(3)}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">OLS Linear Regression</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
            {trend.linearRegression.slopePerYear >= 0 ? '+' : ''}
            {trend.linearRegression.slopePerYear.toFixed(4)}
            <span className="text-xs font-normal text-slate-400 ml-1">{provenance.units}/yr</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400">
            R² = {trend.linearRegression.rSquared.toFixed(4)} · t = {trend.linearRegression.tStatistic.toFixed(2)} ·
            p = {trend.linearRegression.pValue.toFixed(4)}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Distribution Summary</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
            {trend.summary.mean.toFixed(3)}
            <span className="text-xs font-normal text-slate-400 ml-1">{provenance.units} mean</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400">
            Min {trend.summary.min.toFixed(2)} · Med {trend.summary.median.toFixed(2)} · Max{' '}
            {trend.summary.max.toFixed(2)} · SD {trend.summary.stdDev.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Seasonal & Annual Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SeasonalCycleChart seasonalCycle={trend.seasonalCycle} units={provenance.units} />
        <YearOverYearChart yearOverYear={trend.yearOverYear} units={provenance.units} />
      </div>

      {/* Forecasting & Validation + Seasonal Mann-Kendall + Methodology */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-slate-100">Forecasting &amp; Holdout Validation</div>
          {forecast.available && forecast.validationMetrics ? (
            <>
              <div className="text-amber-300 font-mono text-[11px]">{forecast.uncertaintyNote}</div>
              <div className="grid grid-cols-3 gap-2 font-mono tabular-nums pt-1">
                <div className="bg-[#07090E] border border-slate-800 rounded p-2">
                  <div className="text-[10px] text-slate-500">Holdout RMSE</div>
                  <div className="text-slate-100">
                    {forecast.validationMetrics.rmse} {provenance.units}
                  </div>
                </div>
                <div className="bg-[#07090E] border border-slate-800 rounded p-2">
                  <div className="text-[10px] text-slate-500">Holdout MAE</div>
                  <div className="text-slate-100">
                    {forecast.validationMetrics.mae} {provenance.units}
                  </div>
                </div>
                <div className="bg-[#07090E] border border-slate-800 rounded p-2">
                  <div className="text-[10px] text-slate-500">Horizon Steps</div>
                  <div className="text-slate-100">{forecast.horizonSteps} steps</div>
                </div>
              </div>
              <ul className="list-disc pl-4 text-slate-400 space-y-1 pt-1">
                {forecast.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-slate-400">{forecast.reasonIfUnavailable}</div>
          )}
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-slate-100">Methodology, Seasonality &amp; Limitations</div>
          <div className="font-mono text-[11px] text-cyan-300">
            Seasonal Mann-Kendall:{' '}
            {trend.seasonalMannKendall.applicable
              ? `S = ${trend.seasonalMannKendall.sStatistic}, Z = ${trend.seasonalMannKendall.zStatistic.toFixed(
                  3
                )}, p = ${trend.seasonalMannKendall.pValue.toFixed(4)} (${
                  trend.seasonalMannKendall.significant ? 'Significant' : 'Not Sig.'
                })`
              : trend.seasonalMannKendall.note}
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Lag-1 Residual Autocorrelation r₁ = {trend.autocorrelationLag1.toFixed(4)}
          </div>
          <ul className="list-disc pl-4 text-slate-400 space-y-1">
            {trend.limitations.map((lim, i) => (
              <li key={i}>{lim}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
