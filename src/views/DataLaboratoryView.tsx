import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  GitCompare,
  Loader2,
  Play,
  ShieldAlert,
} from 'lucide-react';
import { DatasetProvenanceBar } from '../components/DatasetProvenanceBar';
import { GlobalRegionBar } from '../components/GlobalRegionBar';
import { ComparisonChart } from '../components/ScienceCharts';
import type {
  AggregationPeriod,
  ComparisonResult,
  DataMode,
  DatasetCatalogEntry,
  DatasetId,
  DatasetStatusReport,
  FullAnalysisBundle,
  GeoRegion,
} from '../types/aethryx';

interface DataLaboratoryViewProps {
  activeRegion: GeoRegion;
  savedRegions: GeoRegion[];
  datasets: DatasetCatalogEntry[];
  datasetStatuses: DatasetStatusReport[];
  dataMode: DataMode;
  onChangeDataMode: (mode: DataMode) => void;
  onSelectRegion: (region: GeoRegion) => void;
  onSaveRegion: (region: GeoRegion) => Promise<void>;
  activeAnalysis: FullAnalysisBundle | null;
  onAnalysisComplete: (bundle: FullAnalysisBundle) => void;
  onNavigate: (tab: string) => void;
  selectedDatasetId: DatasetId;
  selectedVariable: string;
  startDate: string;
  endDate: string;
  aggregation: AggregationPeriod;
  onUpdateQueryParams: (patch: {
    datasetId?: DatasetId;
    variable?: string;
    startDate?: string;
    endDate?: string;
    aggregation?: AggregationPeriod;
  }) => void;
}

export function DataLaboratoryView({
  activeRegion,
  savedRegions,
  datasets,
  datasetStatuses,
  dataMode,
  onChangeDataMode,
  onSelectRegion,
  onSaveRegion,
  activeAnalysis,
  onAnalysisComplete,
  onNavigate,
  selectedDatasetId,
  selectedVariable,
  startDate,
  endDate,
  aggregation,
  onUpdateQueryParams,
}: DataLaboratoryViewProps) {
  const [subTab, setSubTab] = useState<'single' | 'compare'>('single');
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authNeeded, setAuthNeeded] = useState(false);

  // Regional comparison state
  const [compareRegionB, setCompareRegionB] = useState<GeoRegion>(
    () =>
      savedRegions.find((r) => Math.abs(r.lat - activeRegion.lat) > 1) || {
        name: 'London, United Kingdom',
        displayName: 'London, Greater London, England, United Kingdom',
        lat: 51.5074,
        lon: -0.1278,
        country: 'United Kingdom',
      }
  );
  const [compareSearchQuery, setCompareSearchQuery] = useState('');
  const [compareSearchResults, setCompareSearchResults] = useState<GeoRegion[]>([]);
  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const activeDataset = datasets.find((d) => d.id === selectedDatasetId) || datasets[0];
  const activeVariable =
    activeDataset?.variables.find((v) => v.id === selectedVariable) || activeDataset?.variables[0];
  const activeStatus = datasetStatuses.find((s) => s.id === selectedDatasetId);

  const [coverageCheck, setCoverageCheck] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>({ valid: true, errors: [], warnings: [] });

  useEffect(() => {
    if (!activeDataset) return;
    if (!activeDataset.variables.some((v) => v.id === selectedVariable)) {
      onUpdateQueryParams({ variable: activeDataset.variables[0].id });
    }
  }, [activeDataset, selectedVariable, onUpdateQueryParams]);

  useEffect(() => {
    if (activeVariable && !activeVariable.supportedAggregations.includes(aggregation)) {
      onUpdateQueryParams({ aggregation: activeVariable.supportedAggregations[0] });
    }
  }, [activeVariable, aggregation, onUpdateQueryParams]);

  useEffect(() => {
    let cancelled = false;
    async function validate() {
      try {
        const res = await fetch('/api/datasets/validate-coverage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            datasetId: selectedDatasetId,
            region: activeRegion,
            startDate,
            endDate,
          }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) {
          setCoverageCheck(data);
        }
      } catch {
        // ignore transient validation network check
      }
    }
    validate();
    return () => {
      cancelled = true;
    };
  }, [selectedDatasetId, activeRegion, startDate, endDate]);

  async function runInvestigation(overrideMode?: DataMode, overrideDatasetId?: DatasetId) {
    const modeToUse = overrideMode || dataMode;
    const dsToUse = overrideDatasetId || selectedDatasetId;
    const dsObj = datasets.find((d) => d.id === dsToUse) || activeDataset;
    const varToUse =
      overrideDatasetId && dsObj && !dsObj.variables.some((v) => v.id === selectedVariable)
        ? dsObj.variables[0].id
        : selectedVariable;

    if (overrideMode) onChangeDataMode(overrideMode);
    if (overrideDatasetId) onUpdateQueryParams({ datasetId: overrideDatasetId, variable: varToUse });

    setRunning(true);
    setErrorMsg(null);
    setAuthNeeded(false);
    setProgressText(`Validating ${dsToUse} coverage and retrieving observations for ${activeRegion.name}...`);

    try {
      const res = await fetch('/api/analysis/full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: dsToUse,
          variable: varToUse,
          region: activeRegion,
          startDate,
          endDate,
          aggregation,
          dataMode: modeToUse,
          saveToHistory: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401 || json.code === 'EARTHDATA_AUTH_REQUIRED') {
          setAuthNeeded(true);
        }
        throw new Error(json.error || 'Data retrieval failed');
      }
      onAnalysisComplete(json.analysis);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Investigation failed');
    } finally {
      setRunning(false);
      setProgressText('');
    }
  }

  async function handleCompareSearch() {
    if (!compareSearchQuery.trim()) return;
    const res = await fetch(`/api/regions/search?q=${encodeURIComponent(compareSearchQuery.trim())}`);
    const data = await res.json();
    setCompareSearchResults(data.regions || []);
  }

  async function handleRunComparison() {
    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch('/api/analysis/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regionA: activeRegion,
          regionB: compareRegionB,
          datasetId: selectedDatasetId,
          variable: selectedVariable,
          startDate,
          endDate,
          aggregation,
          dataMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Comparison failed');
      setComparisonResult(data.comparison);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Comparison error');
    } finally {
      setComparing(false);
    }
  }

  return (
    <div className="space-y-5">
      <GlobalRegionBar
        activeRegion={activeRegion}
        savedRegions={savedRegions}
        onSelectRegion={onSelectRegion}
        onSaveRegion={onSaveRegion}
      />

      {/* Mode Switch Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-[#0D131F] border border-slate-800 rounded">
          <button
            type="button"
            onClick={() => setSubTab('single')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              subTab === 'single' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            Single Region Retrieval
          </button>
          <button
            type="button"
            onClick={() => setSubTab('compare')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5 ${
              subTab === 'compare' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>Global Region Comparison</span>
          </button>
        </div>

        <div className="inline-flex p-1 bg-[#0D131F] border border-slate-800 rounded text-xs">
          <button
            type="button"
            onClick={() => onChangeDataMode('LIVE')}
            className={`px-3 py-1 rounded transition-colors font-mono ${
              dataMode === 'LIVE' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-400'
            }`}
          >
            LIVE NASA DATA
          </button>
          <button
            type="button"
            onClick={() => onChangeDataMode('DEMO')}
            className={`px-3 py-1 rounded transition-colors font-mono ${
              dataMode === 'DEMO' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400'
            }`}
          >
            DEMO MODE
          </button>
        </div>
      </div>

      {/* Parameter Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-[#0D131F] border border-slate-800 rounded p-4 space-y-4">
          <div className="text-xs font-semibold text-slate-100">NASA Dataset &amp; Query Parameters</div>

          <div className="space-y-3 text-xs">
            <label className="block text-slate-400">
              NASA Dataset
              <select
                value={selectedDatasetId}
                onChange={(e) => onUpdateQueryParams({ datasetId: e.target.value as DatasetId })}
                className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id} — {d.productId} ({d.authRequiredForData ? 'Earthdata Auth' : 'Public Live'})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-slate-400">
              Environmental Variable
              <select
                value={selectedVariable}
                onChange={(e) => onUpdateQueryParams({ variable: e.target.value })}
                className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                {activeDataset?.variables.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.id}) [{v.units}]
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-slate-400">
                Start Date
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => onUpdateQueryParams({ startDate: e.target.value })}
                  className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-2.5 py-2 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
              <label className="block text-slate-400">
                End Date
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => onUpdateQueryParams({ endDate: e.target.value })}
                  className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-2.5 py-2 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
            </div>

            <div>
              <div className="text-slate-400 mb-1">Temporal Aggregation</div>
              <div className="flex gap-2">
                {(['daily', 'monthly', 'yearly'] as AggregationPeriod[]).map((agg) => {
                  const supported = activeVariable?.supportedAggregations.includes(agg);
                  return (
                    <button
                      key={agg}
                      type="button"
                      disabled={!supported}
                      onClick={() => onUpdateQueryParams({ aggregation: agg })}
                      className={`flex-1 py-1.5 rounded border capitalize font-mono text-[11px] transition-colors ${
                        aggregation === agg
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-semibold'
                          : 'bg-[#07090E] border-slate-800 text-slate-400 disabled:opacity-30'
                      }`}
                    >
                      {agg}
                    </button>
                  );
                })}
              </div>
            </div>

            {subTab === 'compare' && (
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-amber-300">
                  Comparison Target (Region B): {compareRegionB.name}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={compareSearchQuery}
                    onChange={(e) => setCompareSearchQuery(e.target.value)}
                    placeholder="Search Region B (e.g. Sahara, Tokyo, London)"
                    className="flex-1 bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleCompareSearch}
                    className="px-3 py-1.5 bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
                  >
                    Find
                  </button>
                </div>
                {compareSearchResults.length > 0 && (
                  <div className="bg-[#07090E] border border-slate-800 rounded divide-y divide-slate-800 max-h-32 overflow-y-auto">
                    {compareSearchResults.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setCompareRegionB(r);
                          setCompareSearchResults([]);
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-slate-800/60 flex justify-between"
                      >
                        <span className="truncate">{r.name}</span>
                        <span className="font-mono text-cyan-400">
                          {r.lat.toFixed(2)}, {r.lon.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!coverageCheck.valid && (
              <div className="bg-rose-950/50 border border-rose-500/50 rounded p-3 text-rose-200 text-[11px] space-y-1">
                {coverageCheck.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            {coverageCheck.warnings.map((w, i) => (
              <div
                key={i}
                className="bg-amber-950/40 border border-amber-500/40 rounded p-2.5 text-amber-200 text-[11px]"
              >
                {w}
              </div>
            ))}

            {subTab === 'single' ? (
              <button
                type="button"
                disabled={running || !coverageCheck.valid}
                onClick={() => runInvestigation()}
                className="w-full py-2.5 px-4 bg-cyan-500 text-slate-950 font-semibold rounded hover:bg-cyan-400 transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>{running ? 'Retrieving & Computing...' : 'Retrieve NASA Data & Analyze Trends'}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={comparing || !coverageCheck.valid}
                onClick={handleRunComparison}
                className="w-full py-2.5 px-4 bg-amber-500 text-slate-950 font-semibold rounded hover:bg-amber-400 transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {comparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                <span>{comparing ? 'Comparing Regions...' : 'Compare Regions Side-by-Side'}</span>
              </button>
            )}

            {progressText && (
              <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/30 border border-cyan-500/30 rounded px-3 py-2">
                {progressText}
              </div>
            )}
          </div>
        </div>

        {/* Dataset Integrity Metadata Card */}
        <div className="lg:col-span-7 bg-[#0D131F] border border-slate-800 rounded p-4 space-y-4">
          {activeDataset && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-800">
                <div>
                  <div className="text-[11px] font-mono text-cyan-400">
                    VERIFIED NASA PRODUCT METADATA · {activeDataset.productId}
                  </div>
                  <h2 className="text-base font-semibold text-slate-100">{activeDataset.officialName}</h2>
                </div>
                <a
                  href={activeDataset.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                >
                  <span>Official Docs</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#07090E] border border-slate-800/80 rounded p-3">
                  <div className="text-[11px] text-slate-500">NASA Source &amp; Endpoint</div>
                  <div className="text-slate-200 font-medium mt-0.5">{activeDataset.nasaSource}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate mt-1">
                    {activeDataset.apiEndpoint}
                  </div>
                </div>
                <div className="bg-[#07090E] border border-slate-800/80 rounded p-3">
                  <div className="text-[11px] text-slate-500">Spatial &amp; Temporal Resolution</div>
                  <div className="text-slate-200 font-mono mt-0.5">{activeDataset.spatialResolution}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{activeDataset.temporalResolution}</div>
                </div>
                <div className="bg-[#07090E] border border-slate-800/80 rounded p-3">
                  <div className="text-[11px] text-slate-500">Historical Coverage &amp; Lat Bounds</div>
                  <div className="text-slate-200 font-mono mt-0.5">
                    {activeDataset.historicalStart} → {activeDataset.historicalEnd}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Lat [{activeDataset.latBounds[0]}°, {activeDataset.latBounds[1]}°] ·{' '}
                    {activeDataset.landOnly ? 'Terrestrial Land Only' : 'Global Land + Ocean'}
                  </div>
                </div>
                <div className="bg-[#07090E] border border-slate-800/80 rounded p-3">
                  <div className="text-[11px] text-slate-500">Authentication &amp; Live Status</div>
                  <div className="text-slate-200 mt-0.5">{activeDataset.authMethod}</div>
                  <div className="text-[11px] font-mono text-cyan-400 mt-0.5">
                    {activeStatus?.reason || 'Status ready'}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-300 bg-[#07090E] border border-slate-800/80 rounded p-3">
                <span className="font-semibold text-slate-200">Processing &amp; Missing-Data Handling:</span>{' '}
                {activeDataset.processingNotes}
              </div>
            </>
          )}

          {errorMsg && (
            <div className="bg-rose-950/40 border border-rose-500/50 rounded p-4 space-y-3 text-xs text-rose-100">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-rose-300">
                    {authNeeded ? 'NASA Earthdata Authentication Required' : 'Data Retrieval Notice'}
                  </div>
                  <p className="mt-1 text-rose-200/90 leading-relaxed">{errorMsg}</p>
                </div>
              </div>

              {authNeeded && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => runInvestigation('LIVE', 'NASA-POWER')}
                    className="px-3 py-1.5 bg-cyan-500 text-slate-950 font-semibold rounded hover:bg-cyan-400 transition-colors"
                  >
                    Retrieve Live NASA POWER Instead
                  </button>
                  <button
                    type="button"
                    onClick={() => runInvestigation('DEMO')}
                    className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/60 text-amber-200 font-medium rounded hover:bg-amber-500/30 transition-colors"
                  >
                    View Labelled Demo Example ({selectedDatasetId})
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('settings')}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-200 rounded hover:border-cyan-500/50"
                  >
                    Configure Earthdata Token
                  </button>
                </div>
              )}
            </div>
          )}

          {compareError && (
            <div className="bg-rose-950/40 border border-rose-500/50 rounded p-3 text-xs text-rose-200">
              {compareError}
            </div>
          )}
        </div>
      </div>

      {/* Results Summary */}
      {subTab === 'single' && activeAnalysis && (
        <div className="space-y-4">
          <DatasetProvenanceBar provenance={activeAnalysis.provenance} />
          <div className="bg-[#0D131F] border border-slate-800 rounded p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-mono text-cyan-400">
                STATISTICAL ANALYSIS READY · {activeAnalysis.trend.classification}
              </div>
              <div className="text-sm font-semibold text-slate-100">
                {activeAnalysis.trend.classificationExplanation}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onNavigate('trends')}
                className="px-3.5 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 inline-flex items-center gap-1.5"
              >
                <span>Open Trend Detective</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('anomalies')}
                className="px-3.5 py-2 text-xs font-medium bg-[#07090E] border border-slate-700 text-slate-200 rounded hover:border-cyan-500/60"
              >
                Inspect Anomalies ({activeAnalysis.anomalies.anomalyCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {subTab === 'compare' && comparisonResult && (
        <div className="space-y-4">
          {!comparisonResult.compatible ? (
            <div className="bg-rose-950/40 border border-rose-500/50 rounded p-4 text-xs text-rose-200">
              {comparisonResult.incompatibilityReason}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#0D131F] border border-slate-800 rounded p-4">
                  <div className="text-[11px] text-cyan-400 font-mono">REGION A</div>
                  <div className="text-sm font-semibold text-slate-100 truncate">
                    {comparisonResult.regionA.region.name}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-300 mt-2">
                    Mean: {comparisonResult.regionA.mean.toFixed(3)} {activeVariable?.units}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-400">
                    Sen's Slope: {comparisonResult.regionA.slopePerYear.toFixed(5)} / yr (p=
                    {comparisonResult.regionA.pValue.toFixed(4)})
                  </div>
                </div>

                <div className="bg-[#0D131F] border border-slate-800 rounded p-4">
                  <div className="text-[11px] text-amber-400 font-mono">REGION B</div>
                  <div className="text-sm font-semibold text-slate-100 truncate">
                    {comparisonResult.regionB.region.name}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-300 mt-2">
                    Mean: {comparisonResult.regionB.mean.toFixed(3)} {activeVariable?.units}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-400">
                    Sen's Slope: {comparisonResult.regionB.slopePerYear.toFixed(5)} / yr (p=
                    {comparisonResult.regionB.pValue.toFixed(4)})
                  </div>
                </div>

                <div className="bg-[#0D131F] border border-slate-800 rounded p-4">
                  <div className="text-[11px] text-slate-400 font-mono">CROSS-REGIONAL METRICS</div>
                  <div className="text-xs font-mono tabular-nums text-slate-200 mt-2">
                    Δ Mean (A − B): {comparisonResult.meanDifference >= 0 ? '+' : ''}
                    {comparisonResult.meanDifference.toFixed(3)} {activeVariable?.units}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-300 mt-1">
                    Pearson r ({comparisonResult.overlappingPoints} overlap):{' '}
                    {comparisonResult.pearsonCorrelation !== null
                      ? comparisonResult.pearsonCorrelation.toFixed(4)
                      : 'N/A'}
                  </div>
                </div>
              </div>

              <ComparisonChart
                comparison={comparisonResult}
                units={activeVariable?.units || ''}
                variableLabel={activeVariable?.name || selectedVariable}
              />

              <div className="text-[11px] text-slate-400 bg-[#0D131F] border border-slate-800 rounded p-3">
                {comparisonResult.caveats.join(' ')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
