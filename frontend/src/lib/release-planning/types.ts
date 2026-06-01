export type ReleaseStageId = "docs" | "test" | "stage" | "prod" | "demo" | "leadership";

export type ReleaseType = "major" | "minor" | "hotfix" | "patch" | "other";

export type PlannerConfidence = "high" | "medium" | "low";

export type PlannerRiskLevel = "low" | "medium" | "high";

/** Future: deploy wait, freeze, single QA, external dep, unstable stage — MVP returns empty. */
export type OperationalBottleneckHint = {
  kind: string;
  severity: "info" | "warn" | "high";
  narrative: string;
};

export type ReleasePlannerInput = {
  specDraft: string;
  atrText: string;
  qaEstimateHours: number;
  qaCount: number;
  effectiveHoursPerQaPerDay: number;
  /** ISO date YYYY-MM-DD */
  testStartDate: string;
  demoDate: string | null;
  freezeDate: string | null;
  releaseType: ReleaseType;
  legacy: boolean;
  newIntegration: boolean;
  parallelReleasesHigh: boolean;
  externalDependency: boolean;
  extraRisksText: string;
  stageHours: Record<ReleaseStageId, number>;
};

export type RiskBufferRow = {
  id: string;
  label: string;
  active: boolean;
  days: number;
};

export type PlannerWarning = {
  severity: "warn" | "error";
  code: string;
  message: string;
};

export type StageAllocationRow = {
  id: ReleaseStageId;
  label: string;
  hours: number;
  /** null if total QA hours is 0 */
  percent: number | null;
  workDays: number;
};

export type TimelineSegment = {
  stageId: ReleaseStageId;
  label: string;
  startDate: string;
  endDate: string;
};

export type PlannerNarratives = {
  lead: string;
  durationBullets: string[];
  longestPhaseBullets: string[];
  riskBullets: string[];
  confidenceBullets: string[];
  capacityBullets: string[];
};

export type PlannerResult = {
  capacityPerDay: number;
  minimalWorkDays: number;
  operationalBufferDays: number;
  riskBufferRows: RiskBufferRow[];
  riskBufferTotal: number;
  realisticWorkDays: number;
  stageRows: StageAllocationRow[];
  longestPhase: { id: ReleaseStageId; label: string; workDays: number } | null;
  minimalEndDate: string | null;
  realisticEndDate: string | null;
  demoFit: "na" | "likely" | "tight" | "miss";
  demoFitLabel: string;
  riskLevel: PlannerRiskLevel;
  confidence: PlannerConfidence;
  confidenceReasons: string[];
  riskReasons: string[];
  warnings: PlannerWarning[];
  narratives: PlannerNarratives;
  timelineSegments: TimelineSegment[];
  /** Календарный span для суммарного риск-буфера после последнего этапа (null если буфер 0). */
  riskBufferSpan: { startDate: string; endDate: string } | null;
  /** Extension hook for future bottleneck detection (MVP: []). */
  operationalBottleneckHints: OperationalBottleneckHint[];
};
