import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Globe2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { EarthGlobe3D, type EarthLayerOption } from '../components/EarthGlobe3D';
import type {
  DataMode,
  DatasetCatalogEntry,
  DatasetStatusReport,
  FullAnalysisBundle,
  GeoRegion,
  SavedAnalysisSummary,
} from '../types/aethryx';

interface SnapshotMetric {
  label: string;
  variable: string;
  value: string | null;
  units: string;
  date: string | null;
  source: string;
  unavailableReason?: string;
}

interface MissionDashboardViewProps {
  activeRegion: GeoRegion;
  datasets: DatasetCatalogEntry[];
  datasetStatuses: DatasetStatusReport[];
  statusesLoading: boolean;
  onRefreshStatuses: () => void;
  activeAnalysis: FullAnalysisBundle | null;
  savedAnalyses: SavedAnalysisSummary[];
  savedRegions: GeoRegion[];
  geminiStatus: { configured: boolean; status: string; model: string };
  earthLayers: EarthLayerOption[];
  dataMode: DataMode;
  onNavigate: (tab: string) => void;
  onSelectRegion: (region: GeoRegion) => void;
  onOpenAnalysis: (id: string) => void;
}

export function MissionDashboardView({
  activeRegion,
  datasets,
  datasetStatuses,
  statusesLoading,
  onRefreshStatuses,
  activeAnalysis,
  savedAnalyses,
  savedRegions,
  geminiStatus,
  earthLayers,
  dataMode,
  onNavigate,
  onSelectRegion,
  onOpenAnalysis,
}: MissionDashboardViewProps) {
  const [utcClock, setUtcClock] = useState(() => new Date().toISOString().replace('T', ' ').slice(0, 19));
  const [selectedLayerId, setSelectedLayerId] = useState(earthLayers[0]?.id || 'blue-marble');
  const [envCards, setEnvCards] = useState<SnapshotMetric[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setUtcClock(new Date().toISOString().replace('T', ' ').slice(0, 19));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch real latest NASA POWER measurements for the 5 supported overview cards + MODIS Vegetation honest availability
  useEffect(() => {
    let cancelled = false;
    async function loadRegionalSnapshot() {
      setCardsLoading(true);
      const end = new Date();
      const start = new Date(end.getTime() - 45 * 24 * 60 * 60 * 1000);
      const startIso = start.toISOString().slice(0, 10);
      const endIso = end.toISOString().slice(0, 10);

      const specs: Array<{
        label: string;
        variable: string;
        units: string;
        datasetId: 'NASA-POWER' | 'MODIS';
      }> = [
        { label: 'Temperature (2m)', variable: 'T2M', units: '°C', datasetId: 'NASA-POWER' },
        { label: 'Precipitation', variable: 'PRECTOTCORR', units: 'mm/day', datasetId: 'NASA-POWER' },
        { label: 'Vegetation (NDVI)', variable: 'NDVI', units: 'index', datasetId: 'MODIS' },
        { label: 'Atmospheric Humidity', variable: 'RH2M', units: '%', datasetId: 'NASA-POWER' },
        { label: 'Wind Speed (2m)', variable: 'WS2M', units: 'm/s', datasetId: 'NASA-POWER' },
        { label: 'Land Surface Wetness', variable: 'GWETTOP', units: 'fraction', datasetId: 'NASA-POWER' },
      ];

      const results = await Promise.all(
        specs.map(async (sp): Promise<SnapshotMetric> => {
          if (sp.datasetId === 'MODIS' && dataMode === 'LIVE') {
            return {
              label: sp.label,
              variable: sp.variable,
              value: null,
              units: sp.units,
              date: null,
              source: 'MODIS MOD13Q1.061 (LP DAAC)',
              unavailableReason: activeRegion.isOcean
                ? 'Data currently unavailable (terrestrial land-only product)'
                : 'Data currently unavailable (requires Earthdata token or Demo mode)',
            };
          }
          try {
            const res = await fetch('/api/data/retrieve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                datasetId: sp.datasetId,
                variable: sp.variable,
                region: activeRegion,
                startDate: startIso,
                endDate: endIso,
                aggregation: sp.datasetId === 'MODIS' ? 'monthly' : 'daily',
                dataMode,
              }),
            });
            const json = await res.json();
            if (!res.ok) {
              return {
                label: sp.label,
                variable: sp.variable,
                value: null,
                units: sp.units,
                date: null,
                source: sp.datasetId,
                unavailableReason: 'Data currently unavailable',
              };
            }
            const obs = (json.observations || []) as Array<{ date: string; value: number | null }>;
            const latest = obs.slice().reverse().find((o) => o.value !== null);
            if (!latest || latest.value === null) {
              return {
                label: sp.label,
                variable: sp.variable,
                value: null,
                units: sp.units,
                date: null,
                source: json.provenance?.productId || sp.datasetId,
                unavailableReason: 'Data currently unavailable',
              };
            }
            return {
              label: sp.label,
              variable: sp.variable,
              value: latest.value.toFixed(2),
              units: sp.units,
              date: latest.date,
              source:
                dataMode === 'DEMO'
                  ? `${json.provenance?.productId} (DEMO)`
                  : `NASA POWER (${json.provenance?.productId})`,
            };
          } catch {
            return {
              label: sp.label,
              variable: sp.variable,
              value: null,
              units: sp.units,
              date: null,
              source: sp.datasetId,
              unavailableReason: 'Data currently unavailable',
            };
          }
        })
      );

      if (!cancelled) {
        setEnvCards(results);
        setCardsLoading(false);
      }
    }

    loadRegionalSnapshot();
    return () => {
      cancelled = true;
    };
  }, [activeRegion, dataMode]);

  const liveCount = datasetStatuses.filter((s) => s.connectorStatus === 'LIVE').length;

  return (
    <div className="space-y-6">
      {/* Top Hero Header */}
      <div className="bg-[#0D131F] border border-slate-800 rounded p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-mono text-cyan-400">
            NASA SPACE APPS CHALLENGE 2026 · BE AN EARTH SYSTEM TREND DETECTIVE
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-50 tracking-tight">
            AETHRYX JARVIS Mission Control
          </h1>
          <p className="text-xs text-slate-400">
            Active Target: <span className="text-slate-100 font-medium">{activeRegion.name}</span>{' '}
            <span className="font-mono tabular-nums text-slate-500">
              ({activeRegion.lat.toFixed(3)}°, {activeRegion.lon.toFixed(3)}°)
            </span>
            <span className="mx-2 text-slate-700">·</span>
            Mode:{' '}
            <span className={dataMode === 'DEMO' ? 'text-amber-400 font-mono' : 'text-cyan-400 font-mono'}>
              {dataMode === 'DEMO' ? 'DEMO SIMULATION' : 'LIVE NASA DATA'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-[#07090E] border border-slate-800 rounded px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center justify-end gap-1">
              <Clock className="w-3 h-3" />
              <span>Mission UTC Clock</span>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-100">{utcClock} UTC</div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('laboratory')}
            className="px-4 py-2.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
          >
            <span>Run Trend Analysis</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Key Mission Telemetry Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>NASA Connectors</span>
            <Database className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
            {liveCount} / {datasets.length} <span className="text-xs font-normal text-slate-400">direct live</span>
          </div>
          <div className="text-[11px] text-slate-400">
            {datasetStatuses.filter((s) => s.metadataStatus === 'LIVE').length} metadata CMR verified
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>AI Science Engine</span>
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-mono font-semibold text-slate-100 truncate">
            {geminiStatus.configured ? 'Gemini 4 Live' : 'Grounded Fallback'}
          </div>
          <div className="text-[11px] text-slate-400 truncate">{geminiStatus.model}</div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Active Variable</span>
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-semibold text-slate-100 truncate">
            {activeAnalysis ? activeAnalysis.provenance.variableName : 'No Investigation Loaded'}
          </div>
          <div className="text-[11px] font-mono text-slate-400 truncate">
            {activeAnalysis
              ? `${activeAnalysis.trend.classification} (p=${activeAnalysis.trend.mannKendall.pValue.toFixed(4)})`
              : 'Select dataset in Data Laboratory'}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Saved Investigations</span>
            <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
            {savedAnalyses.length}
            <span className="text-xs font-normal text-slate-400 ml-2">
              · {savedRegions.length} regions
            </span>
          </div>
          <div className="text-[11px] text-slate-400">Persisted in SQLite archive</div>
        </div>
      </div>

      {/* Main Split: Centerpiece 3D Earth Globe + Environmental Overview Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Interactive 3D Earth Telemetry Globe</h2>
            <div className="flex items-center gap-2">
              <select
                value={selectedLayerId}
                onChange={(e) => setSelectedLayerId(e.target.value)}
                aria-label="Select NASA GIBS Globe Layer"
                className="bg-[#07090E] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {earthLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onNavigate('explorer')}
                className="px-2.5 py-1 text-xs text-cyan-400 hover:text-cyan-300 border border-slate-700 rounded whitespace-nowrap"
              >
                Full Explorer
              </button>
            </div>
          </div>

          <EarthGlobe3D
            activeRegion={activeRegion}
            layers={earthLayers}
            selectedLayerId={selectedLayerId}
            selectedDate={earthLayers.find((l) => l.id === selectedLayerId)?.defaultDate || '2004-08-01'}
            heightClass="h-[380px]"
            compact
            onPickCoordinate={async (lat, lon) => {
              const res = await fetch(`/api/regions/reverse?lat=${lat}&lon=${lon}`);
              const data = await res.json();
              if (data.region) onSelectRegion(data.region);
            }}
          />
        </div>

        {/* 6 Environmental Overview Cards */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Latest Regional Observations ({activeRegion.name.split(',')[0]})
            </h2>
            {cardsLoading && <span className="text-[11px] font-mono text-cyan-400">Querying NASA...</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {envCards.map((card) => (
              <div key={card.variable} className="bg-[#0D131F] border border-slate-800 rounded p-3.5 space-y-1">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">{card.label}</div>
                {card.value !== null ? (
                  <>
                    <div className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
                      {card.value}
                      <span className="text-xs font-normal text-slate-400 ml-1.5">{card.units}</span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 truncate">
                      {card.date} · {card.source}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-medium text-slate-400 py-1.5">
                      {card.unavailableReason || 'Data currently unavailable.'}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 truncate">{card.source}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* NASA Dataset Connectors Status Matrix + Recent Analyses */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">NASA Dataset Connector Telemetry</h2>
              <p className="text-[11px] text-slate-400">
                Live independent verification against NASA POWER, CMR, and AppEEARS endpoints
              </p>
            </div>
            <button
              type="button"
              onClick={onRefreshStatuses}
              disabled={statusesLoading}
              className="px-3 py-1.5 text-xs text-slate-300 bg-[#07090E] border border-slate-700 rounded hover:border-cyan-500/60 hover:text-cyan-300 transition-colors inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statusesLoading ? 'animate-spin' : ''}`} />
              <span>Verify Connectors</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3 font-medium">Dataset</th>
                  <th className="py-2 pr-3 font-medium">Product ID</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {datasetStatuses.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-100">{s.id}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[230px]">{s.nasaSource}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-300">{s.productId}</td>
                    <td className="py-2.5 pr-3">
                      {s.connectorStatus === 'LIVE' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> LIVE DATA
                        </span>
                      ) : s.connectorStatus === 'METADATA_ONLY_AUTH_REQUIRED' ? (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-mono text-[11px]">
                          <ShieldAlert className="w-3.5 h-3.5" /> CMR LIVE · TOKEN NEEDED
                        </span>
                      ) : (
                        <span className="text-rose-400 font-mono text-[11px]">UNAVAILABLE</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-slate-400">
                      {s.latencyMs} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Recent Investigations</h2>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              View Archive
            </button>
          </div>

          {savedAnalyses.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded">
              No saved trend investigations yet. Run your first analysis in Data Laboratory or ask AETHRYX by voice.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {savedAnalyses.slice(0, 5).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onOpenAnalysis(a.id)}
                  className="w-full text-left py-2.5 hover:bg-slate-800/40 px-2 rounded transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate">
                      {a.regionName} · {a.variable}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {a.datasetId} · {a.startDate} → {a.endDate} · {a.dataMode}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-[11px] font-mono font-semibold ${
                        a.classification === 'INCREASING'
                          ? 'text-amber-400'
                          : a.classification === 'DECREASING'
                            ? 'text-cyan-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {a.classification}
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-500">
                      p = {a.pValue.toFixed(4)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
