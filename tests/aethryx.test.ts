import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../server.ts';
import {
  analyzeTrend,
  compareRegions,
  dateToDecimalYear,
  detectAnomalies,
  generateForecast,
} from '../server/services/statistics.ts';
import { getDatasetEntry, validateDatasetCoverage } from '../server/services/nasaConnectors.ts';
import type { GeoRegion, ObservationPoint } from '../src/types/aethryx.ts';

function buildLinearSeries(nYears: number, slopePerYear: number, base = 20): ObservationPoint[] {
  const pts: ObservationPoint[] = [];
  for (let y = 2000; y < 2000 + nYears; y++) {
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const dec = dateToDecimalYear(ym);
      const seasonal = Math.sin(((m - 1) / 12) * Math.PI * 2) * 3.0;
      const val = base + slopePerYear * (dec - 2000) + seasonal;
      pts.push({ date: ym, decimalYear: dec, value: Number(val.toFixed(4)) });
    }
  }
  return pts;
}

test('Statistical engine detects exact positive trend with Mann-Kendall and Sen slope', () => {
  const series = buildLinearSeries(15, 0.15, 22);
  const res = analyzeTrend(series, 0.05);
  assert.equal(res.classification, 'INCREASING');
  assert.ok(Math.abs(res.sensSlope.slopePerYear - 0.15) < 0.05, `Sen slope ${res.sensSlope.slopePerYear}`);
  assert.ok(res.seasonalMannKendall.applicable);
  assert.ok(res.seasonalMannKendall.significant);
  assert.ok(res.seasonalMannKendall.pValue < 0.001);
  assert.ok(res.linearRegression.ci95HighPerYear > res.linearRegression.ci95LowPerYear);
});

test('Statistical engine detects negative trend and handles missing null observations', () => {
  const series = buildLinearSeries(12, -0.22, 30);
  series[5].value = null;
  series[20].value = null;
  const res = analyzeTrend(series, 0.05);
  assert.equal(res.classification, 'DECREASING');
  assert.equal(res.missingCount, 2);
  assert.equal(res.validCount, series.length - 2);
  assert.ok(res.linearRegression.slopePerYear < -0.15);
});

test('Statistical engine returns INSUFFICIENT_EVIDENCE when fewer than 6 observations exist', () => {
  const short: ObservationPoint[] = [
    { date: '2024-01', decimalYear: 2024.04, value: 21 },
    { date: '2024-02', decimalYear: 2024.12, value: 22 },
    { date: '2024-03', decimalYear: 2024.2, value: 23 },
  ];
  const res = analyzeTrend(short);
  assert.equal(res.classification, 'INSUFFICIENT_EVIDENCE');
});

test('Anomaly detection flags injected seasonal spike and forecast validates holdout', () => {
  const series = buildLinearSeries(10, 0.05, 25);
  series[45].value = 48.5; // Clear anomaly spike
  const anom = detectAnomalies(series, 'SEASONAL_DEVIATION', 2.0);
  assert.ok(anom.anomalyCount >= 1);
  assert.equal(anom.anomalies[0].date, series[45].date);

  const fc = generateForecast(series, 6);
  assert.equal(fc.available, true);
  assert.equal(fc.points.length, 6);
  assert.ok(fc.validationMetrics && fc.validationMetrics.rmse >= 0);

  const shortFc = generateForecast(series.slice(0, 8), 6);
  assert.equal(shortFc.available, false);
});

test('Dataset geographic and temporal coverage rules enforce NASA product bounds', () => {
  const modis = getDatasetEntry('MODIS');
  const gpm = getDatasetEntry('GPM-IMERG');

  const oceanRegion: GeoRegion = {
    name: 'Pacific Ocean',
    displayName: 'Pacific Ocean',
    lat: 0,
    lon: -140,
    isOcean: true,
  };
  const polarRegion: GeoRegion = {
    name: 'High Arctic',
    displayName: 'High Arctic',
    lat: 78,
    lon: 15,
    isOcean: false,
  };

  const modisOceanCheck = validateDatasetCoverage(modis, oceanRegion, '2020-01-01', '2024-01-01');
  assert.equal(modisOceanCheck.valid, false);

  const gpmPolarCheck = validateDatasetCoverage(gpm, polarRegion, '2020-01-01', '2024-01-01');
  assert.equal(gpmPolarCheck.valid, false);

  const gpmEarlyCheck = validateDatasetCoverage(gpm, { ...polarRegion, lat: 13.9 }, '1990-01-01', '1995-01-01');
  assert.equal(gpmEarlyCheck.valid, false);
});

test('Regional comparison rejects incompatible units', () => {
  const regA: GeoRegion = { name: 'A', displayName: 'A', lat: 13.9, lon: 75.5 };
  const regB: GeoRegion = { name: 'B', displayName: 'B', lat: 51.5, lon: -0.1 };
  const sA = buildLinearSeries(6, 0.1, 20);
  const sB = buildLinearSeries(6, 0.2, 10);
  const comp = compareRegions(
    regA,
    sA,
    analyzeTrend(sA),
    '°C',
    'T2M',
    regB,
    sB,
    analyzeTrend(sB),
    'mm/day',
    'PRECTOTCORR'
  );
  assert.equal(comp.compatible, false);
});

test('End-to-end HTTP server integration, auth persistence, global NASA retrieval, and report export', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Health & SQLite check
    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string; database: { connected: boolean } };
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.database.connected, true);

    // 2. Auth flow + cookie session persistence
    const testEmail = `tester-${Date.now()}@aethryx.test`;
    const regRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'secure-password-123', displayName: 'Test Scientist' }),
    });
    assert.equal(regRes.status, 201);
    const setCookie = regRes.headers.get('set-cookie') || '';
    const sessionCookie = setCookie.split(';')[0];
    assert.ok(sessionCookie.startsWith('aethryx_session='));

    const sessRes = await fetch(`${base}/api/auth/session`, {
      headers: { Cookie: sessionCookie },
    });
    const sessJson = (await sessRes.json()) as { authenticated: boolean; user: { email: string } };
    assert.equal(sessJson.authenticated, true);
    assert.equal(sessJson.user.email, testEmail);

    // 3. Global search across multiple continents
    const searchLondon = await fetch(`${base}/api/regions/search?q=London`);
    assert.equal(searchLondon.status, 200);
    const londonJson = (await searchLondon.json()) as { regions: GeoRegion[] };
    assert.ok(londonJson.regions.length > 0);
    assert.ok(Math.abs(londonJson.regions[0].lat - 51.5) < 1.0);

    // 4. Live NASA POWER retrieval for two distinct global coordinates (Shivamogga vs London)
    const [shivRes, lonRes] = await Promise.all([
      fetch(`${base}/api/analysis/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({
          datasetId: 'NASA-POWER',
          variable: 'T2M',
          region: {
            name: 'Shivamogga, India',
            displayName: 'Shivamogga, Karnataka, India',
            lat: 13.9299,
            lon: 75.5681,
          },
          startDate: '2020-01-01',
          endDate: '2023-12-31',
          aggregation: 'monthly',
          dataMode: 'LIVE',
          saveToHistory: true,
        }),
      }),
      fetch(`${base}/api/analysis/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({
          datasetId: 'NASA-POWER',
          variable: 'T2M',
          region: {
            name: 'London, UK',
            displayName: 'London, United Kingdom',
            lat: 51.5074,
            lon: -0.1278,
          },
          startDate: '2020-01-01',
          endDate: '2023-12-31',
          aggregation: 'monthly',
          dataMode: 'LIVE',
          saveToHistory: false,
        }),
      }),
    ]);

    assert.equal(shivRes.status, 200);
    assert.equal(lonRes.status, 200);
    const shivBundle = (await shivRes.json()).analysis;
    const lonBundle = (await lonRes.json()).analysis;
    assert.equal(shivBundle.provenance.dataMode, 'LIVE');
    assert.ok(shivBundle.trend.validCount >= 40);
    assert.ok(
      shivBundle.trend.summary.mean > lonBundle.trend.summary.mean + 5,
      `Expected Shivamogga mean (${shivBundle.trend.summary.mean}) > London mean (${lonBundle.trend.summary.mean})`
    );

    // 5. All 7 NASA datasets status check (live CMR / AppEEARS / POWER)
    const statusRes = await fetch(`${base}/api/datasets/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      statuses: Array<{ id: string; metadataStatus: string }>;
    };
    assert.equal(statusJson.statuses.length, 7);
    assert.ok(statusJson.statuses.every((s) => s.metadataStatus === 'LIVE'));

    // 6. PDF, HTML, CSV export generation
    for (const fmt of ['pdf', 'html', 'csv'] as const) {
      const expRes = await fetch(`${base}/api/reports/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: fmt, analysis: shivBundle }),
      });
      assert.equal(expRes.status, 200);
      const buf = Buffer.from(await expRes.arrayBuffer());
      if (fmt === 'pdf') assert.equal(buf.subarray(0, 4).toString(), '%PDF');
      if (fmt === 'html') assert.ok(buf.toString('utf8').includes('<!DOCTYPE html>'));
      if (fmt === 'csv') assert.ok(buf.toString('utf8').includes('AETHRYX JARVIS'));
    }

    // 7. Assistant endpoint check
    const chatRes = await fetch(`${base}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        question: 'Summarize my current investigation.',
        analysis: shivBundle,
      }),
    });
    assert.equal(chatRes.status, 200);
    const chatJson = (await chatRes.json()) as { answer: string };
    assert.ok(chatJson.answer.includes('Shivamogga') || chatJson.answer.includes('POWER'));

    // 8. Concurrent DB load test (20 parallel history reads)
    const loadResults = await Promise.all(
      Array.from({ length: 20 }, () => fetch(`${base}/api/history`, { headers: { Cookie: sessionCookie } }))
    );
    assert.ok(loadResults.every((r) => r.status === 200));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
