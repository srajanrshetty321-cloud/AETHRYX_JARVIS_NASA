import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  FlaskConical,
  Globe2,
  Image as ImageIcon,
  Menu,
  Settings,
  TrendingUp,
  X,
} from 'lucide-react';
import { AethryxEmblem } from './components/AethryxEmblem';
import type { EarthLayerOption } from './components/EarthGlobe3D';
import { AiAssistantView } from './views/AiAssistantView';
import { AnomalyMonitorView } from './views/AnomalyMonitorView';
import { DataLaboratoryView } from './views/DataLaboratoryView';
import { EarthExplorerView } from './views/EarthExplorerView';
import { MissionDashboardView } from './views/MissionDashboardView';
import { NasaImagesView } from './views/NasaImagesView';
import { ReportsHistoryView } from './views/ReportsHistoryView';
import { SettingsView } from './views/SettingsView';
import { TrendDetectiveView } from './views/TrendDetectiveView';
import type {
  AggregationPeriod,
  AnomalyAnalysisResult,
  AssistantMessage,
  DataMode,
  DatasetCatalogEntry,
  DatasetId,
  DatasetStatusReport,
  FullAnalysisBundle,
  GeoRegion,
  SavedAnalysisSummary,
  UserProfile,
} from './types/aethryx';

type NavTab =
  | 'dashboard'
  | 'explorer'
  | 'laboratory'
  | 'trends'
  | 'anomalies'
  | 'assistant'
  | 'images'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof Activity }> = [
  { id: 'dashboard', label: 'Mission Dashboard', icon: Compass },
  { id: 'explorer', label: 'Earth Explorer', icon: Globe2 },
  { id: 'laboratory', label: 'Data Laboratory', icon: FlaskConical },
  { id: 'trends', label: 'Trend Detective', icon: TrendingUp },
  { id: 'anomalies', label: 'Anomaly Monitor', icon: AlertTriangle },
  { id: 'assistant', label: 'AI Assistant', icon: Bot },
  { id: 'images', label: 'NASA Image Explorer', icon: ImageIcon },
  { id: 'reports', label: 'Reports & History', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const DEFAULT_DEMO_REGION: GeoRegion = {
  id: 'preset-shivamogga',
  name: 'Shivamogga, Karnataka, India',
  displayName: 'Shivamogga, Shivamogga district, Karnataka, India',
  lat: 13.9299,
  lon: 75.5681,
  bbox: { south: 13.65, north: 14.25, west: 75.15, east: 75.85 },
  country: 'India',
  regionType: 'city',
  isOcean: false,
};

interface ConversationSummary {
  id: string;
  analysisId?: string;
  title: string;
  messages: AssistantMessage[];
  updatedAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeRegion, setActiveRegion] = useState<GeoRegion>(DEFAULT_DEMO_REGION);
  const [savedRegions, setSavedRegions] = useState<GeoRegion[]>([DEFAULT_DEMO_REGION]);
  const [datasets, setDatasets] = useState<DatasetCatalogEntry[]>([]);
  const [datasetStatuses, setDatasetStatuses] = useState<DatasetStatusReport[]>([]);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [earthLayers, setEarthLayers] = useState<EarthLayerOption[]>([
    {
      id: 'blue-marble',
      label: 'NASA Blue Marble Next Generation',
      gibsLayer: 'BlueMarble_ShadedRelief_Bathymetry',
      source: 'NASA Earth Observatory / GIBS',
      units: 'RGB Reflectance',
      defaultDate: '2004-08-01',
      description: 'Global topography and bathymetry composite.',
    },
  ]);

  const [selectedDatasetId, setSelectedDatasetId] = useState<DatasetId>('NASA-POWER');
  const [selectedVariable, setSelectedVariable] = useState('T2M');
  const [startDate, setStartDate] = useState('2001-01-01');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [aggregation, setAggregation] = useState<AggregationPeriod>('monthly');
  const [dataMode, setDataMode] = useState<DataMode>('LIVE');

  const [activeAnalysis, setActiveAnalysis] = useState<FullAnalysisBundle | null>(null);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [chatMessages, setChatMessages] = useState<AssistantMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);

  const [geminiStatus, setGeminiStatus] = useState<{
    configured: boolean;
    status: string;
    model: string;
  }>({ configured: false, status: 'CHECKING', model: 'gemini-4-hydrogen' });

  const [toast, setToast] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  const showToast = useCallback((text: string, type: 'info' | 'error' = 'info') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const refreshHistoryAndRegions = useCallback(async () => {
    try {
      const [regRes, histRes, convRes] = await Promise.all([
        fetch('/api/regions/saved', { credentials: 'include' }),
        fetch('/api/history', { credentials: 'include' }),
        fetch('/api/conversations', { credentials: 'include' }),
      ]);
      if (regRes.ok) {
        const regJson = await regRes.json();
        if (Array.isArray(regJson.regions) && regJson.regions.length > 0) {
          setSavedRegions(regJson.regions);
        }
      }
      if (histRes.ok) {
        const histJson = await histRes.json();
        setSavedAnalyses(histJson.analyses || []);
      }
      if (convRes.ok) {
        const convJson = await convRes.json();
        setConversations(convJson.conversations || []);
      }
    } catch {
      // handled silently on startup
    }
  }, []);

  const refreshStatuses = useCallback(async () => {
    setStatusesLoading(true);
    try {
      const res = await fetch('/api/datasets/status', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setDatasetStatuses(json.statuses || []);
      }
    } finally {
      setStatusesLoading(false);
    }
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [sessionRes, dsRes, layerRes, healthRes] = await Promise.all([
          fetch('/api/auth/session', { credentials: 'include' }),
          fetch('/api/datasets'),
          fetch('/api/earth/layers'),
          fetch('/api/health'),
        ]);
        if (sessionRes.ok) {
          const sj = await sessionRes.json();
          setUser(sj.user || null);
          if (sj.user?.preferences) {
            setDataMode(sj.user.preferences.defaultDataMode || 'LIVE');
            setAggregation(sj.user.preferences.defaultAggregation || 'monthly');
          }
        }
        if (dsRes.ok) {
          const dj = await dsRes.json();
          setDatasets(dj.datasets || []);
        }
        if (layerRes.ok) {
          const lj = await layerRes.json();
          if (Array.isArray(lj.layers) && lj.layers.length > 0) setEarthLayers(lj.layers);
        }
        if (healthRes.ok) {
          const hj = await healthRes.json();
          if (hj.gemini) setGeminiStatus(hj.gemini);
        }
      } catch {
        // ignore startup transient errors
      }
      await Promise.all([refreshHistoryAndRegions(), refreshStatuses()]);
    }
    bootstrap();
  }, [refreshHistoryAndRegions, refreshStatuses]);

  async function handleSaveRegion(region: GeoRegion) {
    const res = await fetch('/api/regions/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(region),
    });
    if (res.ok) {
      await refreshHistoryAndRegions();
      showToast(`Saved "${region.name}" to regional bookmarks.`);
    } else {
      showToast('Unable to save region.', 'error');
    }
  }

  async function handleDeleteRegion(id: string) {
    const res = await fetch(`/api/regions/saved/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      await refreshHistoryAndRegions();
      showToast('Removed saved region.');
    }
  }

  async function handleOpenAnalysis(id: string) {
    const res = await fetch(`/api/history/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!res.ok) {
      showToast('Unable to load saved investigation.', 'error');
      return;
    }
    const json = await res.json();
    if (json.analysis) {
      const b = json.analysis as FullAnalysisBundle;
      setActiveAnalysis(b);
      setActiveRegion(b.region);
      setSelectedDatasetId(b.provenance.datasetId);
      setSelectedVariable(b.provenance.variable);
      setStartDate(b.provenance.selectedStartDate);
      setEndDate(b.provenance.selectedEndDate);
      setAggregation(b.provenance.aggregation);
      setActiveTab('trends');
    }
  }

  async function handleDeleteAnalysis(id: string) {
    const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      if (activeAnalysis?.id === id) setActiveAnalysis(null);
      await refreshHistoryAndRegions();
      showToast('Deleted saved investigation.');
    }
  }

  async function handleExportReport(format: 'pdf' | 'html' | 'csv', analysisId?: string) {
    try {
      const res = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          analysisId,
          analysis: analysisId ? undefined : activeAnalysis,
          aiSummary: chatMessages.slice().reverse().find((m) => m.role === 'assistant')?.content,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Report export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aethryx-report-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${format.toUpperCase()} scientific report.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    }
  }

  function handleAnalysisComplete(bundle: FullAnalysisBundle) {
    setActiveAnalysis(bundle);
    setActiveRegion(bundle.region);
    refreshHistoryAndRegions();
    showToast(`Completed ${bundle.provenance.datasetId} ${bundle.provenance.variable} analysis for ${bundle.region.name}.`);
  }

  function handleUpdateAnomalies(anomalies: AnomalyAnalysisResult) {
    if (!activeAnalysis) return;
    setActiveAnalysis({ ...activeAnalysis, anomalies });
  }

  const currentNavItem = NAV_ITEMS.find((n) => n.id === activeTab);

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex">
      {/* Desktop Collapsible Left Sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-slate-800/90 bg-[#0A0E17] shrink-0 transition-all duration-200 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className="h-14 px-3.5 border-b border-slate-800/90 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <AethryxEmblem className="w-7 h-7 shrink-0" />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="text-sm font-bold tracking-tight text-slate-50 truncate">AETHRYX JARVIS</div>
                <div className="text-[10px] text-cyan-400 truncate">Your Voice. Earth's Intelligence.</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label="Toggle sidebar"
            className="p-1 text-slate-400 hover:text-slate-100 rounded"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="p-3 border-t border-slate-800/90 text-[11px] text-slate-500 space-y-1">
            <div className="truncate text-slate-300 font-medium">
              {user ? user.displayName : 'Guest Investigator'}
            </div>
            <div className="font-mono text-[10px] truncate">
              {activeRegion.name.split(',')[0]} · {activeRegion.lat.toFixed(2)}°, {activeRegion.lon.toFixed(2)}°
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-64 bg-[#0A0E17] border-r border-slate-800 flex flex-col">
            <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AethryxEmblem className="w-6 h-6" />
                <span className="text-sm font-bold text-slate-100">AETHRYX JARVIS</span>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-xs font-medium ${
                      active ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Stage */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Telemetry Bar */}
        <header className="h-12 px-4 sm:px-6 border-b border-slate-800/90 bg-[#0A0E17]/90 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-1.5 text-slate-300 hover:text-white border border-slate-700 rounded"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs font-semibold text-slate-100 truncate">
              {currentNavItem?.label}
            </div>
            <span className="hidden sm:inline text-slate-700" aria-hidden="true">
              ·
            </span>
            <div className="hidden sm:block text-xs font-mono text-slate-400 truncate">
              {activeRegion.name} ({activeRegion.lat.toFixed(2)}°, {activeRegion.lon.toFixed(2)}°)
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('assistant')}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 rounded hover:bg-cyan-500/20 transition-colors whitespace-nowrap"
            >
              Ask AETHRYX
            </button>
          </div>
        </header>

        {/* Scrollable Workspace */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <MissionDashboardView
              activeRegion={activeRegion}
              datasets={datasets}
              datasetStatuses={datasetStatuses}
              statusesLoading={statusesLoading}
              onRefreshStatuses={refreshStatuses}
              activeAnalysis={activeAnalysis}
              savedAnalyses={savedAnalyses}
              savedRegions={savedRegions}
              geminiStatus={geminiStatus}
              earthLayers={earthLayers}
              dataMode={dataMode}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              onSelectRegion={setActiveRegion}
              onOpenAnalysis={handleOpenAnalysis}
            />
          )}

          {activeTab === 'explorer' && (
            <EarthExplorerView
              activeRegion={activeRegion}
              savedRegions={savedRegions}
              earthLayers={earthLayers}
              onSelectRegion={setActiveRegion}
              onSaveRegion={handleSaveRegion}
              onNavigateToLab={() => setActiveTab('laboratory')}
            />
          )}

          {activeTab === 'laboratory' && (
            <DataLaboratoryView
              activeRegion={activeRegion}
              savedRegions={savedRegions}
              datasets={datasets}
              datasetStatuses={datasetStatuses}
              dataMode={dataMode}
              onChangeDataMode={setDataMode}
              onSelectRegion={setActiveRegion}
              onSaveRegion={handleSaveRegion}
              activeAnalysis={activeAnalysis}
              onAnalysisComplete={handleAnalysisComplete}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              selectedDatasetId={selectedDatasetId}
              selectedVariable={selectedVariable}
              startDate={startDate}
              endDate={endDate}
              aggregation={aggregation}
              onUpdateQueryParams={(patch) => {
                if (patch.datasetId) setSelectedDatasetId(patch.datasetId);
                if (patch.variable) setSelectedVariable(patch.variable);
                if (patch.startDate) setStartDate(patch.startDate);
                if (patch.endDate) setEndDate(patch.endDate);
                if (patch.aggregation) setAggregation(patch.aggregation);
              }}
            />
          )}

          {activeTab === 'trends' && (
            <TrendDetectiveView
              analysis={activeAnalysis}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              onExportReport={(fmt) => handleExportReport(fmt)}
            />
          )}

          {activeTab === 'anomalies' && (
            <AnomalyMonitorView
              analysis={activeAnalysis}
              onUpdateAnomalies={handleUpdateAnomalies}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
            />
          )}

          {activeTab === 'assistant' && (
            <AiAssistantView
              activeRegion={activeRegion}
              activeAnalysis={activeAnalysis}
              dataMode={dataMode}
              geminiStatus={geminiStatus}
              messages={chatMessages}
              conversationId={activeConversationId}
              onUpdateMessages={(msgs, convId) => {
                setChatMessages(msgs);
                if (convId) setActiveConversationId(convId);
                refreshHistoryAndRegions();
              }}
              onSelectRegion={setActiveRegion}
              onAnalysisComplete={handleAnalysisComplete}
            />
          )}

          {activeTab === 'images' && <NasaImagesView />}

          {activeTab === 'reports' && (
            <ReportsHistoryView
              activeAnalysis={activeAnalysis}
              savedAnalyses={savedAnalyses}
              savedRegions={savedRegions}
              conversations={conversations}
              onOpenAnalysis={handleOpenAnalysis}
              onDeleteAnalysis={handleDeleteAnalysis}
              onDeleteRegion={handleDeleteRegion}
              onSelectRegion={(r) => {
                setActiveRegion(r);
                setActiveTab('explorer');
              }}
              onExportReport={handleExportReport}
              onLoadConversation={(msgs, id) => {
                setChatMessages(msgs);
                setActiveConversationId(id);
                setActiveTab('assistant');
              }}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              user={user}
              dataMode={dataMode}
              aggregation={aggregation}
              onAuthChanged={(u) => {
                setUser(u);
                refreshHistoryAndRegions();
                refreshStatuses();
              }}
              onChangeDataMode={setDataMode}
              onChangeAggregation={setAggregation}
            />
          )}
        </main>
      </div>

      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded border text-xs shadow-lg ${
            toast.type === 'error'
              ? 'bg-rose-950/95 border-rose-500 text-rose-100'
              : 'bg-[#0D131F]/95 border-cyan-500/60 text-cyan-100'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
