import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AssistantMessage,
  FullAnalysisBundle,
  GeoRegion,
  SavedAnalysisSummary,
  UserProfile,
} from '../src/types/aethryx.ts';

const DEFAULT_SECRET = crypto
  .createHash('sha256')
  .update(process.env.SESSION_SECRET || `${process.cwd()}-aethryx-jarvis-session-key`)
  .digest();

let dbInstance: DatabaseSync | null = null;
let activeDbPath = '';

function resolveDbPath(): string {
  const configured = process.env.DB_PATH || path.join(process.cwd(), 'data', 'aethryx.db');
  const dir = path.dirname(configured);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return configured;
  } catch {
    const tmpPath = path.join('/tmp', 'aethryx-jarvis.db');
    return tmpPath;
  }
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  activeDbPath = resolveDbPath();
  const db = new DatabaseSync(activeDbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'investigator',
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      preferences_json TEXT NOT NULL,
      earthdata_token_enc TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_regions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      bbox_json TEXT,
      polygon_json TEXT,
      country TEXT,
      region_type TEXT,
      is_ocean INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      region_name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      dataset_id TEXT NOT NULL,
      variable TEXT NOT NULL,
      units TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      data_mode TEXT NOT NULL,
      classification TEXT NOT NULL,
      slope_per_year REAL NOT NULL,
      p_value REAL NOT NULL,
      bundle_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      analysis_id TEXT,
      title TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  seedDefaultRegions(db);
  dbInstance = db;
  return db;
}

function seedDefaultRegions(db: DatabaseSync) {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM saved_regions WHERE user_id IS NULL').get() as {
    cnt: number;
  };
  if (countRow.cnt > 0) return;

  const initialBookmarks: Array<GeoRegion & { id: string }> = [
    {
      id: 'preset-shivamogga',
      name: 'Shivamogga, Karnataka, India',
      displayName: 'Shivamogga, Shivamogga district, Karnataka, India (Demo Default)',
      lat: 13.9299,
      lon: 75.5681,
      bbox: { south: 13.65, north: 14.25, west: 75.15, east: 75.85 },
      country: 'India',
      regionType: 'city',
      isOcean: false,
    },
    {
      id: 'preset-new-york',
      name: 'New York, United States',
      displayName: 'New York, United States',
      lat: 40.7128,
      lon: -74.006,
      bbox: { south: 40.47, north: 40.92, west: -74.26, east: -73.7 },
      country: 'United States',
      regionType: 'metropolis',
      isOcean: false,
    },
    {
      id: 'preset-london',
      name: 'London, United Kingdom',
      displayName: 'London, Greater London, England, United Kingdom',
      lat: 51.5074,
      lon: -0.1278,
      bbox: { south: 51.28, north: 51.69, west: -0.51, east: 0.33 },
      country: 'United Kingdom',
      regionType: 'city',
      isOcean: false,
    },
    {
      id: 'preset-tokyo',
      name: 'Tokyo, Japan',
      displayName: 'Tokyo, Kanto, Japan',
      lat: 35.6762,
      lon: 139.6503,
      bbox: { south: 35.5, north: 35.82, west: 139.5, east: 139.92 },
      country: 'Japan',
      regionType: 'metropolis',
      isOcean: false,
    },
    {
      id: 'preset-amazon',
      name: 'Amazon Rainforest (Manaus Basin), Brazil',
      displayName: 'Manaus, Amazonas, Brazil',
      lat: -3.119,
      lon: -60.0217,
      bbox: { south: -4.2, north: -2.0, west: -61.5, east: -58.5 },
      country: 'Brazil',
      regionType: 'rainforest',
      isOcean: false,
    },
    {
      id: 'preset-sahara',
      name: 'Sahara Desert (Tamanrasset), Algeria',
      displayName: 'Tamanrasset, Sahara, Algeria',
      lat: 22.785,
      lon: 5.5228,
      bbox: { south: 21.5, north: 24.0, west: 4.0, east: 7.0 },
      country: 'Algeria',
      regionType: 'desert',
      isOcean: false,
    },
  ];

  const insert = db.prepare(`
    INSERT INTO saved_regions (id, user_id, name, display_name, lat, lon, bbox_json, polygon_json, country, region_type, is_ocean, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const r of initialBookmarks) {
    insert.run(
      r.id,
      r.name,
      r.displayName,
      r.lat,
      r.lon,
      JSON.stringify(r.bbox ?? null),
      r.country ?? null,
      r.regionType ?? null,
      r.isOcean ? 1 : 0,
      now
    );
  }
}

export function getDbInfo() {
  const db = getDb();
  const start = performance.now();
  const counts = {
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c,
    sessions: (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c,
    savedRegions: (db.prepare('SELECT COUNT(*) as c FROM saved_regions').get() as { c: number }).c,
    analyses: (db.prepare('SELECT COUNT(*) as c FROM analyses').get() as { c: number }).c,
    conversations: (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }).c,
  };
  const latencyMs = Number((performance.now() - start).toFixed(2));
  const isEphemeral = activeDbPath.startsWith('/tmp');
  return {
    connected: true,
    engine: 'SQLite (Node 22 native WAL)',
    path: activeDbPath,
    ephemeralWarning: isEphemeral
      ? 'Running with /tmp storage; configure persistent volume or external DB for stateless serverless hosting.'
      : null,
    latencyMs,
    counts,
  };
}

// --- Encryption helpers for optional NASA Earthdata Bearer Token ---
function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DEFAULT_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    if (!ivHex || !tagHex || !encHex) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', DEFAULT_SECRET, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// --- Auth & User Profiles ---
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
}

const DEFAULT_PREFERENCES: UserProfile['preferences'] = {
  speechRate: 1.0,
  autoSpeakResponses: true,
  defaultDataMode: 'LIVE',
  defaultAggregation: 'monthly',
};

function rowToUserProfile(row: Record<string, unknown>): UserProfile {
  let prefs = DEFAULT_PREFERENCES;
  try {
    prefs = { ...DEFAULT_PREFERENCES, ...JSON.parse(String(row.preferences_json || '{}')) };
  } catch {
    prefs = DEFAULT_PREFERENCES;
  }
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    role: String(row.role),
    hasEarthdataToken: Boolean(row.earthdata_token_enc),
    preferences: prefs,
    createdAt: String(row.created_at),
  };
}

export function registerUser(email: string, password: string, displayName: string): UserProfile {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    throw new Error('An investigator account with this email already exists.');
  }
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, display_name, role, password_hash, salt, preferences_json, created_at)
     VALUES (?, ?, ?, 'investigator', ?, ?, ?, ?)`
  ).run(id, normalizedEmail, displayName.trim(), passwordHash, salt, JSON.stringify(DEFAULT_PREFERENCES), now);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToUserProfile(row);
}

export function authenticateUser(email: string, password: string): UserProfile | null {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const candidate = hashPassword(password, String(row.salt));
  const stored = String(row.password_hash);
  if (!crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(stored, 'hex'))) {
    return null;
  }
  return rowToUserProfile(row);
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const db = getDb();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const sig = crypto.createHmac('sha256', DEFAULT_SECRET).update(rawToken).digest('hex');
  const token = `${rawToken}.${sig}`;
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    expires,
    now.toISOString()
  );
  return { token, expiresAt: expires };
}

export function getUserBySessionToken(token: string | undefined | null): {
  user: UserProfile;
  earthdataToken: string | null;
} | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [raw, sig] = parts;
  const expected = crypto.createHmac('sha256', DEFAULT_SECRET).update(raw).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return {
    user: rowToUserProfile(row),
    earthdataToken: decryptSecret(row.earthdata_token_enc as string | null),
  };
}

export function deleteSession(token: string) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function updateUserPreferences(
  userId: string,
  preferences: Partial<UserProfile['preferences']>,
  earthdataToken?: string | null
): UserProfile {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  if (!row) throw new Error('User not found');
  const current = rowToUserProfile(row);
  const merged = { ...current.preferences, ...preferences };

  if (earthdataToken !== undefined) {
    const enc = earthdataToken && earthdataToken.trim().length > 0 ? encryptSecret(earthdataToken.trim()) : null;
    db.prepare('UPDATE users SET preferences_json = ?, earthdata_token_enc = ? WHERE id = ?').run(
      JSON.stringify(merged),
      enc,
      userId
    );
  } else {
    db.prepare('UPDATE users SET preferences_json = ? WHERE id = ?').run(JSON.stringify(merged), userId);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  return rowToUserProfile(updated);
}

// --- Saved Regions ---
export function listSavedRegions(userId: string | null): GeoRegion[] {
  const db = getDb();
  const rows = userId
    ? (db
        .prepare(
          'SELECT * FROM saved_regions WHERE user_id IS NULL OR user_id = ? ORDER BY user_id DESC, created_at DESC'
        )
        .all(userId) as Array<Record<string, unknown>>)
    : (db
        .prepare('SELECT * FROM saved_regions WHERE user_id IS NULL ORDER BY created_at ASC')
        .all() as Array<Record<string, unknown>>);

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    displayName: String(r.display_name),
    lat: Number(r.lat),
    lon: Number(r.lon),
    bbox: r.bbox_json ? JSON.parse(String(r.bbox_json)) : undefined,
    polygon: r.polygon_json ? JSON.parse(String(r.polygon_json)) : undefined,
    country: r.country ? String(r.country) : undefined,
    regionType: r.region_type ? String(r.region_type) : undefined,
    isOcean: Boolean(r.is_ocean),
  }));
}

export function saveRegion(region: GeoRegion, userId: string | null): GeoRegion {
  const db = getDb();
  const id = region.id && !region.id.startsWith('preset-') ? region.id : crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO saved_regions (id, user_id, name, display_name, lat, lon, bbox_json, polygon_json, country, region_type, is_ocean, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    region.name,
    region.displayName,
    region.lat,
    region.lon,
    JSON.stringify(region.bbox ?? null),
    JSON.stringify(region.polygon ?? null),
    region.country ?? null,
    region.regionType ?? null,
    region.isOcean ? 1 : 0,
    now
  );
  return { ...region, id };
}

export function deleteSavedRegion(id: string, userId: string | null): boolean {
  const db = getDb();
  if (id.startsWith('preset-')) return false;
  const info = userId
    ? db.prepare('DELETE FROM saved_regions WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
    : db.prepare('DELETE FROM saved_regions WHERE id = ? AND user_id IS NULL').run(id);
  return info.changes > 0;
}

// --- Saved Analyses ---
export function saveAnalysis(bundle: FullAnalysisBundle, userId: string | null): SavedAnalysisSummary & { id: string } {
  const db = getDb();
  const id = bundle.id || crypto.randomUUID();
  const now = bundle.createdAt || new Date().toISOString();
  const payload: FullAnalysisBundle = { ...bundle, id, createdAt: now };

  db.prepare(
    `INSERT OR REPLACE INTO analyses (id, user_id, region_name, lat, lon, dataset_id, variable, units, start_date, end_date, data_mode, classification, slope_per_year, p_value, bundle_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    bundle.region.name,
    bundle.region.lat,
    bundle.region.lon,
    bundle.provenance.datasetId,
    bundle.provenance.variable,
    bundle.provenance.units,
    bundle.provenance.selectedStartDate,
    bundle.provenance.selectedEndDate,
    bundle.provenance.dataMode,
    bundle.trend.classification,
    bundle.trend.linearRegression.slopePerYear,
    bundle.trend.mannKendall.pValue,
    JSON.stringify(payload),
    now
  );

  return {
    id,
    regionName: bundle.region.name,
    lat: bundle.region.lat,
    lon: bundle.region.lon,
    datasetId: bundle.provenance.datasetId,
    variable: bundle.provenance.variable,
    units: bundle.provenance.units,
    startDate: bundle.provenance.selectedStartDate,
    endDate: bundle.provenance.selectedEndDate,
    dataMode: bundle.provenance.dataMode,
    classification: bundle.trend.classification,
    slopePerYear: bundle.trend.linearRegression.slopePerYear,
    pValue: bundle.trend.mannKendall.pValue,
    createdAt: now,
  };
}

export function listAnalyses(userId: string | null, limit = 30): SavedAnalysisSummary[] {
  const db = getDb();
  const rows = userId
    ? (db
        .prepare(
          `SELECT id, region_name, lat, lon, dataset_id, variable, units, start_date, end_date, data_mode, classification, slope_per_year, p_value, created_at
           FROM analyses WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, limit) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT id, region_name, lat, lon, dataset_id, variable, units, start_date, end_date, data_mode, classification, slope_per_year, p_value, created_at
           FROM analyses WHERE user_id IS NULL ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as Array<Record<string, unknown>>);

  return rows.map((r) => ({
    id: String(r.id),
    regionName: String(r.region_name),
    lat: Number(r.lat),
    lon: Number(r.lon),
    datasetId: String(r.dataset_id) as SavedAnalysisSummary['datasetId'],
    variable: String(r.variable),
    units: String(r.units),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    dataMode: String(r.data_mode) as SavedAnalysisSummary['dataMode'],
    classification: String(r.classification) as SavedAnalysisSummary['classification'],
    slopePerYear: Number(r.slope_per_year),
    pValue: Number(r.p_value),
    createdAt: String(r.created_at),
  }));
}

export function getAnalysisById(id: string): FullAnalysisBundle | null {
  const db = getDb();
  const row = db.prepare('SELECT bundle_json FROM analyses WHERE id = ?').get(id) as
    | { bundle_json: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.bundle_json) as FullAnalysisBundle;
}

export function deleteAnalysis(id: string, userId: string | null): boolean {
  const db = getDb();
  const info = userId
    ? db.prepare('DELETE FROM analyses WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
    : db.prepare('DELETE FROM analyses WHERE id = ? AND user_id IS NULL').run(id);
  return info.changes > 0;
}

// --- Conversation History ---
export function saveConversation(
  id: string | undefined,
  userId: string | null,
  analysisId: string | undefined,
  title: string,
  messages: AssistantMessage[]
): string {
  const db = getDb();
  const convId = id || crypto.randomUUID();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT created_at FROM conversations WHERE id = ?').get(convId) as
    | { created_at: string }
    | undefined;
  db.prepare(
    `INSERT OR REPLACE INTO conversations (id, user_id, analysis_id, title, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    convId,
    userId,
    analysisId ?? null,
    title,
    JSON.stringify(messages),
    existing?.created_at ?? now,
    now
  );
  return convId;
}

export function listConversations(userId: string | null, limit = 20) {
  const db = getDb();
  const rows = userId
    ? (db
        .prepare(
          'SELECT id, analysis_id, title, messages_json, created_at, updated_at FROM conversations WHERE user_id = ? OR user_id IS NULL ORDER BY updated_at DESC LIMIT ?'
        )
        .all(userId, limit) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          'SELECT id, analysis_id, title, messages_json, created_at, updated_at FROM conversations WHERE user_id IS NULL ORDER BY updated_at DESC LIMIT ?'
        )
        .all(limit) as Array<Record<string, unknown>>);

  return rows.map((r) => ({
    id: String(r.id),
    analysisId: r.analysis_id ? String(r.analysis_id) : undefined,
    title: String(r.title),
    messages: JSON.parse(String(r.messages_json)) as AssistantMessage[],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}
