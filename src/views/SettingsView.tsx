import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Database, KeyRound, LogOut, RefreshCw, ShieldCheck, User } from 'lucide-react';
import type { AggregationPeriod, DataMode, UserProfile } from '../types/aethryx';

interface HealthPayload {
  status: string;
  uptimeSeconds: number;
  database: {
    connected: boolean;
    engine: string;
    path: string;
    ephemeralWarning: string | null;
    latencyMs: number;
    counts: Record<string, number>;
  };
  gemini: {
    configured: boolean;
    model: string;
    status: string;
    note: string;
  };
  earthdataServerTokenConfigured: boolean;
}

interface SettingsViewProps {
  user: UserProfile | null;
  dataMode: DataMode;
  aggregation: AggregationPeriod;
  onAuthChanged: (user: UserProfile | null) => void;
  onChangeDataMode: (mode: DataMode) => void;
  onChangeAggregation: (agg: AggregationPeriod) => void;
}

export function SettingsView({
  user,
  dataMode,
  aggregation,
  onAuthChanged,
  onChangeDataMode,
  onChangeAggregation,
}: SettingsViewProps) {
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [earthdataToken, setEarthdataToken] = useState('');
  const [prefSavedMsg, setPrefSavedMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  async function loadHealth() {
    setHealthLoading(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (res.ok) setHealth(data);
    } finally {
      setHealthLoading(false);
    }
  }

  useEffect(() => {
    loadHealth();
  }, []);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const endpoint = authTab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = authTab === 'login' ? { email, password } : { email, password, displayName };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Authentication failed');
      onAuthChanged(json.user);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication error');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    onAuthChanged(null);
  }

  async function handleSavePreferences(e: FormEvent) {
    e.preventDefault();
    setPrefSavedMsg(null);
    const res = await fetch('/api/auth/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        preferences: {
          defaultDataMode: dataMode,
          defaultAggregation: aggregation,
        },
        earthdataToken: earthdataToken.trim() ? earthdataToken.trim() : undefined,
      }),
    });
    const json = await res.json();
    if (res.ok && json.user) {
      onAuthChanged(json.user);
      setEarthdataToken('');
      setPrefSavedMsg('Preferences and encrypted credentials updated in SQLite session store.');
    }
  }

  async function handleClearEarthdataToken() {
    const res = await fetch('/api/auth/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ earthdataToken: null }),
    });
    const json = await res.json();
    if (res.ok && json.user) {
      onAuthChanged(json.user);
      setPrefSavedMsg('Stored Earthdata token removed.');
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Investigator Session & Authentication */}
      <div className="lg:col-span-6 bg-[#0D131F] border border-slate-800 rounded p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <User className="w-4 h-4 text-cyan-400" />
          <span>Investigator Workspace Authentication</span>
        </div>

        {user ? (
          <div className="space-y-4 text-xs">
            <div className="bg-[#07090E] border border-slate-800 rounded p-3.5 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">{user.displayName}</div>
                <div className="text-slate-400 font-mono">{user.email}</div>
                <div className="text-[11px] text-emerald-400 mt-1 inline-flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Persistent HTTP-only session active
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-200 rounded hover:border-rose-500/60 inline-flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>

            <form onSubmit={handleSavePreferences} className="space-y-3 pt-2 border-t border-slate-800">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
                <span>NASA Earthdata Login Bearer Token (Optional)</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Required only for direct GES DISC / LP DAAC OPeNDAP extraction (MERRA-2, GPM IMERG, MODIS,
                AIRS, OMI, GLDAS). Obtain a personal bearer token from{' '}
                <a
                  href="https://urs.earthdata.nasa.gov/user_tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline"
                >
                  urs.earthdata.nasa.gov/user_tokens
                </a>
                . Stored AES-256-GCM encrypted server-side.
              </p>

              <div className="text-[11px] font-mono text-slate-300">
                Status:{' '}
                {user.hasEarthdataToken || health?.earthdataServerTokenConfigured
                  ? '● Earthdata Bearer Token Configured'
                  : '○ Not configured (NASA POWER remains live without login)'}
              </div>

              <input
                type="password"
                value={earthdataToken}
                onChange={(e) => setEarthdataToken(e.target.value)}
                placeholder="Paste NASA Earthdata Bearer Token (optional)"
                className="w-full bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-100"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-500 text-slate-950 font-semibold rounded hover:bg-cyan-400"
                >
                  Save Preferences &amp; Token
                </button>
                {user.hasEarthdataToken && (
                  <button
                    type="button"
                    onClick={handleClearEarthdataToken}
                    className="px-3 py-2 bg-[#07090E] border border-slate-700 text-rose-300 rounded"
                  >
                    Remove Token
                  </button>
                )}
              </div>

              {prefSavedMsg && (
                <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{prefSavedMsg}</span>
                </div>
              )}
            </form>
          </div>
        ) : (
          <form onSubmit={handleAuthSubmit} className="space-y-3 text-xs">
            <div className="inline-flex p-1 bg-[#07090E] border border-slate-800 rounded">
              <button
                type="button"
                onClick={() => setAuthTab('login')}
                className={`px-3 py-1 rounded ${
                  authTab === 'login' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-400'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthTab('register')}
                className={`px-3 py-1 rounded ${
                  authTab === 'register' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-400'
                }`}
              >
                Create Investigator Account
              </button>
            </div>

            {authTab === 'register' && (
              <label className="block text-slate-400">
                Display Name
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Dr. A. Investigator"
                  className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-slate-100"
                />
              </label>
            )}

            <label className="block text-slate-400">
              Email Address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="researcher@example.org"
                className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-slate-100"
              />
            </label>

            <label className="block text-slate-400">
              Password (min 6 characters)
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-3 py-2 text-slate-100"
              />
            </label>

            {authError && (
              <div className="text-rose-300 bg-rose-950/40 border border-rose-500/40 rounded px-3 py-2">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2 bg-cyan-500 text-slate-950 font-semibold rounded hover:bg-cyan-400"
            >
              {authLoading ? 'Authenticating...' : authTab === 'login' ? 'Sign In' : 'Register & Sign In'}
            </button>
          </form>
        )}
      </div>

      {/* Workspace Preferences & Database Diagnostics */}
      <div className="lg:col-span-6 space-y-5">
        <div className="bg-[#0D131F] border border-slate-800 rounded p-5 space-y-3 text-xs">
          <div className="text-sm font-semibold text-slate-100">Data Mode &amp; Default Aggregation</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-slate-400">
              Active Data Mode
              <select
                value={dataMode}
                onChange={(e) => onChangeDataMode(e.target.value as DataMode)}
                className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-2.5 py-2 text-slate-100"
              >
                <option value="LIVE">LIVE NASA DATA (Default)</option>
                <option value="DEMO">DEMO MODE (Simulated Reference)</option>
              </select>
            </label>
            <label className="text-slate-400">
              Default Aggregation
              <select
                value={aggregation}
                onChange={(e) => onChangeAggregation(e.target.value as AggregationPeriod)}
                className="mt-1 w-full bg-[#07090E] border border-slate-700 rounded px-2.5 py-2 text-slate-100"
              >
                <option value="daily">Daily</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          </div>
        </div>

        <div className="bg-[#0D131F] border border-slate-800 rounded p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>System &amp; Database Health</span>
            </div>
            <button
              type="button"
              onClick={loadHealth}
              disabled={healthLoading}
              className="px-2.5 py-1 bg-[#07090E] border border-slate-700 rounded text-slate-300 inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${healthLoading ? 'animate-spin' : ''}`} />
              <span>Test</span>
            </button>
          </div>

          {health && (
            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between text-slate-300">
                <span>Database Engine:</span>
                <span>{health.database.engine}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>DB Query Latency:</span>
                <span className="text-emerald-400">{health.database.latencyMs} ms</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Stored Analyses / Regions:</span>
                <span>
                  {health.database.counts.analyses} analyses · {health.database.counts.savedRegions} regions
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Server Gemini Status:</span>
                <span className={health.gemini.configured ? 'text-emerald-400' : 'text-amber-300'}>
                  {health.gemini.status} ({health.gemini.model})
                </span>
              </div>
              <div className="text-[10px] text-slate-500 pt-1">
                DB Path: {health.database.path}
                {health.database.ephemeralWarning && (
                  <div className="text-amber-400 mt-1">{health.database.ephemeralWarning}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
