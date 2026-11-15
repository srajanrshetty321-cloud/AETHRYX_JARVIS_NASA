import { GoogleGenAI } from '@google/genai';
import type { FullAnalysisBundle } from '../../src/types/aethryx.ts';

let cachedClient: GoogleGenAI | null = null;

function isConfiguredApiKey(key: string | undefined): key is string {
  return Boolean(key && key.trim().length > 12 && key.trim() !== 'MY_GEMINI_API_KEY');
}

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!isConfiguredApiKey(key)) return null;
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export function getGeminiStatus() {
  const configured = isConfiguredApiKey(process.env.GEMINI_API_KEY);
  return {
    configured,
    model: 'gemini-4-hydrogen',
    status: configured ? 'CONNECTED' : 'UNCONFIGURED_FALLBACK_ACTIVE',
    note: configured
      ? 'Server-side Gemini API key detected.'
      : 'GEMINI_API_KEY not configured; deterministic evidence-grounded scientific fallback is active.',
  };
}

function buildEvidenceContext(analysis: FullAnalysisBundle | null | undefined): string {
  if (!analysis) {
    return 'NO_ANALYSIS_LOADED: No regional dataset has been retrieved or selected in the active workspace.';
  }
  const { region, provenance, trend, anomalies, forecast } = analysis;
  return JSON.stringify(
    {
      region: {
        name: region.name,
        lat: region.lat,
        lon: region.lon,
        country: region.country,
        isOcean: region.isOcean,
      },
      provenance: {
        datasetId: provenance.datasetId,
        officialDatasetName: provenance.officialDatasetName,
        productId: provenance.productId,
        nasaSource: provenance.nasaSource,
        variable: provenance.variable,
        variableName: provenance.variableName,
        units: provenance.units,
        dataMode: provenance.dataMode,
        selectedRange: `${provenance.selectedStartDate} to ${provenance.selectedEndDate}`,
        actualRange: `${provenance.actualStartDate} to ${provenance.actualEndDate}`,
        aggregation: provenance.aggregation,
        validObservations: provenance.validObservationCount,
        missingObservations: provenance.missingDataCount,
        spatialAveraging: provenance.spatialAveragingMethod,
        retrievalTimestamp: provenance.retrievalTimestamp,
        warnings: provenance.warnings,
      },
      statistics: {
        summary: trend.summary,
        classification: trend.classification,
        classificationExplanation: trend.classificationExplanation,
        linearRegression: {
          slopePerYear: trend.linearRegression.slopePerYear,
          ci95LowPerYear: trend.linearRegression.ci95LowPerYear,
          ci95HighPerYear: trend.linearRegression.ci95HighPerYear,
          rSquared: trend.linearRegression.rSquared,
          tStatistic: trend.linearRegression.tStatistic,
          pValue: trend.linearRegression.pValue,
          totalChangeOverPeriod: trend.linearRegression.totalChangeOverPeriod,
        },
        mannKendall: trend.mannKendall,
        seasonalMannKendall: trend.seasonalMannKendall,
        sensSlope: trend.sensSlope,
        autocorrelationLag1: trend.autocorrelationLag1,
        limitations: trend.limitations,
      },
      anomalies: {
        method: anomalies.method,
        threshold: anomalies.threshold,
        anomalyCount: anomalies.anomalyCount,
        topAnomalies: anomalies.anomalies.slice(0, 5),
      },
      forecast: forecast.available
        ? {
            modelName: forecast.modelName,
            validationMetrics: forecast.validationMetrics,
            horizonSteps: forecast.horizonSteps,
            note: forecast.uncertaintyNote,
          }
        : { available: false, reason: forecast.reasonIfUnavailable },
    },
    null,
    2
  );
}

function buildDeterministicFallbackAnswer(
  question: string,
  analysis: FullAnalysisBundle | null | undefined
): { answer: string; citedDataset?: string } {
  const q = question.toLowerCase();

  if (q.includes('soil moisture')) {
    return {
      answer:
        'For soil moisture investigation, NASA GLDAS Noah Land Surface Model L4 Monthly (GLDAS_NOAH025_M.2.1, 0.25° × 0.25°, variable SoilMoi0_10cm_inst in kg/m², 2000–present) provides top 0–10 cm soil water content over terrestrial regions. For immediate public access without an Earthdata token, NASA POWER also provides Surface Soil Wetness (GWETTOP, 0–1 saturation fraction) assimilated from MERRA-2.',
      citedDataset: 'GLDAS_NOAH025_M.2.1 / NASA-POWER (GWETTOP)',
    };
  }

  if (q.includes('mann-kendall') || q.includes('mann kendall') || q.includes("sen's slope")) {
    const extra = analysis
      ? ` In your current analysis (${analysis.region.name}, ${analysis.provenance.variableName}), Mann-Kendall S = ${analysis.trend.mannKendall.sStatistic}, Z = ${analysis.trend.mannKendall.zStatistic.toFixed(3)}, p = ${analysis.trend.mannKendall.pValue.toFixed(4)}, and Sen's slope = ${analysis.trend.sensSlope.slopePerYear.toFixed(4)} ${analysis.provenance.units}/year.`
      : '';
    return {
      answer:
        `The Mann-Kendall test is a non-parametric rank test that checks whether values consistently increase or decrease over time without assuming a normal distribution. Sen's slope estimates the median rate of change per year across all observation pairs, making it resilient to extreme outliers.${extra}`,
      citedDataset: analysis?.provenance.productId,
    };
  }

  if (!analysis) {
    return {
      answer:
        'I do not have any regional NASA measurements currently loaded in your workspace. Select a location in Earth Explorer or Data Laboratory and run an analysis (or ask me, for example: "AETHRYX, analyse rainfall trends in Shivamogga") so I can interpret the actual retrieved observations, Mann-Kendall statistics, and anomalies.',
    };
  }

  const { region, provenance, trend, anomalies } = analysis;
  const modeNote =
    provenance.dataMode === 'DEMO'
      ? ' [NOTE: Active dataset is SIMULATED DEMO DATA, not live NASA observations.]'
      : '';
  const answer = [
    `Observed Facts (${region.name} · ${region.lat.toFixed(3)}°, ${region.lon.toFixed(3)}°)${modeNote}:`,
    `• Source: ${provenance.officialDatasetName} (${provenance.productId}) — Variable: ${provenance.variableName} (${provenance.units}).`,
    `• Coverage: ${provenance.actualStartDate ?? provenance.selectedStartDate} to ${
      provenance.actualEndDate ?? provenance.selectedEndDate
    } (${provenance.validObservationCount} valid observations, ${provenance.missingDataCount} missing).`,
    `• Summary: Mean = ${trend.summary.mean.toFixed(3)} ${provenance.units}, Min = ${trend.summary.min.toFixed(
      3
    )}, Max = ${trend.summary.max.toFixed(3)}, SD = ${trend.summary.stdDev.toFixed(3)}.`,
    `• Trend Result (${trend.classification}): OLS slope = ${trend.linearRegression.slopePerYear.toFixed(
      4
    )} ${provenance.units}/yr (95% CI [${trend.linearRegression.ci95LowPerYear.toFixed(
      4
    )}, ${trend.linearRegression.ci95HighPerYear.toFixed(4)}], R² = ${trend.linearRegression.rSquared.toFixed(
      3
    )}, p = ${trend.linearRegression.pValue.toFixed(4)}). Mann-Kendall p = ${trend.mannKendall.pValue.toFixed(
      4
    )}; Sen's slope = ${trend.sensSlope.slopePerYear.toFixed(4)} ${provenance.units}/yr.`,
    `• Anomalies: ${anomalies.anomalyCount} flagged using ${anomalies.method} (threshold ${anomalies.threshold}σ).`,
    `Interpretation & Limitations: ${trend.classificationExplanation} ${trend.limitations[0] || ''}`,
  ].join('\n');

  return { answer, citedDataset: `${provenance.officialDatasetName} (${provenance.productId})` };
}

export async function askAethryxAssistant(params: {
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  analysis?: FullAnalysisBundle | null;
}): Promise<{
  answer: string;
  mode: 'GEMINI_LIVE' | 'SCIENTIFIC_FALLBACK';
  citedDataset?: string;
}> {
  const client = getGeminiClient();
  if (!client) {
    const fb = buildDeterministicFallbackAnswer(params.question, params.analysis);
    return {
      answer: fb.answer,
      mode: 'SCIENTIFIC_FALLBACK',
      citedDataset: fb.citedDataset,
    };
  }

  const evidence = buildEvidenceContext(params.analysis);
  const systemInstruction = [
    'You are AETHRYX JARVIS — Your Earth Intelligence Assistant, built for the NASA Space Apps Challenge 2026 ("Be An Earth System Trend Detective!").',
    'STRICT SCIENTIFIC INTEGRITY RULES:',
    '1. Ground every numerical claim strictly in the PROVIDED_ANALYSIS_CONTEXT JSON below. NEVER invent measurements, coordinates, p-values, or dates.',
    '2. Explicitly separate "Observed Facts" (dataset name, product ID, units, sample size, missing observations, statistical values) from "Scientific Interpretation & Limitations".',
    '3. If PROVIDED_ANALYSIS_CONTEXT says NO_ANALYSIS_LOADED and the user asks about current regional measurements, state clearly that no regional measurements are currently loaded and explain how to retrieve them (you can still answer general Earth-science methodology and NASA dataset selection questions).',
    '4. If provenance.dataMode is DEMO, prominently state that the active series is a simulated demonstration reference rather than live NASA satellite/reanalysis data.',
    '5. Never claim correlation establishes causation, and never treat a non-significant trend (p >= 0.05) as proof that no physical change exists.',
    '6. Keep explanations crisp, clear, and accessible for both researchers and students (~150-280 words unless deeper detail is requested).',
    '',
    'PROVIDED_ANALYSIS_CONTEXT:',
    evidence,
  ].join('\n');

  const conversationSnippet = (params.history || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = conversationSnippet
    ? `Recent conversation:\n${conversationSnippet}\n\nCurrent question: ${params.question}`
    : params.question;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
      },
    });
    const text = response.text?.trim();
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }
    return {
      answer: text,
      mode: 'GEMINI_LIVE',
      citedDataset: params.analysis
        ? `${params.analysis.provenance.officialDatasetName} (${params.analysis.provenance.productId})`
        : undefined,
    };
  } catch (err) {
    const fb = buildDeterministicFallbackAnswer(params.question, params.analysis);
    const errMsg = err instanceof Error ? err.message : 'Gemini API call failed';
    return {
      answer: `${fb.answer}\n\n[Fallback notice: Live Gemini response unavailable — ${errMsg}]`,
      mode: 'SCIENTIFIC_FALLBACK',
      citedDataset: fb.citedDataset,
    };
  }
}
