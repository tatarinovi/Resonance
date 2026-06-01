import {
  DEFAULT_OPERATIONAL_BUFFER_DAYS,
  MIN_REGRESSION_TO_DEMO_BUSINESS_DAYS,
  RISK_BUFFER_RULES,
  STAGE_IDS_MIN_ONE_DAY_PER_PLATFORM,
  STAGE_LABELS,
  STAGE_ORDER,
} from "./config";
import type {
  PlannerResult,
  ReleasePlannerInput,
  ReleaseStageId,
  StageAllocationRow,
  TimelineSegment,
} from "./types";

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Monday–Friday; Sat/Sun skipped when advancing. */
export function isWeekendUtc(d: Date): boolean {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

/** Move to next weekday if weekend. */
function toNextWeekdayUtc(d: Date): Date {
  const x = new Date(d);
  while (isWeekendUtc(x)) {
    x.setUTCDate(x.getUTCDate() + 1);
  }
  return x;
}

/**
 * Inclusive start: first day counts as workday 1.
 * Returns the date of the last workday when spanning `workingDays` business days (>=1).
 */
export function addBusinessDaysInclusive(start: Date, workingDays: number): Date {
  if (workingDays < 1) return toNextWeekdayUtc(new Date(start));
  let cur = toNextWeekdayUtc(new Date(start));
  let left = workingDays;
  while (left > 1) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (!isWeekendUtc(cur)) left -= 1;
  }
  return cur;
}

/** Business days from a to b inclusive (a,b are calendar dates); returns null if invalid. */
export function businessDaysInclusiveBetween(a: Date, b: Date): number | null {
  if (b.getTime() < a.getTime()) return null;
  let cur = toNextWeekdayUtc(new Date(a));
  const end = toNextWeekdayUtc(new Date(b));
  let n = 0;
  const guard = 100_000;
  let i = 0;
  while (cur.getTime() <= end.getTime() && i++ < guard) {
    if (!isWeekendUtc(cur)) n += 1;
    if (formatYmd(cur) === formatYmd(end)) break;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

function sumStageHours(input: ReleasePlannerInput): number {
  return STAGE_ORDER.reduce((s, id) => s + Math.max(0, input.stageHours[id] ?? 0), 0);
}

function ceilStageWorkDays(hours: number, capacityPerDay: number, stageId: ReleaseStageId): number {
  /** Документация готовится до старта тестирования — в календарном прогнозе от даты старта теста не учитываем. */
  if (stageId === "docs") return 0;
  if (hours <= 0) return 0;
  const platform = STAGE_IDS_MIN_ONE_DAY_PER_PLATFORM.includes(stageId);
  if (capacityPerDay <= 0) {
    return platform ? 1 : 0;
  }
  const raw = Math.ceil(hours / capacityPerDay);
  return platform ? Math.max(1, raw) : raw;
}

function buildStageRows(input: ReleasePlannerInput, capacityPerDay: number): StageAllocationRow[] {
  const total = sumStageHours(input);
  const cap = capacityPerDay > 0 ? capacityPerDay : 0;
  return STAGE_ORDER.map((id) => {
    const h = Math.max(0, input.stageHours[id] ?? 0);
    const pct = total > 0 ? Math.round((h / total) * 1000) / 10 : null;
    return {
      id,
      label: STAGE_LABELS[id],
      hours: h,
      percent: pct,
      workDays: ceilStageWorkDays(h, cap, id),
    };
  });
}

function computeDemoFit(
  realisticEnd: Date | null,
  demo: Date | null,
): { demoFit: PlannerResult["demoFit"]; demoFitLabel: string } {
  if (!demo || !realisticEnd) {
    return { demoFit: "na", demoFitLabel: "Демо не задано" };
  }
  const end = toNextWeekdayUtc(realisticEnd);
  const demoD = toNextWeekdayUtc(demo);
  if (end.getTime() <= demoD.getTime()) {
    const slack = businessDaysInclusiveBetween(end, demoD) ?? 0;
    if (slack >= 5) return { demoFit: "likely", demoFitLabel: "Укладываемся в демо с запасом" };
    if (slack >= 2) return { demoFit: "likely", demoFitLabel: "Укладываемся в демо" };
    return { demoFit: "tight", demoFitLabel: "Укладываемся впритык к демо" };
  }
  return { demoFit: "miss", demoFitLabel: "Реалистичный прогноз позже демо" };
}

function computeRiskLevel(
  input: ReleasePlannerInput,
  demoFit: PlannerResult["demoFit"],
  capacityPerDay: number,
): { riskLevel: PlannerResult["riskLevel"]; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (input.legacy) {
    score += 1;
    reasons.push("затронуты унаследованные системы");
  }
  if (input.newIntegration) {
    score += 1;
    reasons.push("новая интеграция");
  }
  if (demoFit === "miss") {
    score += 2;
    reasons.push("прогноз завершения позже даты демо");
  } else if (demoFit === "tight") {
    score += 1;
    reasons.push("мало запаса до демо");
  }
  if (input.qaCount <= 1 && input.qaEstimateHours >= 40) {
    score += 1;
    reasons.push("один тестировщик при крупной оценке");
  }
  if (capacityPerDay > 0 && input.qaEstimateHours / capacityPerDay >= 12) {
    score += 1;
    reasons.push("длительный цикл относительно дневной мощности команды");
  }
  if ((input.extraRisksText ?? "").trim().length > 0) {
    score += 1;
    reasons.push("заданы дополнительные риски в свободной форме");
  }
  let riskLevel: PlannerResult["riskLevel"] = "low";
  if (score >= 4) riskLevel = "high";
  else if (score >= 2) riskLevel = "medium";
  return { riskLevel, reasons };
}

function computeConfidence(input: ReleasePlannerInput): { confidence: PlannerResult["confidence"]; reasons: string[] } {
  const reasons: string[] = [];
  let penalties = 0;
  const atr = (input.atrText ?? "").trim();
  const spec = (input.specDraft ?? "").trim();
  if (atr.length < 40) {
    penalties += 1;
    reasons.push("архитектурно-техническое решение неполное или отсутствует");
  }
  if (spec.length < 40) {
    penalties += 1;
    reasons.push("нет финальной постановки (короткий/пустой текст)");
  }
  if (input.newIntegration) {
    penalties += 1;
    reasons.push("новая интеграция — меньше известно о поведении в бою");
  }
  if (input.legacy) {
    penalties += 1;
    reasons.push("унаследованный код — выше неопределённость регрессии");
  }
  if (input.externalDependency) {
    penalties += 1;
    reasons.push("зависимость от внешних команд / систем");
  }
  if ((input.extraRisksText ?? "").toLowerCase().includes("scope")) {
    penalties += 1;
    reasons.push("в рисках упомянут объём или границы работ");
  }
  let confidence: PlannerResult["confidence"] = "high";
  if (penalties >= 3) confidence = "low";
  else if (penalties >= 1) confidence = "medium";
  if (penalties === 0) reasons.push("входные артефакты выглядят достаточно полными для прогноза");
  return { confidence, reasons };
}

function buildTimeline(
  start: Date,
  stageRows: StageAllocationRow[],
): { segments: TimelineSegment[]; testStart: Date | null; testEnd: Date | null } {
  const segments: TimelineSegment[] = [];
  let cur = toNextWeekdayUtc(new Date(start));
  let testStart: Date | null = null;
  let testEnd: Date | null = null;
  for (const row of stageRows) {
    if (row.workDays < 1) continue;
    const segStart = new Date(cur);
    const segEnd = addBusinessDaysInclusive(cur, row.workDays);
    segments.push({
      stageId: row.id,
      label: row.label,
      startDate: formatYmd(segStart),
      endDate: formatYmd(segEnd),
    });
    if (row.id === "test") {
      testStart = new Date(segStart);
      testEnd = new Date(segEnd);
    }
    cur = new Date(segEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
    cur = toNextWeekdayUtc(cur);
  }
  return { segments, testStart, testEnd };
}

function riskBufferTimelineSpan(
  timelineSegments: TimelineSegment[],
  riskBufferTotal: number,
): { startDate: string; endDate: string } | null {
  if (riskBufferTotal < 1 || timelineSegments.length === 0) return null;
  const last = timelineSegments[timelineSegments.length - 1];
  const after = parseYmd(last.endDate);
  if (!after) return null;
  let cur = new Date(after);
  cur.setUTCDate(cur.getUTCDate() + 1);
  cur = toNextWeekdayUtc(cur);
  const bufEnd = addBusinessDaysInclusive(cur, riskBufferTotal);
  return { startDate: formatYmd(cur), endDate: formatYmd(bufEnd) };
}

function freezeWarnings(
  input: ReleasePlannerInput,
  testStart: Date | null,
  testEnd: Date | null,
  demo: Date | null,
): PlannerResult["warnings"] {
  const w: PlannerResult["warnings"] = [];
  const freezeRaw = input.freezeDate?.trim();
  if (!freezeRaw || !testStart) return w;
  const freeze = parseYmd(freezeRaw);
  if (!freeze) return w;
  const fs = toNextWeekdayUtc(freeze);
  if (fs.getTime() > testStart.getTime()) {
    w.push({
      severity: "warn",
      code: "freeze_after_regression",
      message:
        "Дата заморозки изменений попадает после начала регрессии: к этому моменту набор работ для теста уже должен быть зафиксирован.",
    });
  }
  if (testEnd && demo) {
    const demoD = toNextWeekdayUtc(demo);
    const gap = businessDaysInclusiveBetween(testEnd, demoD);
    if (gap != null && gap < MIN_REGRESSION_TO_DEMO_BUSINESS_DAYS) {
      w.push({
        severity: "warn",
        code: "regression_window_tight",
        message: `Между окончанием регрессии и демо меньше ${MIN_REGRESSION_TO_DEMO_BUSINESS_DAYS} рабочих дней — мало времени на стабилизацию.`,
      });
    }
  }
  return w;
}

function buildNarratives(ctx: {
  input: ReleasePlannerInput;
  minimalWorkDays: number;
  realisticWorkDays: number;
  riskBufferTotal: number;
  riskBufferRows: { active: boolean; label: string; days: number }[];
  capacityPerDay: number;
  demoFit: PlannerResult["demoFit"];
  longestPhase: PlannerResult["longestPhase"];
  riskReasons: string[];
  confidenceReasons: string[];
}): PlannerResult["narratives"] {
  const { input, minimalWorkDays, realisticWorkDays, riskBufferTotal, riskBufferRows, capacityPerDay, demoFit, longestPhase } = ctx;
  const durationBullets: string[] = [];
  durationBullets.push(
    "Документация по-прежнему входит в сумму часов оценки, но в календарном прогнозе от даты старта тестирования не учитывается: её готовят до начала тестов.",
  );
  durationBullets.push(
    "На контурах тестирования, предпродакшена, продакшена и демонстрации при ненулевых часах заложено не менее одного рабочего дня на каждую площадку.",
  );
  if (capacityPerDay > 0) {
    durationBullets.push(
      `Базовая нагрузка: ${input.qaEstimateHours} ч при суммарной мощности команды ~${capacityPerDay.toFixed(1)} ч/день → порядка ${minimalWorkDays} рабочих дней по этапам после старта тестирования (документация в этот срок не входит).`,
    );
  } else {
    durationBullets.push("Мощность команды 0 — нельзя оценить календарь.");
  }
  if (riskBufferTotal > 0) {
    const parts = riskBufferRows.filter((r) => r.active).map((r) => `${r.label} (+${r.days} дн.)`);
    durationBullets.push(`К базовому сроку добавлены рисковые буферы: ${parts.join("; ")} → +${riskBufferTotal} раб. дн.`);
  } else {
    durationBullets.push("Рисковые буферы по правилам не добавлены (флаги выключены).");
  }
  durationBullets.push(`Реалистичный горизонт: около ${realisticWorkDays} рабочих дней от даты старта тестирования.`);

  const longestPhaseBullets: string[] = [];
  if (longestPhase) {
    longestPhaseBullets.push(
      `Самая длинная фаза — ${longestPhase.label}: ~${longestPhase.workDays} раб. дн. при текущем распределении часов.`,
    );
    if (longestPhase.id === "test" && input.newIntegration) {
      longestPhaseBullets.push(
        "На регрессию и сквозные сценарии уходит больше времени при нескольких новых связках между системами.",
      );
    }
  } else {
    longestPhaseBullets.push("Нет ни одной фазы с ненулевыми часами.");
  }

  const riskBullets = [...ctx.riskReasons.map((r) => `Фактор риска: ${r}.`)];
  const confidenceBullets = [...ctx.confidenceReasons.map((r) => `Снижает достоверность прогноза: ${r}.`)];

  const capacityBullets: string[] = [];
  if (input.qaCount > 0) {
    capacityBullets.push(
      `Команда: ${input.qaCount} тестировщик(а), эффективно ~${input.effectiveHoursPerQaPerDay} ч/день на человека → суммарно ~${capacityPerDay.toFixed(1)} ч/день (параллельные релизы учтены отдельным буфером в днях, не в знаменателе мощности).`,
    );
  }
  if (demoFit === "miss") capacityBullets.push("По календарю демо выглядит недостижимым при текущих вводных.");
  else if (demoFit === "tight") capacityBullets.push("До демо мало запаса — любой сдвиг по бэкенду или стенду съедает окно.");

  const lead =
    demoFit === "miss"
      ? "Прогноз смещён в сторону более позднего завершения: проверьте мощность, буферы и дату демо."
      : demoFit === "tight"
        ? "Сроки напряжённые: прогноз объясняется сочетанием оценки, мощности и календарных ограничений."
        : "Прогноз выглядит укладывающимся в заявленное демо при зафиксированных допущениях ниже.";

  return {
    lead,
    durationBullets,
    longestPhaseBullets,
    riskBullets,
    confidenceBullets,
    capacityBullets,
  };
}

export function planRelease(input: ReleasePlannerInput): PlannerResult {
  const qaCount = Math.max(0, input.qaCount);
  const eff = Math.max(0.1, input.effectiveHoursPerQaPerDay);
  const capacityPerDay = qaCount > 0 ? qaCount * eff : 0;

  const stageRows = buildStageRows(input, capacityPerDay);
  const sumWorkDays = stageRows.reduce((s, r) => s + r.workDays, 0);
  const operationalBufferDays = DEFAULT_OPERATIONAL_BUFFER_DAYS;
  const minimalWorkDays = sumWorkDays + operationalBufferDays;

  const riskBufferRows = RISK_BUFFER_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    active: rule.applies(input),
    days: rule.applies(input) ? rule.days : 0,
  }));
  const riskBufferTotal = riskBufferRows.reduce((s, r) => s + (r.active ? r.days : 0), 0);
  const realisticWorkDays = minimalWorkDays + riskBufferTotal;

  const longest = [...stageRows].filter((r) => r.workDays > 0).sort((a, b) => b.workDays - a.workDays)[0] ?? null;
  const longestPhase = longest ? { id: longest.id, label: longest.label, workDays: longest.workDays } : null;

  const start = parseYmd(input.testStartDate);
  const demo = input.demoDate ? parseYmd(input.demoDate) : null;

  let minimalEndDate: string | null = null;
  let realisticEndDate: string | null = null;
  let timelineSegments: TimelineSegment[] = [];
  let testStart: Date | null = null;
  let testEnd: Date | null = null;
  let riskBufferSpan: { startDate: string; endDate: string } | null = null;

  if (start && minimalWorkDays > 0) {
    const { segments, testStart: ts, testEnd: te } = buildTimeline(start, stageRows);
    timelineSegments = segments;
    testStart = ts;
    testEnd = te;
    const minEnd = addBusinessDaysInclusive(start, minimalWorkDays);
    minimalEndDate = formatYmd(minEnd);
    const realEnd = addBusinessDaysInclusive(start, realisticWorkDays);
    realisticEndDate = formatYmd(realEnd);
    riskBufferSpan = riskBufferTimelineSpan(timelineSegments, riskBufferTotal);
  }

  const realisticEndParsed = realisticEndDate ? parseYmd(realisticEndDate) : null;
  const { demoFit, demoFitLabel } = computeDemoFit(realisticEndParsed, demo);

  const { riskLevel, reasons: riskReasons } = computeRiskLevel(input, demoFit, capacityPerDay);
  const { confidence, reasons: confidenceReasons } = computeConfidence(input);

  const warnings: PlannerResult["warnings"] = [];
  if (qaCount === 0) {
    warnings.push({ severity: "error", code: "no_qa", message: "Не указано число тестировщиков — суммарная мощность команды равна нулю." });
  }
  if (sumStageHours(input) <= 0 && input.qaEstimateHours > 0) {
    warnings.push({ severity: "warn", code: "stage_hours", message: "Сумма часов по этапам 0 при ненулевой оценке." });
  }
  const absDiff = Math.abs(sumStageHours(input) - input.qaEstimateHours);
  if (input.qaEstimateHours > 0 && absDiff > 0.01) {
    warnings.push({
      severity: "warn",
      code: "hours_mismatch",
      message: "Сумма часов по этапам не совпадает с общей оценкой тестирования.",
    });
  }
  warnings.push(...freezeWarnings(input, testStart, testEnd, demo));

  const narratives = buildNarratives({
    input,
    minimalWorkDays,
    realisticWorkDays,
    riskBufferTotal,
    riskBufferRows,
    capacityPerDay,
    demoFit,
    longestPhase,
    riskReasons,
    confidenceReasons,
  });

  return {
    capacityPerDay,
    minimalWorkDays,
    operationalBufferDays,
    riskBufferRows,
    riskBufferTotal,
    realisticWorkDays,
    stageRows,
    longestPhase,
    minimalEndDate,
    realisticEndDate,
    demoFit,
    demoFitLabel,
    riskLevel,
    confidence,
    confidenceReasons,
    riskReasons,
    warnings,
    narratives,
    timelineSegments,
    riskBufferSpan,
    operationalBottleneckHints: [],
  };
}
