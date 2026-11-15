import { useState, type FormEvent } from 'react';
import { BookmarkPlus, Compass, Globe2, Loader2, MapPin, Search, Waves } from 'lucide-react';
import type { GeoRegion } from '../types/aethryx';

interface GlobalRegionBarProps {
  activeRegion: GeoRegion;
  savedRegions: GeoRegion[];
  onSelectRegion: (region: GeoRegion) => void;
  onSaveRegion: (region: GeoRegion) => Promise<void>;
}

export function GlobalRegionBar({
  activeRegion,
  savedRegions,
  onSelectRegion,
  onSaveRegion,
}: GlobalRegionBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoRegion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [coordMode, setCoordMode] = useState(false);
  const [latInput, setLatInput] = useState(String(activeRegion.lat));
  const [lonInput, setLonInput] = useState(String(activeRegion.lon));
  const [saving, setSaving] = useState(false);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/regions/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Geocoding search failed');
      setResults(data.regions || []);
      if ((data.regions || []).length === 0) {
        setSearchError('No matching global locations found. Try another city, feature, or "lat, lon".');
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search error');
    } finally {
      setSearching(false);
    }
  }

  async function handleCoordSubmit(e: FormEvent) {
    e.preventDefault();
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setSearchError('Latitude must be [-90, 90] and Longitude must be [-180, 180].');
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/regions/reverse?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reverse geocoding failed');
      if (data.region) {
        onSelectRegion(data.region);
        setResults([]);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Coordinate lookup failed');
    } finally {
      setSearching(false);
    }
  }

  async function handleBookmark() {
    setSaving(true);
    try {
      await onSaveRegion(activeRegion);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {activeRegion.isOcean ? (
            <Waves className="w-4 h-4 text-cyan-400 shrink-0" />
          ) : (
            <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100 truncate">{activeRegion.name}</div>
            <div className="text-xs font-mono tabular-nums text-slate-400 truncate">
              {activeRegion.lat.toFixed(4)}°, {activeRegion.lon.toFixed(4)}°
              <span className="mx-1.5 text-slate-600">·</span>
              {activeRegion.isOcean ? 'Marine / Ocean Zone' : activeRegion.regionType || 'Terrestrial Region'}
              {activeRegion.bbox && (
                <>
                  <span className="mx-1.5 text-slate-600">·</span>
                  Box [{activeRegion.bbox.south.toFixed(2)}, {activeRegion.bbox.west.toFixed(2)}] to [
                  {activeRegion.bbox.north.toFixed(2)}, {activeRegion.bbox.east.toFixed(2)}]
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setCoordMode((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded hover:border-cyan-500/60 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>{coordMode ? 'Search by Name' : 'Enter Coordinates'}</span>
          </button>
          <button
            type="button"
            onClick={handleBookmark}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-950/50 border border-cyan-500/40 rounded hover:bg-cyan-900/50 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Region'}</span>
          </button>
        </div>
      </div>

      {!coordMode ? (
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any city, country, desert, forest, ocean, or coordinates (e.g. London, Amazon, 35.67, 139.65)"
              className="w-full bg-[#07090E] border border-slate-700 rounded pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe2 className="w-3.5 h-3.5" />}
            <span>Resolve Location</span>
          </button>
        </form>
      ) : (
        <form onSubmit={handleCoordSubmit} className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-400 flex items-center gap-1.5">
            <span>Lat</span>
            <input
              type="number"
              step="0.0001"
              min="-90"
              max="90"
              value={latInput}
              onChange={(e) => setLatInput(e.target.value)}
              className="w-28 bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </label>
          <label className="text-xs text-slate-400 flex items-center gap-1.5">
            <span>Lon</span>
            <input
              type="number"
              step="0.0001"
              min="-180"
              max="180"
              value={lonInput}
              onChange={(e) => setLonInput(e.target.value)}
              className="w-28 bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </label>
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0"
          >
            {searching ? 'Resolving...' : 'Go to Coordinate'}
          </button>
        </form>
      )}

      {searchError && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-500/40 rounded px-3 py-2">
          {searchError}
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-[#07090E] border border-slate-800 rounded divide-y divide-slate-800/80 max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={`${r.lat}-${r.lon}-${i}`}
              type="button"
              onClick={() => {
                onSelectRegion(r);
                setResults([]);
                setLatInput(String(r.lat));
                setLonInput(String(r.lon));
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-100 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{r.displayName}</div>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-cyan-400 shrink-0">
                {r.lat.toFixed(3)}°, {r.lon.toFixed(3)}°
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[11px] text-slate-500 mr-1">Global Quick Targets:</span>
        {savedRegions.slice(0, 8).map((r) => {
          const isActive =
            Math.abs(r.lat - activeRegion.lat) < 0.01 && Math.abs(r.lon - activeRegion.lon) < 0.01;
          return (
            <button
              key={r.id || `${r.lat}-${r.lon}`}
              type="button"
              onClick={() => {
                onSelectRegion(r);
                setLatInput(String(r.lat));
                setLonInput(String(r.lon));
              }}
              className={`px-2.5 py-1 text-[11px] rounded border transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-300 font-medium'
                  : 'bg-[#07090E] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {r.name.split(',')[0]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
