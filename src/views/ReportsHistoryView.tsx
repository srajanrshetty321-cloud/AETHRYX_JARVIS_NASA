import { Download, FileCode, FileSpreadsheet, FileText, FolderOpen, Trash2 } from 'lucide-react';
import type { AssistantMessage, FullAnalysisBundle, GeoRegion, SavedAnalysisSummary } from '../types/aethryx';

interface ConversationSummary {
  id: string;
  analysisId?: string;
  title: string;
  messages: AssistantMessage[];
  updatedAt: string;
}

interface ReportsHistoryViewProps {
  activeAnalysis: FullAnalysisBundle | null;
  savedAnalyses: SavedAnalysisSummary[];
  savedRegions: GeoRegion[];
  conversations: ConversationSummary[];
  onOpenAnalysis: (id: string) => void;
  onDeleteAnalysis: (id: string) => Promise<void>;
  onDeleteRegion: (id: string) => Promise<void>;
  onSelectRegion: (region: GeoRegion) => void;
  onExportReport: (format: 'pdf' | 'html' | 'csv', analysisId?: string) => void;
  onLoadConversation: (msgs: AssistantMessage[], id: string) => void;
}

export function ReportsHistoryView({
  activeAnalysis,
  savedAnalyses,
  savedRegions,
  conversations,
  onOpenAnalysis,
  onDeleteAnalysis,
  onDeleteRegion,
  onSelectRegion,
  onExportReport,
  onLoadConversation,
}: ReportsHistoryViewProps) {
  return (
    <div className="space-y-6">
      {/* Active Investigation Export Panel */}
      <div className="bg-[#0D131F] border border-slate-800 rounded p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-mono text-cyan-400">SCIENTIFIC DOSSIER EXPORT</div>
            <h2 className="text-base font-semibold text-slate-100">
              {activeAnalysis
                ? `${activeAnalysis.region.name} — ${activeAnalysis.provenance.variableName}`
                : 'Select or Run an Investigation to Export'}
            </h2>
            <p className="text-xs text-slate-400">
              Downloads include official NASA product IDs, source URLs, retrieval timestamps, statistical tests,
              vector charts, anomalies, methodology, and reproducibility metadata.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!activeAnalysis}
              onClick={() => onExportReport('pdf')}
              className="px-3.5 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              disabled={!activeAnalysis}
              onClick={() => onExportReport('html')}
              className="px-3.5 py-2 text-xs font-medium bg-[#07090E] border border-slate-700 text-slate-200 rounded hover:border-cyan-500/60 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Download HTML</span>
            </button>
            <button
              type="button"
              disabled={!activeAnalysis}
              onClick={() => onExportReport('csv')}
              className="px-3.5 py-2 text-xs font-medium bg-[#07090E] border border-slate-700 text-slate-200 rounded hover:border-cyan-500/60 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Download CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Saved Investigations Table */}
      <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Saved Trend Investigations</h3>
          <span className="text-xs font-mono text-slate-400">{savedAnalyses.length} stored</span>
        </div>

        {savedAnalyses.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded">
            No investigations saved yet. Analyses executed in Data Laboratory are automatically persisted here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3">Region</th>
                  <th className="py-2 pr-3">Dataset &amp; Variable</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Trend Verdict</th>
                  <th className="py-2 pr-3">Slope / yr</th>
                  <th className="py-2 pr-3">Saved At</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {savedAnalyses.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3 font-medium text-slate-100">{item.regionName}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-300">
                      {item.datasetId} · {item.variable} ({item.dataMode})
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-400">
                      {item.startDate} → {item.endDate}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-cyan-300">{item.classification}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-200">
                      {item.slopePerYear.toFixed(4)} {item.units}/yr
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenAnalysis(item.id)}
                        title="Open analysis"
                        className="px-2 py-1 bg-[#07090E] border border-slate-700 rounded text-cyan-300 hover:border-cyan-500 inline-flex items-center gap-1"
                      >
                        <FolderOpen className="w-3 h-3" />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onExportReport('pdf', item.id)}
                        title="Download PDF"
                        className="px-2 py-1 bg-[#07090E] border border-slate-700 rounded text-slate-300 hover:border-cyan-500 inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAnalysis(item.id)}
                        title="Delete analysis"
                        className="p-1 bg-[#07090E] border border-slate-700 rounded text-rose-400 hover:border-rose-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Saved Regions & AI Conversation History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">Favourite Regions</h3>
          <div className="divide-y divide-slate-800/70">
            {savedRegions.map((r) => (
              <div key={r.id || r.name} className="py-2 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onSelectRegion(r)}
                  className="text-left hover:text-cyan-300 min-w-0"
                >
                  <div className="font-medium text-slate-200 truncate">{r.name}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {r.lat.toFixed(3)}°, {r.lon.toFixed(3)}°
                  </div>
                </button>
                {r.id && !r.id.startsWith('preset-') && (
                  <button
                    type="button"
                    onClick={() => onDeleteRegion(r.id!)}
                    className="p-1 text-rose-400 hover:text-rose-300"
                    title="Delete saved region"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">AI Investigation Transcripts</h3>
          {conversations.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">No saved AI conversations yet.</div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onLoadConversation(c.messages, c.id)}
                  className="w-full text-left py-2.5 hover:bg-slate-800/40 px-2 rounded flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 truncate">{c.title}</div>
                    <div className="text-[11px] text-slate-500">{c.messages.length} messages</div>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 shrink-0">
                    {new Date(c.updatedAt).toLocaleDateString()}
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
