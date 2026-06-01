import type { ReleaseStageId, ReleaseType } from "./types";

export const STAGE_ORDER: ReleaseStageId[] = ["docs", "test", "stage", "prod", "demo", "leadership"];

/**
 * Контуры (площадки), для которых действует правило: при ненулевых часах по этапу — не менее одного рабочего дня.
 * Документация и согласования с руководством сюда не входят.
 */
export const STAGE_IDS_MIN_ONE_DAY_PER_PLATFORM: ReleaseStageId[] = ["test", "stage", "prod", "demo"];

export const DEFAULT_EFFECTIVE_HOURS_PER_QA_PER_DAY = 5.5;

/** Default share of total QA hours when (re)initializing stage split. Sum = 1. */
export const DEFAULT_STAGE_WEIGHTS: Record<ReleaseStageId, number> = {
  docs: 0.1,
  test: 0.47,
  stage: 0.2,
  prod: 0.04,
  demo: 0.09,
  leadership: 0.1,
};

export const STAGE_LABELS: Record<ReleaseStageId, string> = {
  docs: "Документация и согласования",
  test: "Регрессия и тестирование",
  stage: "Предпродакшен",
  prod: "Продакшен",
  demo: "Демонстрация",
  leadership: "Согласования с руководством",
};

/** Small fixed operational buffer on top of summed stage work days (not risk). */
export const DEFAULT_OPERATIONAL_BUFFER_DAYS = 0;

/** Minimum business days between end of Test segment and demo to avoid "tight regression" warning. */
export const MIN_REGRESSION_TO_DEMO_BUSINESS_DAYS = 2;

export const RISK_BUFFER_RULES: {
  id: string;
  label: string;
  days: number;
  applies: (input: import("./types").ReleasePlannerInput) => boolean;
}[] = [
  {
    id: "legacy",
    label: "Унаследованные системы",
    days: 1,
    applies: (i) => i.legacy,
  },
  {
    id: "new_integration",
    label: "Новая интеграция",
    days: 2,
    applies: (i) => i.newIntegration,
  },
  {
    id: "parallel_releases",
    label: "Параллельные релизы, высокая конкуренция за время тестирования",
    days: 1,
    applies: (i) => i.parallelReleasesHigh,
  },
];

export const RELEASE_TYPE_LABELS: Record<ReleaseType, string> = {
  major: "Крупный релиз",
  minor: "Небольшой релиз",
  hotfix: "Срочное исправление",
  patch: "Патч",
  other: "Другое",
};
