import type {
  AnomalyAnalysisResult,
  AnomalyMethod,
  AnomalyRecord,
  ComparisonResult,
  ForecastPoint,
  ForecastResult,
  GeoRegion,
  ObservationPoint,
  RegressionPoint,
  SeasonalSummary,
  TrendAnalysisResult,
  TrendClassification,
  YearOverYearPoint,
} from '../../src/types/aethryx.ts';

// --- Mathematical Distribution Helpers ---

export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const prob =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - prob : prob;
}

export function twoTailedNormalPValue(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
}

function logGamma(z: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.001208650973866179, -0.000005395239384953,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function twoTailedStudentTPValue(tStat: number, df: number): number {
  if (!Number.isFinite(tStat) || df <= 0) return 1;
  const x = df / (df + tStat * tStat);
  return Math.min(1, Math.max(0, incompleteBeta(df / 2, 0.5, x)));
}

export function studentTCritical95(df: number): number {
  if (df <= 0) return 1.96;
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131,
    16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
    25: 2.06, 30: 2.042, 40: 2.021, 60: 2.0, 120: 1.98,
  };
  if (table[df]) return table[df];
  if (df > 120) return 1.96;
  // Linear interpolation between closest table keys
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    if (df >= keys[i] && df <= keys[i + 1]) {
      const frac = (df - keys[i]) / (keys[i + 1] - keys[i]);
      return table[keys[i]] + frac * (table[keys[i + 1]] - table[keys[i]]);
    }
  }
  return 1.96;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function dateToDecimalYear(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  const year = parts[0] || 2000;
  const month = parts[1] || 1;
  const day = parts[2] || 15;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return year + (current - start) / (end - start);
}

// --- Mann-Kendall Core Calculation ---

function computeMannKendallCore(values: number[]): {
  s: number;
  varS: number;
  z: number;
  pValue: number;
  tau: number;
} {
  const n = values.length;
  if (n < 3) {
    return { s: 0, varS: 0, z: 0, pValue: 1, tau: 0 };
  }

  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i];
      if (diff > 0) s += 1;
      else if (diff < 0) s -= 1;
    }
  }

  // Tie group correction
  const tieCounts = new Map<number, number>();
  for (const v of values) {
    const rounded = Number(v.toFixed(8));
    tieCounts.set(rounded, (tieCounts.get(rounded) || 0) + 1);
  }
  let tieTerm = 0;
  for (const t of tieCounts.values()) {
    if (t > 1) {
      tieTerm += t * (t - 1) * (2 * t + 5);
    }
  }

  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  let z = 0;
  if (varS > 0) {
    if (s > 0) z = (s - 1) / Math.sqrt(varS);
    else if (s < 0) z = (s + 1) / Math.sqrt(varS);
  }
  const pValue = twoTailedNormalPValue(z);
  const totalPairs = (n * (n - 1)) / 2;
  const tau = totalPairs > 0 ? s / totalPairs : 0;

  return { s, varS, z, pValue, tau };
}

// --- Sen's Slope ---

function computeSensSlope(
  xYears: number[],
  yValues: number[],
  varS: number
): { slopePerYear: number; ci95Low: number; ci95High: number; intercept: number } {
  const n = yValues.length;
  if (n < 2) {
    return { slopePerYear: 0, ci95Low: 0, ci95High: 0, intercept: yValues[0] ?? 0 };
  }

  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dt = xYears[j] - xYears[i];
      if (Math.abs(dt) > 1e-6) {
        slopes.push((yValues[j] - yValues[i]) / dt);
      }
    }
  }
  if (slopes.length === 0) {
    return { slopePerYear: 0, ci95Low: 0, ci95High: 0, intercept: yValues[0] ?? 0 };
  }
  slopes.sort((a, b) => a - b);
  const medianSlope = quantile(slopes, 0.5);

  // 95% confidence interval for Sen's slope (Gilbert 1987)
  const N = slopes.length;
  const cAlpha = 1.959964 * Math.sqrt(Math.max(varS, 1));
  const m1 = Math.max(0, Math.floor((N - cAlpha) / 2));
  const m2 = Math.min(N - 1, Math.ceil((N + cAlpha) / 2) - 1);
  const ci95Low = slopes[m1] ?? medianSlope;
  const ci95High = slopes[m2] ?? medianSlope;

  const residuals = yValues.map((y, idx) => y - medianSlope * xYears[idx]).sort((a, b) => a - b);
  const intercept = quantile(residuals, 0.5);

  return {
    slopePerYear: Number(medianSlope.toFixed(6)),
    ci95Low: Number(ci95Low.toFixed(6)),
    ci95High: Number(ci95High.toFixed(6)),
    intercept: Number(intercept.toFixed(6)),
  };
}

// --- Main Trend Analysis Engine ---

export function analyzeTrend(observations: ObservationPoint[], alpha = 0.05): TrendAnalysisResult {
  const valid = observations
    .filter((o): o is ObservationPoint & { value: number } => o.value !== null && Number.isFinite(o.value))
    .slice()
    .sort((a, b) => a.decimalYear - b.decimalYear);

  const missingCount = observations.length - valid.length;
  const startDate = valid[0]?.date ?? observations[0]?.date ?? '';
  const endDate = valid[valid.length - 1]?.date ?? observations[observations.length - 1]?.date ?? '';

  if (valid.length === 0) {
    return {
      validCount: 0,
      missingCount,
      startDate,
      endDate,
      alpha,
      summary: { mean: 0, median: 0, min: 0, max: 0, stdDev: 0, variance: 0, iqr: 0, q1: 0, q3: 0 },
      linearRegression: {
        slopePerYear: 0,
        slopePerStep: 0,
        intercept: 0,
        rSquared: 0,
        standardError: 0,
        tStatistic: 0,
        pValue: 1,
        ci95LowPerYear: 0,
        ci95HighPerYear: 0,
        totalChangeOverPeriod: 0,
        significant: false,
      },
      mannKendall: {
        sStatistic: 0,
        varS: 0,
        zStatistic: 0,
        pValue: 1,
        tau: 0,
        significant: false,
        method: 'Standard Mann-Kendall (tie-corrected)',
      },
      seasonalMannKendall: {
        sStatistic: 0,
        zStatistic: 0,
        pValue: 1,
        significant: false,
        applicable: false,
        note: 'Insufficient observations for seasonal decomposition.',
      },
      sensSlope: { slopePerYear: 0, ci95LowPerYear: 0, ci95HighPerYear: 0, intercept: 0 },
      autocorrelationLag1: 0,
      classification: 'INSUFFICIENT_EVIDENCE',
      classificationExplanation: 'No valid non-missing observations were retrieved for statistical analysis.',
      regressionSeries: [],
      seasonalCycle: [],
      yearOverYear: [],
      methodologyNotes: ['No valid observations available.'],
      limitations: ['All requested observations were missing or fill values.'],
    };
  }

  const values = valid.map((v) => v.value);
  const xYears = valid.map((v) => v.decimalYear);
  const n = valid.length;

  const sortedVals = values.slice().sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const median = quantile(sortedVals, 0.5);
  const q1 = quantile(sortedVals, 0.25);
  const q3 = quantile(sortedVals, 0.75);
  const iqr = q3 - q1;
  const min = sortedVals[0];
  const max = sortedVals[sortedVals.length - 1];
  const variance = n > 1 ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);

  // OLS Linear Regression against decimalYear
  const xMean = xYears.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xYears[i] - xMean;
    const dy = values[i] - mean;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const slopePerYear = sxx > 1e-12 ? sxy / sxx : 0;
  const intercept = mean - slopePerYear * xMean;
  const stepSpan = n > 1 ? (xYears[n - 1] - xYears[0]) / (n - 1) : 0;
  const slopePerStep = slopePerYear * stepSpan;

  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slopePerYear * xYears[i];
    sse += (values[i] - pred) ** 2;
  }
  const rSquared = syy > 1e-12 ? Math.max(0, Math.min(1, 1 - sse / syy)) : 0;
  const df = Math.max(1, n - 2);
  const residualStdErr = n > 2 ? Math.sqrt(sse / df) : 0;
  const standardError = n > 2 && sxx > 1e-12 ? residualStdErr / Math.sqrt(sxx) : 0;
  const tStatistic = standardError > 1e-12 ? slopePerYear / standardError : 0;
  const olsPValue = n > 2 ? twoTailedStudentTPValue(tStatistic, df) : 1;
  const tCrit = studentTCritical95(df);
  const ci95LowPerYear = slopePerYear - tCrit * standardError;
  const ci95HighPerYear = slopePerYear + tCrit * standardError;
  const spanYears = xYears[n - 1] - xYears[0];
  const totalChangeOverPeriod = slopePerYear * spanYears;

  const regressionSeries: RegressionPoint[] = valid.map((pt) => {
    const fitted = intercept + slopePerYear * pt.decimalYear;
    const margin =
      n > 2 && sxx > 1e-12
        ? tCrit * residualStdErr * Math.sqrt(1 / n + (pt.decimalYear - xMean) ** 2 / sxx)
        : 0;
    return {
      date: pt.date,
      decimalYear: pt.decimalYear,
      fitted: Number(fitted.toFixed(4)),
      ciLow: Number((fitted - margin).toFixed(4)),
      ciHigh: Number((fitted + margin).toFixed(4)),
    };
  });

  // Standard Mann-Kendall
  const mk = computeMannKendallCore(values);

  // Seasonal Mann-Kendall (grouped by month 1..12)
  const byMonth = new Map<number, number[]>();
  for (const pt of valid) {
    const parts = pt.date.split('-');
    if (parts.length >= 2) {
      const m = Number(parts[1]);
      if (m >= 1 && m <= 12) {
        const arr = byMonth.get(m) || [];
        arr.push(pt.value);
        byMonth.set(m, arr);
      }
    }
  }
  let seasonalApplicable = false;
  let sSeasonal = 0;
  let varSeasonal = 0;
  const activeSeasons = Array.from(byMonth.values()).filter((arr) => arr.length >= 3);
  if (activeSeasons.length >= 4 && valid.length >= 24) {
    seasonalApplicable = true;
    for (const seasonVals of activeSeasons) {
      const res = computeMannKendallCore(seasonVals);
      sSeasonal += res.s;
      varSeasonal += res.varS;
    }
  }
  let zSeasonal = 0;
  if (seasonalApplicable && varSeasonal > 0) {
    if (sSeasonal > 0) zSeasonal = (sSeasonal - 1) / Math.sqrt(varSeasonal);
    else if (sSeasonal < 0) zSeasonal = (sSeasonal + 1) / Math.sqrt(varSeasonal);
  }
  const pSeasonal = seasonalApplicable ? twoTailedNormalPValue(zSeasonal) : 1;

  // Sen's Slope
  const sens = computeSensSlope(xYears, values, mk.varS);

  // Lag-1 Autocorrelation on detrended residuals
  const residuals = valid.map((pt) => pt.value - (intercept + slopePerYear * pt.decimalYear));
  let numAc = 0;
  let denAc = 0;
  const resMean = residuals.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) {
    denAc += (residuals[i] - resMean) ** 2;
    if (i > 0) {
      numAc += (residuals[i] - resMean) * (residuals[i - 1] - resMean);
    }
  }
  const autocorrelationLag1 = denAc > 1e-12 ? numAc / denAc : 0;

  // Seasonal Cycle Summary (1..12)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const seasonalCycle: SeasonalSummary[] = [];
  for (let m = 1; m <= 12; m++) {
    const arr = byMonth.get(m);
    if (arr && arr.length > 0) {
      seasonalCycle.push({
        month: m,
        label: monthNames[m - 1],
        mean: Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4)),
        min: Number(Math.min(...arr).toFixed(4)),
        max: Number(Math.max(...arr).toFixed(4)),
        count: arr.length,
      });
    }
  }

  // Year-over-Year aggregation
  const byYear = new Map<number, number[]>();
  for (const pt of valid) {
    const y = Number(pt.date.slice(0, 4));
    if (Number.isFinite(y)) {
      const arr = byYear.get(y) || [];
      arr.push(pt.value);
      byYear.set(y, arr);
    }
  }
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => a - b);
  const yearOverYear: YearOverYearPoint[] = sortedYears.map((y, idx) => {
    const arr = byYear.get(y)!;
    const yrMean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const prevArr = idx > 0 ? byYear.get(sortedYears[idx - 1])! : null;
    const prevMean = prevArr ? prevArr.reduce((a, b) => a + b, 0) / prevArr.length : null;
    return {
      year: y,
      mean: Number(yrMean.toFixed(4)),
      deltaFromPrior: prevMean !== null ? Number((yrMean - prevMean).toFixed(4)) : null,
      count: arr.length,
    };
  });

  // Final Trend Classification
  const primaryP = seasonalApplicable ? pSeasonal : mk.pValue;
  const primarySignificant = primaryP < alpha;
  const directionalSlope = Math.abs(sens.slopePerYear) > 1e-9 ? sens.slopePerYear : slopePerYear;

  let classification: TrendClassification;
  let classificationExplanation: string;

  if (n < 6 || spanYears < 0.25) {
    classification = 'INSUFFICIENT_EVIDENCE';
    classificationExplanation = `Only ${n} valid observations spanning ${spanYears.toFixed(
      2
    )} years were retrieved; at least 6 observations across >= 0.25 years are required for reliable trend inference.`;
  } else if (primarySignificant && directionalSlope > 0) {
    classification = 'INCREASING';
    classificationExplanation = `Statistically significant increasing trend detected at α = ${alpha} (${
      seasonalApplicable ? 'Seasonal Mann-Kendall' : 'Mann-Kendall'
    } p = ${primaryP.toFixed(4)}, Sen's slope = +${sens.slopePerYear.toFixed(4)} / yr).`;
  } else if (primarySignificant && directionalSlope < 0) {
    classification = 'DECREASING';
    classificationExplanation = `Statistically significant decreasing trend detected at α = ${alpha} (${
      seasonalApplicable ? 'Seasonal Mann-Kendall' : 'Mann-Kendall'
    } p = ${primaryP.toFixed(4)}, Sen's slope = ${sens.slopePerYear.toFixed(4)} / yr).`;
  } else {
    classification = 'NO_SIGNIFICANT_TREND';
    classificationExplanation = `No statistically significant monotonic trend detected at α = ${alpha} (${
      seasonalApplicable ? 'Seasonal Mann-Kendall' : 'Mann-Kendall'
    } p = ${primaryP.toFixed(
      4
    )}). Note: failing to reject the null hypothesis does not prove the absence of real environmental variability or change.`;
  }

  const methodologyNotes = [
    'Ordinary Least Squares (OLS) linear regression fitted against decimal year with two-tailed Student-t inference.',
    'Non-parametric Mann-Kendall rank test applied with exact tie-group variance correction.',
    "Theil-Sen median pairwise estimator (Sen's slope) computed for robustness against non-normal residuals and outliers.",
    seasonalApplicable
      ? 'Hirsch-Slack Seasonal Mann-Kendall test applied across calendar months to control for intra-annual seasonality.'
      : 'Seasonal Mann-Kendall omitted because fewer than 24 monthly/sub-annual observations across >= 4 calendar months were present.',
  ];

  const limitations: string[] = [
    'Statistical trend significance indicates monotonic association over the selected time window and does not establish physical causation.',
  ];
  if (missingCount > 0) {
    limitations.push(`${missingCount} missing or fill-value observations were excluded rather than imputed.`);
  }
  if (Math.abs(autocorrelationLag1) > 0.35) {
    limitations.push(
      `Moderate-to-high lag-1 residual autocorrelation (r₁ = ${autocorrelationLag1.toFixed(
        2
      )}) detected; effective degrees of freedom may be smaller than n, which can make unadjusted p-values optimistic.`
    );
  }
  if (spanYears < 10) {
    limitations.push(
      `Analysis span (${spanYears.toFixed(
        1
      )} years) is shorter than a standard 30-year climatological baseline; multi-decadal natural oscillations (e.g., ENSO, IOD) can influence medium-term slopes.`
    );
  }

  return {
    validCount: n,
    missingCount,
    startDate,
    endDate,
    alpha,
    summary: {
      mean: Number(mean.toFixed(4)),
      median: Number(median.toFixed(4)),
      min: Number(min.toFixed(4)),
      max: Number(max.toFixed(4)),
      stdDev: Number(stdDev.toFixed(4)),
      variance: Number(variance.toFixed(4)),
      iqr: Number(iqr.toFixed(4)),
      q1: Number(q1.toFixed(4)),
      q3: Number(q3.toFixed(4)),
    },
    linearRegression: {
      slopePerYear: Number(slopePerYear.toFixed(6)),
      slopePerStep: Number(slopePerStep.toFixed(6)),
      intercept: Number(intercept.toFixed(6)),
      rSquared: Number(rSquared.toFixed(4)),
      standardError: Number(standardError.toFixed(6)),
      tStatistic: Number(tStatistic.toFixed(4)),
      pValue: Number(olsPValue.toFixed(6)),
      ci95LowPerYear: Number(ci95LowPerYear.toFixed(6)),
      ci95HighPerYear: Number(ci95HighPerYear.toFixed(6)),
      totalChangeOverPeriod: Number(totalChangeOverPeriod.toFixed(4)),
      significant: olsPValue < alpha,
    },
    mannKendall: {
      sStatistic: mk.s,
      varS: Number(mk.varS.toFixed(2)),
      zStatistic: Number(mk.z.toFixed(4)),
      pValue: Number(mk.pValue.toFixed(6)),
      tau: Number(mk.tau.toFixed(4)),
      significant: mk.pValue < alpha,
      method: 'Standard Mann-Kendall (tie-corrected)',
    },
    seasonalMannKendall: {
      sStatistic: sSeasonal,
      zStatistic: Number(zSeasonal.toFixed(4)),
      pValue: Number(pSeasonal.toFixed(6)),
      significant: seasonalApplicable && pSeasonal < alpha,
      applicable: seasonalApplicable,
      note: seasonalApplicable
        ? `Evaluated across ${activeSeasons.length} calendar-month strata.`
        : 'Requires >= 24 observations spanning at least 4 calendar months.',
    },
    sensSlope: {
      slopePerYear: sens.slopePerYear,
      ci95LowPerYear: sens.ci95Low,
      ci95HighPerYear: sens.ci95High,
      intercept: sens.intercept,
    },
    autocorrelationLag1: Number(autocorrelationLag1.toFixed(4)),
    classification,
    classificationExplanation,
    regressionSeries,
    seasonalCycle,
    yearOverYear,
    methodologyNotes,
    limitations,
  };
}

// --- Anomaly Detection ---

export function detectAnomalies(
  observations: ObservationPoint[],
  method: AnomalyMethod = 'SEASONAL_DEVIATION',
  threshold = 2.0
): AnomalyAnalysisResult {
  const valid = observations
    .filter((o): o is ObservationPoint & { value: number } => o.value !== null && Number.isFinite(o.value))
    .slice()
    .sort((a, b) => a.decimalYear - b.decimalYear);

  if (valid.length < 4) {
    return {
      method,
      threshold,
      totalChecked: valid.length,
      anomalyCount: 0,
      anomalies: [],
      baselineMean: valid[0]?.value ?? 0,
      baselineStdDev: 0,
      limitations: ['At least 4 valid observations are required to establish a statistical baseline.'],
    };
  }

  const values = valid.map((v) => v.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)) || 1e-6;
  const sorted = values.slice().sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1 || 1e-6;

  // Monthly baseline for seasonal deviation
  const monthStats = new Map<number, { mean: number; std: number; count: number }>();
  const byMonth = new Map<number, number[]>();
  for (const pt of valid) {
    const m = Number(pt.date.split('-')[1] || 0);
    if (m >= 1 && m <= 12) {
      const arr = byMonth.get(m) || [];
      arr.push(pt.value);
      byMonth.set(m, arr);
    }
  }
  for (const [m, arr] of byMonth.entries()) {
    const mMean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const mStd =
      arr.length > 1
        ? Math.sqrt(arr.reduce((a, b) => a + (b - mMean) ** 2, 0) / (arr.length - 1))
        : stdDev;
    monthStats.set(m, { mean: mMean, std: Math.max(mStd, 1e-6), count: arr.length });
  }

  const anomalies: AnomalyRecord[] = [];
  const windowRadius = Math.max(2, Math.min(6, Math.floor(valid.length / 8)));

  for (let i = 0; i < valid.length; i++) {
    const pt = valid[i];
    let baseline = mean;
    let scale = stdDev;
    let zScore = (pt.value - baseline) / scale;
    let flagged = false;
    let reason = '';

    if (method === 'Z_SCORE') {
      flagged = Math.abs(zScore) >= threshold;
      reason = `Observation deviates by ${zScore >= 0 ? '+' : ''}${zScore.toFixed(
        2
      )}σ from the full-period mean (${baseline.toFixed(3)}).`;
    } else if (method === 'IQR') {
      const lowerFence = q1 - 1.5 * iqr;
      const upperFence = q3 + 1.5 * iqr;
      baseline = quantile(sorted, 0.5);
      zScore = (pt.value - baseline) / (iqr / 1.349);
      flagged = pt.value < lowerFence || pt.value > upperFence;
      reason = `Value ${pt.value.toFixed(3)} lies outside Tukey IQR fences [${lowerFence.toFixed(
        3
      )}, ${upperFence.toFixed(3)}].`;
    } else if (method === 'SEASONAL_DEVIATION') {
      const m = Number(pt.date.split('-')[1] || 0);
      const ms = monthStats.get(m);
      if (ms && ms.count >= 2) {
        baseline = ms.mean;
        scale = ms.std;
        zScore = (pt.value - baseline) / scale;
        flagged = Math.abs(zScore) >= threshold;
        reason = `Deviates by ${zScore >= 0 ? '+' : ''}${zScore.toFixed(
          2
        )}σ from the calendar-month climatological baseline (${baseline.toFixed(3)} across ${ms.count} years).`;
      } else {
        zScore = (pt.value - mean) / stdDev;
        flagged = Math.abs(zScore) >= threshold;
        reason = `Insufficient multi-year samples for month ${m}; compared against global period mean (${mean.toFixed(
          3
        )}).`;
      }
    } else if (method === 'MOVING_AVERAGE') {
      const lo = Math.max(0, i - windowRadius);
      const hi = Math.min(valid.length - 1, i + windowRadius);
      const neighborhood = valid.slice(lo, hi + 1).filter((_, idx) => lo + idx !== i).map((p) => p.value);
      baseline = neighborhood.reduce((a, b) => a + b, 0) / Math.max(1, neighborhood.length);
      const localStd =
        neighborhood.length > 1
          ? Math.sqrt(
              neighborhood.reduce((a, b) => a + (b - baseline) ** 2, 0) / (neighborhood.length - 1)
            )
          : stdDev;
      scale = Math.max(localStd, 1e-6);
      zScore = (pt.value - baseline) / scale;
      flagged = Math.abs(zScore) >= threshold;
      reason = `Local spike/dip of ${zScore >= 0 ? '+' : ''}${zScore.toFixed(
        2
      )}σ relative to local ${neighborhood.length}-step neighborhood mean (${baseline.toFixed(3)}).`;
    }

    if (flagged) {
      const absZ = Math.abs(zScore);
      const severity: AnomalyRecord['severity'] =
        absZ >= threshold + 1.2 ? 'EXTREME' : absZ >= threshold + 0.5 ? 'ELEVATED' : 'MODERATE';
      anomalies.push({
        date: pt.date,
        observed: Number(pt.value.toFixed(4)),
        expectedBaseline: Number(baseline.toFixed(4)),
        deviation: Number((pt.value - baseline).toFixed(4)),
        zScore: Number(zScore.toFixed(3)),
        method,
        severity,
        explanation: reason,
      });
    }
  }

  return {
    method,
    threshold,
    totalChecked: valid.length,
    anomalyCount: anomalies.length,
    anomalies: anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)),
    baselineMean: Number(mean.toFixed(4)),
    baselineStdDev: Number(stdDev.toFixed(4)),
    limitations: [
      'Statistical anomalies identify unusual departures relative to historical spread and do not automatically confirm extreme weather events or sensor artifacts without independent meteorological corroboration.',
    ],
  };
}

// --- Forecasting with Holdout Validation ---

export function generateForecast(observations: ObservationPoint[], horizonSteps = 12): ForecastResult {
  const valid = observations
    .filter((o): o is ObservationPoint & { value: number } => o.value !== null && Number.isFinite(o.value))
    .slice()
    .sort((a, b) => a.decimalYear - b.decimalYear);

  if (valid.length < 12) {
    return {
      available: false,
      reasonIfUnavailable: `Forecasting requires at least 12 valid historical observations for trend estimation and out-of-sample holdout validation; only ${valid.length} valid observations are available.`,
      modelName: 'OLS Linear + Seasonal Additive Projection',
      horizonSteps: 0,
      assumptions: [],
      uncertaintyNote: 'Insufficient historical sample size.',
      points: [],
    };
  }

  const n = valid.length;
  const holdoutSize = Math.max(2, Math.min(6, Math.floor(n * 0.2)));
  const train = valid.slice(0, n - holdoutSize);
  const test = valid.slice(n - holdoutSize);

  const fitLinearWithSeasonal = (subset: Array<ObservationPoint & { value: number }>) => {
    const m = subset.length;
    const xMean = subset.reduce((a, p) => a + p.decimalYear, 0) / m;
    const yMean = subset.reduce((a, p) => a + p.value, 0) / m;
    let sxx = 0;
    let sxy = 0;
    for (const p of subset) {
      sxx += (p.decimalYear - xMean) ** 2;
      sxy += (p.decimalYear - xMean) * (p.value - yMean);
    }
    const slope = sxx > 1e-12 ? sxy / sxx : 0;
    const intercept = yMean - slope * xMean;

    // Average seasonal residual by month
    const monthRes = new Map<number, number[]>();
    for (const p of subset) {
      const month = Number(p.date.split('-')[1] || 0);
      if (month >= 1 && month <= 12) {
        const arr = monthRes.get(month) || [];
        arr.push(p.value - (intercept + slope * p.decimalYear));
        monthRes.set(month, arr);
      }
    }
    const seasonalOffset = new Map<number, number>();
    for (const [mo, arr] of monthRes.entries()) {
      if (arr.length >= 2) {
        seasonalOffset.set(mo, arr.reduce((a, b) => a + b, 0) / arr.length);
      }
    }

    const predict = (decimalYear: number, month: number) =>
      intercept + slope * decimalYear + (seasonalOffset.get(month) || 0);

    const sse = subset.reduce((acc, p) => {
      const mo = Number(p.date.split('-')[1] || 0);
      return acc + (p.value - predict(p.decimalYear, mo)) ** 2;
    }, 0);
    const rmseTrain = Math.sqrt(sse / Math.max(1, m - 2));
    return { slope, intercept, seasonalOffset, predict, rmseTrain };
  };

  // Holdout validation
  const trainModel = fitLinearWithSeasonal(train);
  let sqErr = 0;
  let absErr = 0;
  let pctErr = 0;
  let pctCount = 0;
  for (const pt of test) {
    const mo = Number(pt.date.split('-')[1] || 0);
    const pred = trainModel.predict(pt.decimalYear, mo);
    const err = pt.value - pred;
    sqErr += err * err;
    absErr += Math.abs(err);
    if (Math.abs(pt.value) > 1e-6) {
      pctErr += Math.abs(err / pt.value) * 100;
      pctCount += 1;
    }
  }
  const rmse = Math.sqrt(sqErr / test.length);
  const mae = absErr / test.length;
  const mapePercent = pctCount > 0 ? Number((pctErr / pctCount).toFixed(2)) : null;

  // Full-series refit for forward projection
  const fullModel = fitLinearWithSeasonal(valid);
  const last = valid[n - 1];
  const avgDt = (last.decimalYear - valid[0].decimalYear) / Math.max(1, n - 1);
  const isYearly = avgDt > 0.75;
  const isDaily = avgDt < 0.02;

  const points: ForecastPoint[] = [];
  const lastParts = last.date.split('-').map(Number);
  let curDate = new Date(Date.UTC(lastParts[0], (lastParts[1] || 1) - 1, lastParts[2] || 15));

  for (let step = 1; step <= horizonSteps; step++) {
    if (isYearly) {
      curDate = new Date(Date.UTC(lastParts[0] + step, 0, 1));
    } else if (isDaily) {
      curDate = new Date(Date.UTC(lastParts[0], (lastParts[1] || 1) - 1, (lastParts[2] || 15) + step));
    } else {
      curDate = new Date(Date.UTC(lastParts[0], (lastParts[1] || 1) - 1 + step, 1));
    }

    const yyyy = curDate.getUTCFullYear();
    const mm = String(curDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(curDate.getUTCDate()).padStart(2, '0');
    const dateStr = isYearly ? `${yyyy}` : isDaily ? `${yyyy}-${mm}-${dd}` : `${yyyy}-${mm}`;
    const decYr = dateToDecimalYear(dateStr);
    const predicted = fullModel.predict(decYr, curDate.getUTCMonth() + 1);
    const horizonSpread = 1.96 * Math.max(rmse, fullModel.rmseTrain) * Math.sqrt(1 + step / n);

    points.push({
      date: dateStr,
      decimalYear: Number(decYr.toFixed(4)),
      predicted: Number(predicted.toFixed(4)),
      piLow95: Number((predicted - horizonSpread).toFixed(4)),
      piHigh95: Number((predicted + horizonSpread).toFixed(4)),
      isEstimate: true,
    });
  }

  return {
    available: true,
    modelName: 'OLS Linear Trend + Empirical Seasonal Offset (Holdout-Validated)',
    horizonSteps,
    validationMetrics: {
      holdoutPoints: test.length,
      rmse: Number(rmse.toFixed(4)),
      mae: Number(mae.toFixed(4)),
      mapePercent,
    },
    assumptions: [
      'Assumes historical linear rate of change and historical monthly seasonal amplitude continue unchanged over the forecast horizon.',
      'Prediction intervals widen with forecast horizon using out-of-sample holdout RMSE.',
    ],
    uncertaintyNote:
      'ESTIMATED PROJECTION ONLY — NOT NASA OBSERVATIONS. External climate forcing, policy shifts, or nonlinear regime transitions can invalidate linear extrapolations.',
    points,
  };
}

// --- Regional Comparison ---

export function compareRegions(
  regionA: GeoRegion,
  obsA: ObservationPoint[],
  trendA: TrendAnalysisResult,
  unitsA: string,
  variableA: string,
  regionB: GeoRegion,
  obsB: ObservationPoint[],
  trendB: TrendAnalysisResult,
  unitsB: string,
  variableB: string
): ComparisonResult {
  if (variableA !== variableB || unitsA !== unitsB) {
    return {
      compatible: false,
      incompatibilityReason: `Cannot compare incompatible quantities: ${variableA} (${unitsA}) vs ${variableB} (${unitsB}). Select the same variable and units for both regions.`,
      caveats: [],
      regionA: {
        region: regionA,
        mean: trendA.summary.mean,
        slopePerYear: trendA.sensSlope.slopePerYear,
        pValue: trendA.mannKendall.pValue,
        classification: trendA.classification,
        validCount: trendA.validCount,
        observations: obsA,
      },
      regionB: {
        region: regionB,
        mean: trendB.summary.mean,
        slopePerYear: trendB.sensSlope.slopePerYear,
        pValue: trendB.mannKendall.pValue,
        classification: trendB.classification,
        validCount: trendB.validCount,
        observations: obsB,
      },
      overlappingPoints: 0,
      pearsonCorrelation: null,
      meanDifference: 0,
      slopeDifferencePerYear: 0,
    };
  }

  const mapA = new Map<string, number>();
  for (const o of obsA) {
    if (o.value !== null && Number.isFinite(o.value)) mapA.set(o.date, o.value);
  }
  const pairedA: number[] = [];
  const pairedB: number[] = [];
  for (const o of obsB) {
    if (o.value !== null && Number.isFinite(o.value) && mapA.has(o.date)) {
      pairedA.push(mapA.get(o.date)!);
      pairedB.push(o.value);
    }
  }

  let pearsonCorrelation: number | null = null;
  if (pairedA.length >= 3) {
    const mA = pairedA.reduce((a, b) => a + b, 0) / pairedA.length;
    const mB = pairedB.reduce((a, b) => a + b, 0) / pairedB.length;
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < pairedA.length; i++) {
      const da = pairedA[i] - mA;
      const db = pairedB[i] - mB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    if (denA > 1e-12 && denB > 1e-12) {
      pearsonCorrelation = Number((num / Math.sqrt(denA * denB)).toFixed(4));
    }
  }

  return {
    compatible: true,
    caveats: [
      'Cross-regional correlation measures co-variation across overlapping timestamps and does not imply physical teleconnection or causation.',
      'Local microclimate, elevation, and land-ocean grid cell fractions may differ between compared coordinates.',
    ],
    regionA: {
      region: regionA,
      mean: trendA.summary.mean,
      slopePerYear: trendA.sensSlope.slopePerYear,
      pValue: trendA.mannKendall.pValue,
      classification: trendA.classification,
      validCount: trendA.validCount,
      observations: obsA,
    },
    regionB: {
      region: regionB,
      mean: trendB.summary.mean,
      slopePerYear: trendB.sensSlope.slopePerYear,
      pValue: trendB.mannKendall.pValue,
      classification: trendB.classification,
      validCount: trendB.validCount,
      observations: obsB,
    },
    overlappingPoints: pairedA.length,
    pearsonCorrelation,
    meanDifference: Number((trendA.summary.mean - trendB.summary.mean).toFixed(4)),
    slopeDifferencePerYear: Number((trendA.sensSlope.slopePerYear - trendB.sensSlope.slopePerYear).toFixed(6)),
  };
}
