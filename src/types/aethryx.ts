export type DatasetId =
  | 'NASA-POWER'
  | 'MERRA2'
  | 'GPM-IMERG'
  | 'MODIS'
  | 'AIRS'
  | 'OMI'
  | 'GLDAS';

export type DataMode = 'LIVE' | 'DEMO';

export type AggregationPeriod = 'daily' | 'monthly' | 'yearly';

export type ConnectorStatus =
  | 'LIVE'
  | 'METADATA_ONLY_AUTH_REQUIRED'
  | 'UNAVAILABLE'
  | 'RATE_LIMITED';

export type TrendClassification =
  | 'INCREASING'
  | 'DECREASING'
  | 'NO_SIGNIFICANT_TREND'
  | 'INSUFFICIENT_EVIDENCE';

export interface GeoBoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoRegion {
  id?: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  bbox?: GeoBoundingBox;
  polygon?: GeoPoint[];
  country?: string;
  regionType?: string;
  isOcean?: boolean;
  source?: string;
}

export interface VariableDefinition {
  id: string;
  name: string;
  shortLabel: string;
  units: string;
  description: string;
  category:
    | 'temperature'
    | 'precipitation'
    | 'vegetation'
    | 'humidity'
    | 'wind'
    | 'land_surface'
    | 'atmosphere';
  supportedAggregations: AggregationPeriod[];
}

export interface DatasetCatalogEntry {
  id: DatasetId;
  officialName: string;
  productId: string;
  version: string;
  nasaSource: string;
  sourceUrl: string;
  apiEndpoint: string;
  cmrShortName: string;
  spatialResolution: string;
  temporalResolution: string;
  historicalStart: string;
  historicalEnd: string;
  latBounds: [number, number];
  lonBounds: [number, number];
  landOnly: boolean;
  authRequiredForData: boolean;
  authMethod: string;
  variables: VariableDefinition[];
  processingNotes: string;
}

export interface DatasetStatusReport {
  id: DatasetId;
  officialName: string;
  productId: string;
  nasaSource: string;
  connectorStatus: ConnectorStatus;
  metadataStatus: 'LIVE' | 'ERROR';
  dataRetrievalStatus: 'LIVE' | 'AUTH_REQUIRED' | 'ERROR';
  reason: string;
  latencyMs: number;
  cmrCollectionTitle?: string;
  cmrGranuleCount?: number;
  checkedAt: string;
  authConfigured: boolean;
}

export interface ObservationPoint {
  date: string; // YYYY-MM-DD or YYYY-MM or YYYY
  decimalYear: number;
  value: number | null;
  rawFill?: boolean;
  gridCount?: number;
}

export interface DataProvenance {
  datasetId: DatasetId;
  officialDatasetName: string;
  productId: string;
  version: string;
  nasaSource: string;
  sourceUrl: string;
  apiEndpoint: string;
  variable: string;
  variableName: string;
  units: string;
  spatialResolution: string;
  temporalResolution: string;
  historicalCoverage: string;
  selectedStartDate: string;
  selectedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  aggregation: AggregationPeriod;
  spatialAveragingMethod: string;
  retrievalTimestamp: string;
  dataMode: DataMode;
  authRequired: boolean;
  missingDataCount: number;
  validObservationCount: number;
  totalRequestedSteps: number;
  missingDataHandling: string;
  cmrGranuleCount?: number;
  warnings: string[];
}

export interface RegressionPoint {
  date: string;
  decimalYear: number;
  fitted: number;
  ciLow: number;
  ciHigh: number;
}

export interface SeasonalSummary {
  month: number;
  label: string;
  mean: number;
  min: number;
  max: number;
  count: number;
}

export interface YearOverYearPoint {
  year: number;
  mean: number;
  deltaFromPrior: number | null;
  count: number;
}

export interface TrendAnalysisResult {
  validCount: number;
  missingCount: number;
  startDate: string;
  endDate: string;
  alpha: number;
  summary: {
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
    variance: number;
    iqr: number;
    q1: number;
    q3: number;
  };
  linearRegression: {
    slopePerYear: number;
    slopePerStep: number;
    intercept: number;
    rSquared: number;
    standardError: number;
    tStatistic: number;
    pValue: number;
    ci95LowPerYear: number;
    ci95HighPerYear: number;
    totalChangeOverPeriod: number;
    significant: boolean;
  };
  mannKendall: {
    sStatistic: number;
    varS: number;
    zStatistic: number;
    pValue: number;
    tau: number;
    significant: boolean;
    method: string;
  };
  seasonalMannKendall: {
    sStatistic: number;
    zStatistic: number;
    pValue: number;
    significant: boolean;
    applicable: boolean;
    note: string;
  };
  sensSlope: {
    slopePerYear: number;
    ci95LowPerYear: number;
    ci95HighPerYear: number;
    intercept: number;
  };
  autocorrelationLag1: number;
  classification: TrendClassification;
  classificationExplanation: string;
  regressionSeries: RegressionPoint[];
  seasonalCycle: SeasonalSummary[];
  yearOverYear: YearOverYearPoint[];
  methodologyNotes: string[];
  limitations: string[];
}

export type AnomalyMethod = 'Z_SCORE' | 'IQR' | 'SEASONAL_DEVIATION' | 'MOVING_AVERAGE';

export interface AnomalyRecord {
  date: string;
  observed: number;
  expectedBaseline: number;
  deviation: number;
  zScore: number;
  method: AnomalyMethod;
  severity: 'MODERATE' | 'ELEVATED' | 'EXTREME';
  explanation: string;
}

export interface AnomalyAnalysisResult {
  method: AnomalyMethod;
  threshold: number;
  totalChecked: number;
  anomalyCount: number;
  anomalies: AnomalyRecord[];
  baselineMean: number;
  baselineStdDev: number;
  limitations: string[];
}

export interface ForecastPoint {
  date: string;
  decimalYear: number;
  predicted: number;
  piLow95: number;
  piHigh95: number;
  isEstimate: true;
}

export interface ForecastResult {
  available: boolean;
  reasonIfUnavailable?: string;
  modelName: string;
  horizonSteps: number;
  validationMetrics?: {
    holdoutPoints: number;
    rmse: number;
    mae: number;
    mapePercent: number | null;
  };
  assumptions: string[];
  uncertaintyNote: string;
  points: ForecastPoint[];
}

export interface FullAnalysisBundle {
  id?: string;
  region: GeoRegion;
  provenance: DataProvenance;
  observations: ObservationPoint[];
  trend: TrendAnalysisResult;
  anomalies: AnomalyAnalysisResult;
  forecast: ForecastResult;
  createdAt?: string;
}

export interface ComparisonResult {
  compatible: boolean;
  incompatibilityReason?: string;
  caveats: string[];
  regionA: {
    region: GeoRegion;
    mean: number;
    slopePerYear: number;
    pValue: number;
    classification: TrendClassification;
    validCount: number;
    observations: ObservationPoint[];
  };
  regionB: {
    region: GeoRegion;
    mean: number;
    slopePerYear: number;
    pValue: number;
    classification: TrendClassification;
    validCount: number;
    observations: ObservationPoint[];
  };
  overlappingPoints: number;
  pearsonCorrelation: number | null;
  meanDifference: number;
  slopeDifferencePerYear: number;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  mode?: 'GEMINI_LIVE' | 'SCIENTIFIC_FALLBACK';
  citedDataset?: string;
  actionTriggered?: {
    type: 'RUN_ANALYSIS' | 'SWITCH_REGION' | 'EXPLAIN_METHOD';
    summary: string;
  };
}

export interface NasaImageItem {
  nasaId: string;
  title: string;
  description: string;
  dateCreated: string;
  center: string;
  photographer?: string;
  keywords: string[];
  thumbnailUrl: string;
  sourcePageUrl: string;
  mediaType: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: string;
  hasEarthdataToken: boolean;
  preferences: {
    preferredVoiceUri?: string;
    speechRate: number;
    autoSpeakResponses: boolean;
    defaultDataMode: DataMode;
    defaultAggregation: AggregationPeriod;
  };
  createdAt: string;
}

export interface SavedAnalysisSummary {
  id: string;
  regionName: string;
  lat: number;
  lon: number;
  datasetId: DatasetId;
  variable: string;
  units: string;
  startDate: string;
  endDate: string;
  dataMode: DataMode;
  classification: TrendClassification;
  slopePerYear: number;
  pValue: number;
  createdAt: string;
}
