import { useState } from 'react';
import { ArrowRight, CheckSquare, Layers, Pentagon, Trash2 } from 'lucide-react';
import { EarthGlobe3D, type EarthLayerOption } from '../components/EarthGlobe3D';
import { GlobalRegionBar } from '../components/GlobalRegionBar';
import type { GeoBoundingBox, GeoPoint, GeoRegion } from '../types/aethryx';

interface EarthExplorerViewProps {
  activeRegion: GeoRegion;
  savedRegions: GeoRegion[];
  earthLayers: EarthLayerOption[];
  onSelectRegion: (region: GeoRegion) => void;
  onSaveRegion: (region: GeoRegion) => Promise<void>;
  onNavigateToLab: () => void;
}

export function EarthExplorerView({
  activeRegion,
  savedRegions,
  earthLayers,
  onSelectRegion,
  onSaveRegion,
  onNavigateToLab,
}: EarthExplorerViewProps) {
  const [selectedLayerId, setSelectedLayerId] = useState(earthLayers[0]?.id || 'blue-marble');
  const [selectedDate, setSelectedDate] = useState(earthLayers[0]?.defaultDate || '2004-08-01');
  const [polygonMode, setPolygonMode] = useState(false);
  const [polygonPts, setPolygonPts] = useState<GeoPoint[]>([]);
  const [bboxDraft, setBboxDraft] = useState<GeoBoundingBox>({
    south: activeRegion.bbox?.south ?? Number((activeRegion.lat - 0.5).toFixed(2)),
    north: activeRegion.bbox?.north ?? Number((activeRegion.lat + 0.5).toFixed(2)),
    west: activeRegion.bbox?.west ?? Number((activeRegion.lon - 0.5).toFixed(2)),
    east: activeRegion.bbox?.east ?? Number((activeRegion.lon + 0.5).toFixed(2)),
  });

  const activeLayer = earthLayers.find((l) => l.id === selectedLayerId) || earthLayers[0];

  async function handleGlobeClick(lat: number, lon: number) {
    if (polygonMode) {
      setPolygonPts((prev) => [...prev, { lat, lon }]);
      return;
    }
    const res = await fetch(`/api/regions/reverse?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    if (data.region) {
      onSelectRegion(data.region);
      if (data.region.bbox) setBboxDraft(data.region.bbox);
    }
  }

  async function applyPolygonRegion() {
    if (polygonPts.length < 3) return;
    const res = await fetch('/api/regions/polygon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polygon: polygonPts }),
    });
    const data = await res.json();
    if (data.region) {
      onSelectRegion(data.region);
      setPolygonMode(false);
    }
  }

  function applyCustomBbox() {
    onSelectRegion({
      ...activeRegion,
      bbox: { ...bboxDraft },
      lat: Number(((bboxDraft.south + bboxDraft.north) / 2).toFixed(4)),
      lon: Number(((bboxDraft.west + bboxDraft.east) / 2).toFixed(4)),
    });
  }

  return (
    <div className="space-y-4">
      <GlobalRegionBar
        activeRegion={activeRegion}
        savedRegions={savedRegions}
        onSelectRegion={(r) => {
          onSelectRegion(r);
          if (r.bbox) setBboxDraft(r.bbox);
        }}
        onSaveRegion={onSaveRegion}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 space-y-3">
          <EarthGlobe3D
            activeRegion={activeRegion}
            layers={earthLayers}
            selectedLayerId={selectedLayerId}
            selectedDate={selectedDate}
            drawingPolygon={polygonMode ? polygonPts : undefined}
            customBbox={bboxDraft}
            heightClass="h-[540px]"
            onPickCoordinate={handleGlobeClick}
          />
        </div>

        <div className="lg:col-span-4 space-y-4">
          {/* Layer & Time Controls */}
          <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>NASA GIBS Imagery Layer &amp; Time Control</span>
            </div>

            <div className="space-y-1.5">
              {earthLayers.map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => {
                    setSelectedLayerId(layer.id);
                    setSelectedDate(layer.defaultDate);
                  }}
                  className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                    selectedLayerId === layer.id
                      ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200'
                      : 'bg-[#07090E] border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="font-medium">{layer.label}</div>
                  <div className="text-[11px] text-slate-400">{layer.description}</div>
                </button>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <label className="block text-[11px] text-slate-400">
                Imagery Observation Date
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
              {activeLayer && (
                <div className="text-[11px] text-slate-400 font-mono">
                  Source: {activeLayer.source} · Units: {activeLayer.units}
                </div>
              )}
            </div>
          </div>

          {/* Custom Bounding Box & Polygon Drawing */}
          <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                <Pentagon className="w-4 h-4 text-cyan-400" />
                <span>Custom Area &amp; Polygon Selection</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPolygonMode((v) => !v);
                  setPolygonPts([]);
                }}
                className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
                  polygonMode
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-[#07090E] border-slate-700 text-slate-300'
                }`}
              >
                {polygonMode ? 'Cancel Polygon' : 'Draw Polygon on Globe'}
              </button>
            </div>

            {polygonMode ? (
              <div className="space-y-2 text-xs">
                <p className="text-slate-400 text-[11px]">
                  Click 3 or more vertices directly on the 3D Earth globe ({polygonPts.length} selected).
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={polygonPts.length < 3}
                    onClick={applyPolygonRegion}
                    className="flex-1 px-3 py-1.5 bg-cyan-500 text-slate-950 font-semibold rounded disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Apply Polygon</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPolygonPts([])}
                    className="px-2.5 py-1.5 bg-[#07090E] border border-slate-700 text-slate-300 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <label className="text-slate-400">
                    South Lat
                    <input
                      type="number"
                      step="0.1"
                      value={bboxDraft.south}
                      onChange={(e) => setBboxDraft({ ...bboxDraft, south: Number(e.target.value) })}
                      className="mt-0.5 w-full bg-[#07090E] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400">
                    North Lat
                    <input
                      type="number"
                      step="0.1"
                      value={bboxDraft.north}
                      onChange={(e) => setBboxDraft({ ...bboxDraft, north: Number(e.target.value) })}
                      className="mt-0.5 w-full bg-[#07090E] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400">
                    West Lon
                    <input
                      type="number"
                      step="0.1"
                      value={bboxDraft.west}
                      onChange={(e) => setBboxDraft({ ...bboxDraft, west: Number(e.target.value) })}
                      className="mt-0.5 w-full bg-[#07090E] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </label>
                  <label className="text-slate-400">
                    East Lon
                    <input
                      type="number"
                      step="0.1"
                      value={bboxDraft.east}
                      onChange={(e) => setBboxDraft({ ...bboxDraft, east: Number(e.target.value) })}
                      className="mt-0.5 w-full bg-[#07090E] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={applyCustomBbox}
                  className="w-full px-3 py-1.5 text-xs font-medium bg-[#07090E] border border-slate-700 text-slate-200 rounded hover:border-cyan-500/60"
                >
                  Apply Bounding Box
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onNavigateToLab}
              className="w-full px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <span>Analyze This Region in Data Laboratory</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
