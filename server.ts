import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  authenticateUser,
  createSession,
  deleteAnalysis,
  deleteSavedRegion,
  deleteSession,
  getAnalysisById,
  getDb,
  getDbInfo,
  getUserBySessionToken,
  listAnalyses,
  listConversations,
  listSavedRegions,
  registerUser,
  saveAnalysis,
  saveConversation,
  saveRegion,
  updateUserPreferences,
} from './server/db.ts';
import {
  computePolygonSummary,
  reverseGeocode,
  searchGlobalRegions,
  validateLatLon,
} from './server/services/geocoding.ts';
import {
  GIBS_LAYER_CATALOG,
  NASA_DATASET_CATALOG,
  checkAllDatasetStatuses,
  fetchGibsLayerImage,
  getDatasetEntry,
  queryCmrMetadata,
  retrieveNasaObservations,
  searchNasaImages,
  validateDatasetCoverage,
} from './server/services/nasaConnectors.ts';
import {
  analyzeTrend,
  compareRegions,
  detectAnomalies,
  generateForecast,
} from './server/services/statistics.ts';
import { askAethryxAssistant, getGeminiStatus } from './server/services/geminiService.ts';
import {
  generateCsvReport,
  generateHtmlReport,
  generatePdfReportBuffer,
} from './server/services/reportExport.ts';
import type {
  AnomalyMethod,
  DatasetId,
  FullAnalysisBundle,
  GeoRegion,
} from './src/types/aethryx.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE_NAME = 'aethryx_session';

// Simple in-memory sliding-window rate limiter for /api/*
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'local';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > 180) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before issuing more requests.' });
  }
  return next();
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

interface AuthedRequest extends Request {
  user?: ReturnType<typeof getUserBySessionToken>;
}

function attachSession(req: AuthedRequest, _res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookies[SESSION_COOKIE_NAME] || bearer;
  req.user = getUserBySessionToken(token);
  next();
}

function setSessionCookie(res: Response, token: string, expiresAt: string) {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAge}`,
    isProd ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; ${isProd ? 'SameSite=None; Secure' : 'SameSite=Lax'}`
  );
}

// Validation Schemas
const GeoRegionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(400),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  bbox: z
    .object({
      south: z.number().min(-90).max(90),
      north: z.number().min(-90).max(90),
      west: z.number().min(-180).max(180),
      east: z.number().min(-180).max(180),
    })
    .optional(),
  polygon: z
    .array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
    .optional(),
  country: z.string().optional(),
  regionType: z.string().optional(),
  isOcean: z.boolean().optional(),
  source: z.string().optional(),
});

const DatasetIdEnum = z.enum([
  'NASA-POWER',
  'MERRA2',
  'GPM-IMERG',
  'MODIS',
  'AIRS',
  'OMI',
  'GLDAS',
]);

const RetrieveRequestSchema = z.object({
  datasetId: DatasetIdEnum,
  variable: z.string().min(1).max(64),
  region: GeoRegionSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aggregation: z.enum(['daily', 'monthly', 'yearly']).default('monthly'),
  dataMode: z.enum(['LIVE', 'DEMO']).default('LIVE'),
  anomalyMethod: z.enum(['Z_SCORE', 'IQR', 'SEASONAL_DEVIATION', 'MOVING_AVERAGE']).default('SEASONAL_DEVIATION'),
  anomalyThreshold: z.number().min(1).max(5).default(2.0),
  saveToHistory: z.boolean().default(true),
});

// GIBS image memory cache (15 min TTL)
const gibsCache = new Map<string, { buffer: Buffer; contentType: string; expiresAt: number }>();

export function createApp() {
  // Initialize SQLite database at startup
  getDb();

  const app = express();
  app.set('trust proxy', 1);

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const allowedOrigins = [
    process.env.APP_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean) as string[];

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || origin.endsWith('.run.app')) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', rateLimit, attachSession);

  // --- Health ---
  app.get('/api/health', (_req, res) => {
    const db = getDbInfo();
    const gemini = getGeminiStatus();
    res.json({
      status: 'ok',
      service: 'AETHRYX JARVIS',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      database: db,
      gemini,
      earthdataServerTokenConfigured: Boolean(process.env.EARTHDATA_TOKEN),
    });
  });

  // --- Auth Endpoints ---
  app.get('/api/auth/session', (req: AuthedRequest, res) => {
    res.json({
      authenticated: Boolean(req.user),
      user: req.user?.user ?? null,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(6).max(128),
        displayName: z.string().min(2).max(80),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration fields' });
    }
    try {
      const user = registerUser(parsed.data.email, parsed.data.password, parsed.data.displayName);
      const sess = createSession(user.id);
      setSessionCookie(res, sess.token, sess.expiresAt);
      return res.status(201).json({ user });
    } catch (err) {
      return res.status(409).json({ error: err instanceof Error ? err.message : 'Registration failed' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid email and password are required.' });
    }
    const user = authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const sess = createSession(user.id);
    setSessionCookie(res, sess.token, sess.expiresAt);
    return res.json({ user });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) deleteSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.put('/api/auth/preferences', (req: AuthedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in required to save investigator preferences.' });
    }
    const parsed = z
      .object({
        preferences: z
          .object({
            preferredVoiceUri: z.string().optional(),
            speechRate: z.number().min(0.5).max(2).optional(),
            autoSpeakResponses: z.boolean().optional(),
            defaultDataMode: z.enum(['LIVE', 'DEMO']).optional(),
            defaultAggregation: z.enum(['daily', 'monthly', 'yearly']).optional(),
          })
          .optional(),
        earthdataToken: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid preference payload.' });
    }
    try {
      const updated = updateUserPreferences(
        req.user.user.id,
        parsed.data.preferences || {},
        parsed.data.earthdataToken
      );
      return res.json({ user: updated });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  // --- NASA Datasets & Live Metadata ---
  app.get('/api/datasets', (_req, res) => {
    res.json({ datasets: NASA_DATASET_CATALOG });
  });

  app.get('/api/datasets/status', async (req: AuthedRequest, res) => {
    try {
      const statuses = await checkAllDatasetStatuses(req.user?.earthdataToken);
      res.json({ statuses, checkedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Status check failed' });
    }
  });

  app.get('/api/datasets/:id/metadata', async (req, res) => {
    try {
      const id = DatasetIdEnum.parse(req.params.id) as DatasetId;
      const entry = getDatasetEntry(id);
      let cmrInfo = null;
      if (id !== 'NASA-POWER') {
        try {
          cmrInfo = await queryCmrMetadata(entry.cmrShortName);
        } catch {
          cmrInfo = null;
        }
      }
      res.json({ dataset: entry, cmrInfo });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Dataset not found' });
    }
  });

  app.post('/api/datasets/validate-coverage', (req, res) => {
    const parsed = z
      .object({
        datasetId: DatasetIdEnum,
        region: GeoRegionSchema,
        startDate: z.string(),
        endDate: z.string(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid coverage validation payload.' });
    }
    const dataset = getDatasetEntry(parsed.data.datasetId);
    const result = validateDatasetCoverage(
      dataset,
      parsed.data.region as GeoRegion,
      parsed.data.startDate,
      parsed.data.endDate
    );
    return res.json(result);
  });

  // --- Global Geocoding & Saved Regions ---
  app.get('/api/regions/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ regions: [] });
    try {
      const regions = await searchGlobalRegions(q);
      return res.json({ regions });
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Global geocoding lookup failed',
      });
    }
  });

  app.get('/api/regions/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const check = validateLatLon(lat, lon);
    if (!check.valid) {
      return res.status(400).json({ error: check.reason });
    }
    try {
      const region = await reverseGeocode(lat, lon);
      return res.json({ region });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Reverse geocode failed' });
    }
  });

  app.post('/api/regions/polygon', async (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(120).optional(),
        polygon: z
          .array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
          .min(3),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Polygon requires at least 3 valid coordinates.' });
    }
    const { centroid, bbox } = computePolygonSummary(parsed.data.polygon);
    const rev = await reverseGeocode(centroid.lat, centroid.lon);
    const region: GeoRegion = {
      ...rev,
      name: parsed.data.name || `Custom Polygon (${rev.name})`,
      displayName: `Custom Polygon around ${rev.displayName}`,
      bbox,
      polygon: parsed.data.polygon,
      regionType: 'polygon',
    };
    return res.json({ region });
  });

  app.get('/api/regions/saved', (req: AuthedRequest, res) => {
    const regions = listSavedRegions(req.user?.user.id ?? null);
    res.json({ regions });
  });

  app.post('/api/regions/saved', (req: AuthedRequest, res) => {
    const parsed = GeoRegionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid region data.' });
    }
    const saved = saveRegion(parsed.data as GeoRegion, req.user?.user.id ?? null);
    return res.status(201).json({ region: saved });
  });

  app.delete('/api/regions/saved/:id', (req: AuthedRequest, res) => {
    const ok = deleteSavedRegion(req.params.id, req.user?.user.id ?? null);
    if (!ok) {
      return res.status(404).json({ error: 'Saved region not found or protected preset.' });
    }
    return res.json({ ok: true });
  });

  // --- Data Retrieval & Full Scientific Analysis ---
  app.post('/api/data/retrieve', async (req: AuthedRequest, res) => {
    const parsed = RetrieveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid retrieval parameters' });
    }
    try {
      const data = await retrieveNasaObservations({
        datasetId: parsed.data.datasetId,
        variable: parsed.data.variable,
        region: parsed.data.region as GeoRegion,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        aggregation: parsed.data.aggregation,
        dataMode: parsed.data.dataMode,
        earthdataToken: req.user?.earthdataToken,
      });
      return res.json(data);
    } catch (err) {
      const e = err as Error & { code?: string; cmrGranuleCount?: number };
      const status = e.code === 'EARTHDATA_AUTH_REQUIRED' ? 401 : 400;
      return res.status(status).json({
        error: e.message,
        code: e.code || 'RETRIEVAL_FAILED',
        cmrGranuleCount: e.cmrGranuleCount,
      });
    }
  });

  app.post('/api/analysis/full', async (req: AuthedRequest, res) => {
    const parsed = RetrieveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid analysis request' });
    }
    try {
      const { observations, provenance } = await retrieveNasaObservations({
        datasetId: parsed.data.datasetId,
        variable: parsed.data.variable,
        region: parsed.data.region as GeoRegion,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        aggregation: parsed.data.aggregation,
        dataMode: parsed.data.dataMode,
        earthdataToken: req.user?.earthdataToken,
      });

      const trend = analyzeTrend(observations, 0.05);
      const anomalies = detectAnomalies(
        observations,
        parsed.data.anomalyMethod as AnomalyMethod,
        parsed.data.anomalyThreshold
      );
      const forecast = generateForecast(
        observations,
        parsed.data.aggregation === 'yearly' ? 5 : 12
      );

      let bundle: FullAnalysisBundle = {
        region: parsed.data.region as GeoRegion,
        provenance,
        observations,
        trend,
        anomalies,
        forecast,
      };

      if (parsed.data.saveToHistory) {
        const saved = saveAnalysis(bundle, req.user?.user.id ?? null);
        bundle = { ...bundle, id: saved.id, createdAt: saved.createdAt };
      }

      return res.json({ analysis: bundle });
    } catch (err) {
      const e = err as Error & { code?: string; cmrGranuleCount?: number };
      const status = e.code === 'EARTHDATA_AUTH_REQUIRED' ? 401 : 400;
      return res.status(status).json({
        error: e.message,
        code: e.code || 'ANALYSIS_FAILED',
        cmrGranuleCount: e.cmrGranuleCount,
      });
    }
  });

  app.post('/api/analysis/trend', (req, res) => {
    const parsed = z
      .object({
        observations: z.array(
          z.object({
            date: z.string(),
            decimalYear: z.number(),
            value: z.number().nullable(),
          })
        ),
        alpha: z.number().min(0.001).max(0.25).default(0.05),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid observations array for trend analysis.' });
    }
    const trend = analyzeTrend(parsed.data.observations, parsed.data.alpha);
    return res.json({ trend });
  });

  app.post('/api/analysis/anomalies', (req, res) => {
    const parsed = z
      .object({
        observations: z.array(
          z.object({
            date: z.string(),
            decimalYear: z.number(),
            value: z.number().nullable(),
          })
        ),
        method: z.enum(['Z_SCORE', 'IQR', 'SEASONAL_DEVIATION', 'MOVING_AVERAGE']).default('SEASONAL_DEVIATION'),
        threshold: z.number().min(1).max(5).default(2.0),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid anomaly detection payload.' });
    }
    const anomalies = detectAnomalies(
      parsed.data.observations,
      parsed.data.method,
      parsed.data.threshold
    );
    return res.json({ anomalies });
  });

  app.post('/api/analysis/forecast', (req, res) => {
    const parsed = z
      .object({
        observations: z.array(
          z.object({
            date: z.string(),
            decimalYear: z.number(),
            value: z.number().nullable(),
          })
        ),
        horizonSteps: z.number().int().min(1).max(36).default(12),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid forecast payload.' });
    }
    const forecast = generateForecast(parsed.data.observations, parsed.data.horizonSteps);
    return res.json({ forecast });
  });

  app.post('/api/analysis/compare', async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        regionA: GeoRegionSchema,
        regionB: GeoRegionSchema,
        datasetId: DatasetIdEnum,
        variable: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        aggregation: z.enum(['daily', 'monthly', 'yearly']).default('monthly'),
        dataMode: z.enum(['LIVE', 'DEMO']).default('LIVE'),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid regional comparison payload.' });
    }

    try {
      const [resA, resB] = await Promise.all([
        retrieveNasaObservations({
          datasetId: parsed.data.datasetId,
          variable: parsed.data.variable,
          region: parsed.data.regionA as GeoRegion,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          aggregation: parsed.data.aggregation,
          dataMode: parsed.data.dataMode,
          earthdataToken: req.user?.earthdataToken,
        }),
        retrieveNasaObservations({
          datasetId: parsed.data.datasetId,
          variable: parsed.data.variable,
          region: parsed.data.regionB as GeoRegion,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          aggregation: parsed.data.aggregation,
          dataMode: parsed.data.dataMode,
          earthdataToken: req.user?.earthdataToken,
        }),
      ]);

      const trendA = analyzeTrend(resA.observations);
      const trendB = analyzeTrend(resB.observations);
      const comparison = compareRegions(
        parsed.data.regionA as GeoRegion,
        resA.observations,
        trendA,
        resA.provenance.units,
        resA.provenance.variable,
        parsed.data.regionB as GeoRegion,
        resB.observations,
        trendB,
        resB.provenance.units,
        resB.provenance.variable
      );

      return res.json({
        comparison,
        provenanceA: resA.provenance,
        provenanceB: resB.provenance,
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      return res.status(e.code === 'EARTHDATA_AUTH_REQUIRED' ? 401 : 400).json({
        error: e.message,
        code: e.code || 'COMPARISON_FAILED',
      });
    }
  });

  // --- NASA GIBS Earth Explorer Layers ---
  app.get('/api/earth/layers', (_req, res) => {
    res.json({ layers: GIBS_LAYER_CATALOG });
  });

  app.get('/api/earth/gibs-image', async (req, res) => {
    const layer = String(req.query.layer || 'blue-marble');
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const cacheKey = `${layer}:${date || 'default'}`;
    const hit = gibsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      res.setHeader('Content-Type', hit.contentType);
      res.setHeader('Cache-Control', 'public, max-age=900');
      return res.send(hit.buffer);
    }

    try {
      const result = await fetchGibsLayerImage(layer, date);
      gibsCache.set(cacheKey, {
        buffer: result.buffer,
        contentType: result.contentType,
        expiresAt: Date.now() + 1000 * 60 * 15,
      });
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=900');
      return res.send(result.buffer);
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to fetch NASA GIBS imagery layer',
      });
    }
  });

  // --- NASA Images Explorer ---
  app.get('/api/images/search', async (req, res) => {
    const q = String(req.query.q || 'Earth');
    const page = Math.max(1, Number(req.query.page || 1));
    try {
      const result = await searchNasaImages(q, page);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'NASA Images search failed' });
    }
  });

  // --- Gemini AI Scientific Assistant ---
  app.post('/api/assistant/chat', async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        question: z.string().min(1).max(2000),
        history: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
          .optional(),
        analysisId: z.string().optional(),
        analysis: z.any().optional(),
        conversationId: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Question text is required.' });
    }

    let analysis: FullAnalysisBundle | null = parsed.data.analysis || null;
    if (!analysis && parsed.data.analysisId) {
      analysis = getAnalysisById(parsed.data.analysisId);
    }

    const reply = await askAethryxAssistant({
      question: parsed.data.question,
      history: parsed.data.history,
      analysis,
    });

    const now = new Date().toISOString();
    const updatedMessages = [
      ...(parsed.data.history || []).map((m, i) => ({
        id: `hist-${i}`,
        role: m.role,
        content: m.content,
        timestamp: now,
      })),
      {
        id: `u-${Date.now()}`,
        role: 'user' as const,
        content: parsed.data.question,
        timestamp: now,
      },
      {
        id: `a-${Date.now() + 1}`,
        role: 'assistant' as const,
        content: reply.answer,
        timestamp: now,
        mode: reply.mode,
        citedDataset: reply.citedDataset,
      },
    ];

    const title = analysis
      ? `${analysis.region.name} · ${analysis.provenance.variable}`
      : parsed.data.question.slice(0, 48);
    const conversationId = saveConversation(
      parsed.data.conversationId,
      req.user?.user.id ?? null,
      analysis?.id,
      title,
      updatedMessages
    );

    return res.json({
      answer: reply.answer,
      mode: reply.mode,
      citedDataset: reply.citedDataset,
      conversationId,
    });
  });

  // --- Reports Export (PDF, HTML, CSV) ---
  app.post('/api/reports/export', (req, res) => {
    const parsed = z
      .object({
        format: z.enum(['pdf', 'html', 'csv']),
        analysisId: z.string().optional(),
        analysis: z.any().optional(),
        aiSummary: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid export request.' });
    }

    let bundle: FullAnalysisBundle | null = parsed.data.analysis || null;
    if (!bundle && parsed.data.analysisId) {
      bundle = getAnalysisById(parsed.data.analysisId);
    }
    if (!bundle || !bundle.provenance || !bundle.trend) {
      return res.status(400).json({ error: 'No completed scientific analysis available to export.' });
    }

    const safeName = bundle.region.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const fileBase = `aethryx-${safeName}-${bundle.provenance.variable.toLowerCase()}`;

    if (parsed.data.format === 'csv') {
      const csv = generateCsvReport(bundle, parsed.data.aiSummary);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      return res.send(csv);
    }

    if (parsed.data.format === 'html') {
      const html = generateHtmlReport(bundle, parsed.data.aiSummary);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.html"`);
      return res.send(html);
    }

    const pdfBuffer = generatePdfReportBuffer(bundle, parsed.data.aiSummary);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
    return res.send(pdfBuffer);
  });

  // --- History & Conversations ---
  app.get('/api/history', (req: AuthedRequest, res) => {
    const analyses = listAnalyses(req.user?.user.id ?? null);
    res.json({ analyses });
  });

  app.get('/api/history/:id', (req, res) => {
    const analysis = getAnalysisById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis investigation not found.' });
    }
    return res.json({ analysis });
  });

  app.post('/api/history', (req: AuthedRequest, res) => {
    const bundle = req.body?.analysis as FullAnalysisBundle | undefined;
    if (!bundle || !bundle.region || !bundle.provenance || !bundle.trend) {
      return res.status(400).json({ error: 'Valid analysis bundle required.' });
    }
    const saved = saveAnalysis(bundle, req.user?.user.id ?? null);
    return res.status(201).json({ summary: saved });
  });

  app.delete('/api/history/:id', (req: AuthedRequest, res) => {
    const ok = deleteAnalysis(req.params.id, req.user?.user.id ?? null);
    if (!ok) {
      return res.status(404).json({ error: 'Analysis record not found.' });
    }
    return res.json({ ok: true });
  });

  app.get('/api/conversations', (req: AuthedRequest, res) => {
    const conversations = listConversations(req.user?.user.id ?? null);
    res.json({ conversations });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const fallbackDist = path.resolve(process.cwd(), 'dist');
    const staticDir = distDir.endsWith('dist-server/dist') ? fallbackDist : distDir;
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AETHRYX JARVIS] Mission server active on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

// Only bind port when executed as entrypoint, not when imported by unit tests
const isTestRun = process.env.NODE_TEST_CONTEXT !== undefined || process.argv.some((a) => a.includes('.test.'));
if (!isTestRun) {
  startServer().catch((err) => {
    console.error('[AETHRYX JARVIS] Fatal startup error:', err);
    process.exit(1);
  });
}
