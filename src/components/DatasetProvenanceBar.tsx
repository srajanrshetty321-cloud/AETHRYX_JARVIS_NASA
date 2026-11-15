import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { DataProvenance } from '../types/aethryx';

export function DatasetProvenanceBar({ provenance }: { provenance: DataProvenance }) {
  const isDemo = provenance.dataMode === 'DEMO';

  return (
    <div className="space-y-2">
      {isDemo && (
        <div className="flex items-start gap-3 px-4 py-2.5 bg-amber-950/60 border border-amber-500/60 rounded text-amber-200 text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-300">DEMO / SIMULATED MODE ACTIVE:</span>{' '}
            These figures are deterministic illustrative demo sequences, not live NASA observations. Switch to Live Data Mode with NASA POWER or an Earthdata token for authentic measurements.
          </div>
        </div>
      )}

      <div className="bg-[#0D131F] border border-slate-800 rounded px-4 py-3 text-xs text-slate-300">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`font-mono font-semibold ${
                isDemo ? 'text-amber-400' : 'text-cyan-400'
              }`}
            >
              {isDemo ? '● SIMULATED DEMO' : '● LIVE NASA DATA'}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold text-slate-100">{provenance.officialDatasetName}</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-slate-400">{provenance.productId}</span>
          </div>

          <a
            href={provenance.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Official NASA Source</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1.5 pt-2 text-[11px] text-slate-400">
          <div>
            <span className="text-slate-500">Source:</span> {provenance.nasaSource}
          </div>
          <div>
            <span className="text-slate-500">Variable:</span>{' '}
            <span className="text-slate-200">{provenance.variableName}</span> ({provenance.units})
          </div>
          <div>
            <span className="text-slate-500">Coverage:</span>{' '}
            <span className="font-mono tabular-nums text-slate-200">
              {provenance.actualStartDate || provenance.selectedStartDate} →{' '}
              {provenance.actualEndDate || provenance.selectedEndDate}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Samples:</span>{' '}
            <span className="font-mono tabular-nums text-slate-200">
              {provenance.validObservationCount} valid / {provenance.missingDataCount} missing
            </span>
          </div>
          <div className="sm:col-span-2">
            <span className="text-slate-500">Spatial Method:</span> {provenance.spatialAveragingMethod} ({provenance.spatialResolution})
          </div>
          <div className="sm:col-span-2 font-mono tabular-nums">
            <span className="text-slate-500 font-sans">Retrieved:</span>{' '}
            {new Date(provenance.retrievalTimestamp).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
