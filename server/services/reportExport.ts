import { jsPDF } from 'jspdf';
import type { FullAnalysisBundle } from '../../src/types/aethryx.ts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateCsvReport(bundle: FullAnalysisBundle, aiSummary?: string): string {
  const { region, provenance, trend, anomalies } = bundle;
  const lines: string[] = [
    `# AETHRYX JARVIS — Scientific Earth System Trend Report`,
    `# Data Mode,${csvCell(provenance.dataMode)}`,
    `# Region,${csvCell(region.name)} (${region.lat}, ${region.lon})`,
    `# Dataset,${csvCell(provenance.officialDatasetName)} (${csvCell(provenance.productId)})`,
    `# NASA Source,${csvCell(provenance.nasaSource)}`,
    `# Source URL,${csvCell(provenance.sourceUrl)}`,
    `# API Endpoint,${csvCell(provenance.apiEndpoint)}`,
    `# Variable,${csvCell(provenance.variableName)} (${csvCell(provenance.variable)}) [${csvCell(provenance.units)}]`,
    `# Selected Range,${csvCell(provenance.selectedStartDate)} to ${csvCell(provenance.selectedEndDate)}`,
    `# Actual Range,${csvCell(provenance.actualStartDate)} to ${csvCell(provenance.actualEndDate)}`,
    `# Aggregation,${csvCell(provenance.aggregation)}`,
    `# Spatial Averaging,${csvCell(provenance.spatialAveragingMethod)}`,
    `# Retrieval Timestamp,${csvCell(provenance.retrievalTimestamp)}`,
    `# Valid Observations,${provenance.validObservationCount},Missing Observations,${provenance.missingDataCount}`,
    `# Trend Classification,${csvCell(trend.classification)}`,
    `# OLS Slope (per yr),${trend.linearRegression.slopePerYear},OLS p-value,${trend.linearRegression.pValue},R2,${trend.linearRegression.rSquared}`,
    `# Mann-Kendall S,${trend.mannKendall.sStatistic},MK Z,${trend.mannKendall.zStatistic},MK p-value,${trend.mannKendall.pValue}`,
    `# Sens Slope (per yr),${trend.sensSlope.slopePerYear},CI95 Low,${trend.sensSlope.ci95LowPerYear},CI95 High,${trend.sensSlope.ci95HighPerYear}`,
    `# Anomalies Flagged (${anomalies.method} threshold ${anomalies.threshold}),${anomalies.anomalyCount}`,
  ];

  if (aiSummary) {
    lines.push(`# Scientific Explanation (AI/System Interpretation),${csvCell(aiSummary.replace(/\s+/g, ' '))}`);
  }

  lines.push('');
  lines.push('date,decimal_year,observed_value,units,ols_fitted,ols_ci95_low,ols_ci95_high,data_mode');

  const regByDate = new Map(trend.regressionSeries.map((r) => [r.date, r]));
  for (const obs of bundle.observations) {
    const reg = regByDate.get(obs.date);
    lines.push(
      [
        csvCell(obs.date),
        obs.decimalYear,
        obs.value === null ? 'MISSING' : obs.value,
        csvCell(provenance.units),
        reg ? reg.fitted : '',
        reg ? reg.ciLow : '',
        reg ? reg.ciHigh : '',
        csvCell(provenance.dataMode),
      ].join(',')
    );
  }

  if (anomalies.anomalies.length > 0) {
    lines.push('');
    lines.push('anomaly_date,observed,expected_baseline,deviation,z_score,severity,method,explanation');
    for (const a of anomalies.anomalies) {
      lines.push(
        [
          csvCell(a.date),
          a.observed,
          a.expectedBaseline,
          a.deviation,
          a.zScore,
          csvCell(a.severity),
          csvCell(a.method),
          csvCell(a.explanation),
        ].join(',')
      );
    }
  }

  return lines.join('\n');
}

function buildSvgChartForHtml(bundle: FullAnalysisBundle): string {
  const valid = bundle.observations.filter(
    (o): o is typeof o & { value: number } => o.value !== null && Number.isFinite(o.value)
  );
  if (valid.length < 2) {
    return '<p>Insufficient valid points to render time-series chart.</p>';
  }
  const w = 780;
  const h = 250;
  const padL = 56;
  const padR = 20;
  const padT = 20;
  const padB = 34;

  const reg = bundle.trend.regressionSeries;
  const allVals = valid.map((v) => v.value).concat(reg.map((r) => r.fitted));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const spanV = maxV - minV || 1;
  const minX = valid[0].decimalYear;
  const maxX = valid[valid.length - 1].decimalYear;
  const spanX = maxX - minX || 1;

  const sx = (x: number) => padL + ((x - minX) / spanX) * (w - padL - padR);
  const sy = (y: number) => h - padB - ((y - minV) / spanV) * (h - padT - padB);

  const obsPath = valid
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${sx(pt.decimalYear).toFixed(1)} ${sy(pt.value).toFixed(1)}`)
    .join(' ');
  const regPath = reg
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${sx(pt.decimalYear).toFixed(1)} ${sy(pt.fitted).toFixed(1)}`)
    .join(' ');

  return `
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="250" xmlns="http://www.w3.org/2000/svg" style="background:#0b111c;border:1px solid #1e293b;border-radius:6px;">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="#334155" stroke-width="1"/>
    <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="#334155" stroke-width="1"/>
    <text x="${padL - 8}" y="${padT + 8}" fill="#94a3b8" font-size="10" text-anchor="end" font-family="monospace">${maxV.toFixed(2)}</text>
    <text x="${padL - 8}" y="${h - padB}" fill="#94a3b8" font-size="10" text-anchor="end" font-family="monospace">${minV.toFixed(2)}</text>
    <text x="${padL}" y="${h - 12}" fill="#94a3b8" font-size="10" font-family="monospace">${escapeHtml(valid[0].date)}</text>
    <text x="${w - padR}" y="${h - 12}" fill="#94a3b8" font-size="10" text-anchor="end" font-family="monospace">${escapeHtml(valid[valid.length - 1].date)}</text>
    <path d="${obsPath}" fill="none" stroke="#06b6d4" stroke-width="1.8"/>
    <path d="${regPath}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5,4"/>
  </svg>`;
}

export function generateHtmlReport(bundle: FullAnalysisBundle, aiSummary?: string): string {
  const { region, provenance, trend, anomalies } = bundle;
  const chartSvg = buildSvgChartForHtml(bundle);

  const anomalyRows =
    anomalies.anomalies.length > 0
      ? anomalies.anomalies
          .slice(0, 15)
          .map(
            (a) => `
          <tr>
            <td>${escapeHtml(a.date)}</td>
            <td>${a.observed.toFixed(3)} ${escapeHtml(provenance.units)}</td>
            <td>${a.expectedBaseline.toFixed(3)} ${escapeHtml(provenance.units)}</td>
            <td>${a.deviation >= 0 ? '+' : ''}${a.deviation.toFixed(3)}</td>
            <td>${a.zScore.toFixed(2)}σ</td>
            <td>${escapeHtml(a.severity)}</td>
            <td>${escapeHtml(a.explanation)}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="7">No statistical anomalies exceeded the ${anomalies.threshold}σ threshold under ${escapeHtml(
          anomalies.method
        )}.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>AETHRYX JARVIS Scientific Report — ${escapeHtml(region.name)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#07090e; color:#e2e8f0; margin:0; padding:32px; line-height:1.55; }
  .container { max-width:920px; margin:0 auto; }
  .banner { border:1px solid #1e293b; background:#0d131f; padding:20px 24px; border-radius:8px; margin-bottom:20px; }
  .demo-warn { border:1px solid #f59e0b; background:#451a03; color:#fde68a; padding:12px 16px; border-radius:6px; margin-bottom:18px; font-weight:600; }
  h1 { margin:0 0 6px; font-size:22px; color:#f8fafc; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:0.06em; color:#38bdf8; border-bottom:1px solid #1e293b; padding-bottom:6px; margin-top:26px; }
  .meta-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px 20px; font-size:13px; }
  .mono { font-family: ui-monospace, SFMono-Regular, monospace; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-top:10px; }
  th, td { border:1px solid #1e293b; padding:7px 9px; text-align:left; vertical-align:top; }
  th { background:#0f172a; color:#94a3b8; font-weight:600; }
  .notes { background:#0d131f; border:1px solid #1e293b; padding:14px 18px; border-radius:6px; font-size:13px; }
</style>
</head>
<body>
<div class="container">
  ${
    provenance.dataMode === 'DEMO'
      ? '<div class="demo-warn">DEMO MODE NOTICE: This report contains simulated illustrative reference values and NOT authentic live NASA observations.</div>'
      : ''
  }
  <div class="banner">
    <div class="mono" style="font-size:11px;color:#38bdf8;">AETHRYX JARVIS · NASA SPACE APPS CHALLENGE 2026 · EARTH SYSTEM TREND DETECTIVE</div>
    <h1>${escapeHtml(region.name)} — ${escapeHtml(provenance.variableName)} Trend Dossier</h1>
    <div class="meta-grid">
      <div><strong>Coordinates:</strong> <span class="mono">${region.lat.toFixed(4)}°, ${region.lon.toFixed(4)}°</span></div>
      <div><strong>Data Mode:</strong> <span class="mono">${escapeHtml(provenance.dataMode)}</span></div>
      <div><strong>NASA Dataset:</strong> ${escapeHtml(provenance.officialDatasetName)}</div>
      <div><strong>Product Identifier:</strong> <span class="mono">${escapeHtml(provenance.productId)} (v${escapeHtml(provenance.version)})</span></div>
      <div><strong>NASA Source:</strong> ${escapeHtml(provenance.nasaSource)}</div>
      <div><strong>Retrieval Timestamp:</strong> <span class="mono">${escapeHtml(provenance.retrievalTimestamp)}</span></div>
      <div><strong>Requested Period:</strong> <span class="mono">${escapeHtml(provenance.selectedStartDate)} to ${escapeHtml(provenance.selectedEndDate)}</span></div>
      <div><strong>Valid / Missing Obs:</strong> <span class="mono">${provenance.validObservationCount} valid · ${provenance.missingDataCount} missing</span></div>
    </div>
  </div>

  <h2>1. Time-Series &amp; Linear Regression Visualization</h2>
  <p style="font-size:12px;color:#94a3b8;">Source: ${escapeHtml(provenance.nasaSource)} · ${escapeHtml(provenance.variableName)} (${escapeHtml(provenance.units)}) · Cyan = Observations, Amber Dashed = OLS Trend</p>
  ${chartSvg}

  <h2>2. Statistical Trend Results (α = ${trend.alpha})</h2>
  <table>
    <tr><th>Metric</th><th>Value</th><th>Metric</th><th>Value</th></tr>
    <tr><td>Classification</td><td class="mono"><strong>${escapeHtml(trend.classification)}</strong></td><td>Summary Mean / Median</td><td class="mono">${trend.summary.mean.toFixed(4)} / ${trend.summary.median.toFixed(4)} ${escapeHtml(provenance.units)}</td></tr>
    <tr><td>OLS Slope (per year)</td><td class="mono">${trend.linearRegression.slopePerYear.toFixed(5)} ${escapeHtml(provenance.units)}/yr</td><td>OLS 95% CI</td><td class="mono">[${trend.linearRegression.ci95LowPerYear.toFixed(5)}, ${trend.linearRegression.ci95HighPerYear.toFixed(5)}]</td></tr>
    <tr><td>OLS R² / t-stat / p-value</td><td class="mono">${trend.linearRegression.rSquared.toFixed(4)} / ${trend.linearRegression.tStatistic.toFixed(3)} / ${trend.linearRegression.pValue.toFixed(5)}</td><td>Min / Max / SD</td><td class="mono">${trend.summary.min.toFixed(3)} / ${trend.summary.max.toFixed(3)} / ${trend.summary.stdDev.toFixed(3)}</td></tr>
    <tr><td>Mann-Kendall S / Z / p</td><td class="mono">${trend.mannKendall.sStatistic} / ${trend.mannKendall.zStatistic.toFixed(3)} / ${trend.mannKendall.pValue.toFixed(5)}</td><td>Sen's Slope (95% CI)</td><td class="mono">${trend.sensSlope.slopePerYear.toFixed(5)} [${trend.sensSlope.ci95LowPerYear.toFixed(5)}, ${trend.sensSlope.ci95HighPerYear.toFixed(5)}]</td></tr>
    <tr><td>Seasonal Mann-Kendall</td><td class="mono">${trend.seasonalMannKendall.applicable ? `S=${trend.seasonalMannKendall.sStatistic}, p=${trend.seasonalMannKendall.pValue.toFixed(5)}` : 'N/A'}</td><td>Lag-1 Autocorrelation (r₁)</td><td class="mono">${trend.autocorrelationLag1.toFixed(4)}</td></tr>
  </table>
  <p style="font-size:13px;margin-top:10px;">${escapeHtml(trend.classificationExplanation)}</p>

  <h2>3. Detected Environmental Anomalies (${escapeHtml(anomalies.method)}, ≥ ${anomalies.threshold}σ)</h2>
  <table>
    <tr><th>Date</th><th>Observed</th><th>Baseline</th><th>Deviation</th><th>Z-Score</th><th>Severity</th><th>Explanation</th></tr>
    ${anomalyRows}
  </table>

  <h2>4. Scientific Explanation &amp; Interpretation</h2>
  <div class="notes">
    <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">IDENTIFIED INTERPRETATION (DISTINCT FROM DIRECT MEASUREMENTS)</div>
    <div>${escapeHtml(aiSummary || trend.classificationExplanation)}</div>
  </div>

  <h2>5. Methodology, Limitations &amp; Reproducibility</h2>
  <div class="notes">
    <ul>
      ${trend.methodologyNotes.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}
      ${trend.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}
    </ul>
    <p class="mono" style="font-size:11px;color:#94a3b8;">Source URL: ${escapeHtml(provenance.sourceUrl)}<br/>API Endpoint: ${escapeHtml(provenance.apiEndpoint)}<br/>Spatial Averaging: ${escapeHtml(provenance.spatialAveragingMethod)}</p>
  </div>
</div>
</body>
</html>`;
}

export function generatePdfReportBuffer(bundle: FullAnalysisBundle, aiSummary?: string): Buffer {
  const { region, provenance, trend, anomalies } = bundle;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 16;

  const ensureSpace = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 16;
    }
  };

  // Header
  doc.setFillColor(13, 19, 31);
  doc.rect(margin, y, contentWidth, 24, 'F');
  doc.setTextColor(56, 189, 248);
  doc.setFontSize(8);
  doc.text('AETHRYX JARVIS  |  NASA SPACE APPS 2026: EARTH SYSTEM TREND DETECTIVE', margin + 4, y + 6);
  doc.setTextColor(248, 250, 252);
  doc.setFontSize(13);
  doc.text(`${region.name} — ${provenance.variableName}`, margin + 4, y + 13);
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Coords: ${region.lat.toFixed(4)}, ${region.lon.toFixed(4)}  |  Dataset: ${provenance.productId}  |  Mode: ${provenance.dataMode}`,
    margin + 4,
    y + 19.5
  );
  y += 29;

  if (provenance.dataMode === 'DEMO') {
    doc.setFillColor(120, 53, 15);
    doc.rect(margin, y, contentWidth, 9, 'F');
    doc.setTextColor(254, 243, 199);
    doc.setFontSize(8.5);
    doc.text(
      'DEMO MODE WARNING: Simulated illustrative data — NOT authentic NASA observations.',
      margin + 3,
      y + 6
    );
    y += 13;
  }

  // Provenance Section
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.text('1. Provenance & Data Quality', margin, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  const provLines = [
    `Official Dataset: ${provenance.officialDatasetName} (v${provenance.version})`,
    `NASA Source: ${provenance.nasaSource}  |  Source URL: ${provenance.sourceUrl}`,
    `Variable: ${provenance.variableName} (${provenance.variable})  |  Units: ${provenance.units}`,
    `Requested Range: ${provenance.selectedStartDate} to ${provenance.selectedEndDate}  |  Aggregation: ${provenance.aggregation}`,
    `Actual Coverage: ${provenance.actualStartDate || 'N/A'} to ${provenance.actualEndDate || 'N/A'}  |  Valid: ${provenance.validObservationCount}, Missing: ${provenance.missingDataCount}`,
    `Spatial Averaging: ${provenance.spatialAveragingMethod}`,
    `Retrieval Timestamp: ${provenance.retrievalTimestamp}`,
  ];
  for (const line of provLines) {
    const wrapped = doc.splitTextToSize(line, contentWidth);
    ensureSpace(wrapped.length * 4 + 1);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4 + 0.8;
  }
  y += 3;

  // Embedded Vector Chart
  const valid = bundle.observations.filter(
    (o): o is typeof o & { value: number } => o.value !== null && Number.isFinite(o.value)
  );
  if (valid.length >= 2) {
    ensureSpace(58);
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text('2. Time-Series & OLS Trend Visualization', margin, y);
    y += 4;
    const chartX = margin;
    const chartY = y;
    const chartW = contentWidth;
    const chartH = 44;
    doc.setFillColor(11, 17, 28);
    doc.rect(chartX, chartY, chartW, chartH, 'F');

    const reg = trend.regressionSeries;
    const allVals = valid.map((v) => v.value).concat(reg.map((r) => r.fitted));
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const spanV = maxV - minV || 1;
    const minX = valid[0].decimalYear;
    const maxX = valid[valid.length - 1].decimalYear;
    const spanX = maxX - minX || 1;

    const px = (x: number) => chartX + 12 + ((x - minX) / spanX) * (chartW - 18);
    const py = (v: number) => chartY + chartH - 7 - ((v - minV) / spanV) * (chartH - 13);

    doc.setDrawColor(6, 182, 212);
    doc.setLineWidth(0.45);
    for (let i = 1; i < valid.length; i++) {
      doc.line(
        px(valid[i - 1].decimalYear),
        py(valid[i - 1].value),
        px(valid[i].decimalYear),
        py(valid[i].value)
      );
    }
    if (reg.length >= 2) {
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(0.5);
      doc.line(
        px(reg[0].decimalYear),
        py(reg[0].fitted),
        px(reg[reg.length - 1].decimalYear),
        py(reg[reg.length - 1].fitted)
      );
    }

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text(`${maxV.toFixed(2)}`, chartX + 1.5, chartY + 6);
    doc.text(`${minV.toFixed(2)}`, chartX + 1.5, chartY + chartH - 6);
    doc.text(`${valid[0].date}`, chartX + 12, chartY + chartH - 2);
    doc.text(`${valid[valid.length - 1].date}`, chartX + chartW - 22, chartY + chartH - 2);
    y += chartH + 7;
  }

  // Statistical Trend Results
  ensureSpace(45);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.text(`3. Statistical Trend Results (alpha = ${trend.alpha})`, margin, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  const statLines = [
    `Classification: ${trend.classification}`,
    `Summary: Mean = ${trend.summary.mean.toFixed(4)} ${provenance.units} | Median = ${trend.summary.median.toFixed(4)} | Min = ${trend.summary.min.toFixed(3)} | Max = ${trend.summary.max.toFixed(3)} | SD = ${trend.summary.stdDev.toFixed(3)}`,
    `OLS Regression: Slope = ${trend.linearRegression.slopePerYear.toFixed(5)} ${provenance.units}/yr | 95% CI [${trend.linearRegression.ci95LowPerYear.toFixed(5)}, ${trend.linearRegression.ci95HighPerYear.toFixed(5)}] | R2 = ${trend.linearRegression.rSquared.toFixed(4)} | t = ${trend.linearRegression.tStatistic.toFixed(3)} | p = ${trend.linearRegression.pValue.toFixed(5)}`,
    `Mann-Kendall: S = ${trend.mannKendall.sStatistic} | Z = ${trend.mannKendall.zStatistic.toFixed(3)} | tau = ${trend.mannKendall.tau.toFixed(4)} | p = ${trend.mannKendall.pValue.toFixed(5)}`,
    `Sen's Slope: ${trend.sensSlope.slopePerYear.toFixed(5)} ${provenance.units}/yr (95% CI [${trend.sensSlope.ci95LowPerYear.toFixed(5)}, ${trend.sensSlope.ci95HighPerYear.toFixed(5)}])`,
    `Seasonal Mann-Kendall: ${trend.seasonalMannKendall.applicable ? `S = ${trend.seasonalMannKendall.sStatistic}, Z = ${trend.seasonalMannKendall.zStatistic.toFixed(3)}, p = ${trend.seasonalMannKendall.pValue.toFixed(5)}` : trend.seasonalMannKendall.note}`,
    `Interpretation: ${trend.classificationExplanation}`,
  ];
  for (const line of statLines) {
    const wrapped = doc.splitTextToSize(line, contentWidth);
    ensureSpace(wrapped.length * 4 + 1);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4 + 0.8;
  }
  y += 3;

  // Anomalies
  ensureSpace(24);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.text(`4. Environmental Anomalies (${anomalies.method}, >= ${anomalies.threshold} sigma)`, margin, y);
  y += 5;
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  if (anomalies.anomalies.length === 0) {
    doc.text('No observations exceeded the anomaly detection threshold.', margin, y);
    y += 5;
  } else {
    for (const a of anomalies.anomalies.slice(0, 10)) {
      const line = `${a.date} | Obs: ${a.observed.toFixed(3)} | Base: ${a.expectedBaseline.toFixed(3)} | z=${a.zScore.toFixed(2)} (${a.severity}) — ${a.explanation}`;
      const wrapped = doc.splitTextToSize(line, contentWidth);
      ensureSpace(wrapped.length * 3.8 + 1);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 3.8 + 0.6;
    }
  }
  y += 3;

  // Scientific Explanation & Limitations
  ensureSpace(26);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.text('5. Scientific Explanation & Limitations', margin, y);
  y += 5;
  doc.setFontSize(8.3);
  doc.setTextColor(51, 65, 85);
  const expText = aiSummary || trend.classificationExplanation;
  for (const line of [expText, ...trend.limitations]) {
    const wrapped = doc.splitTextToSize(line, contentWidth);
    ensureSpace(wrapped.length * 3.8 + 1);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 3.8 + 0.8;
  }

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
