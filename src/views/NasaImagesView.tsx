import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Image as ImageIcon, Loader2, Search, X } from 'lucide-react';
import type { NasaImageItem } from '../types/aethryx';

export function NasaImagesView() {
  const [query, setQuery] = useState('Earth observation monsoon satellite');
  const [items, setItems] = useState<NasaImageItem[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NasaImageItem | null>(null);

  async function runSearch(q: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'NASA Images search failed');
      setItems(json.items || []);
      setTotalHits(json.totalHits || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query NASA Image Library');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch(query);
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  const topics = ['Earth observation', 'GPM rainfall', 'MODIS vegetation', 'Terra satellite', 'Amazon basin', 'Himalayas'];

  return (
    <div className="space-y-5">
      <div className="bg-[#0D131F] border border-slate-800 rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">NASA Image &amp; Media Explorer</h2>
            <p className="text-[11px] text-slate-400">
              Live archive search via images-api.nasa.gov · Photographic media only (not quantitative measurements)
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-400">{totalHits.toLocaleString()} archive hits</span>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search NASA missions, Earth phenomena, satellites..."
              className="w-full bg-[#07090E] border border-slate-700 rounded pl-9 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded hover:bg-cyan-400 inline-flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
            <span>Search Archive</span>
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setQuery(t);
                runSearch(t);
              }}
              className="px-2.5 py-1 text-[11px] bg-[#07090E] border border-slate-800 text-slate-300 rounded hover:border-cyan-500/50"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-500/50 rounded p-3 text-xs text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map((item) => (
          <button
            key={item.nasaId}
            type="button"
            onClick={() => setSelected(item)}
            className="text-left bg-[#0D131F] border border-slate-800 rounded overflow-hidden hover:border-cyan-500/60 transition-colors flex flex-col"
          >
            <div className="aspect-[4/3] bg-[#07090E] overflow-hidden flex items-center justify-center">
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-8 h-8 text-slate-700" />
              )}
            </div>
            <div className="p-3 space-y-1 flex-1">
              <div className="text-xs font-semibold text-slate-100 line-clamp-2">{item.title}</div>
              <div className="text-[11px] font-mono text-slate-400">
                {item.center} · {item.dateCreated ? item.dateCreated.slice(0, 10) : 'Archive'}
              </div>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0D131F] border border-slate-700 rounded max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-mono text-cyan-400">
                  NASA ID: {selected.nasaId} · Center: {selected.center}
                </div>
                <h3 className="text-base font-semibold text-slate-100 mt-0.5">{selected.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded border border-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selected.thumbnailUrl && (
              <img
                src={selected.thumbnailUrl}
                alt={selected.title}
                referrerPolicy="no-referrer"
                className="w-full max-h-80 object-contain bg-[#07090E] rounded border border-slate-800"
              />
            )}

            <p className="text-xs text-slate-300 leading-relaxed">{selected.description}</p>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
              <span className="text-slate-400">
                Credit: {selected.photographer || selected.center} · Date:{' '}
                {selected.dateCreated ? selected.dateCreated.slice(0, 10) : 'N/A'}
              </span>
              <a
                href={selected.sourcePageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                <span>Open Official NASA Asset</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
