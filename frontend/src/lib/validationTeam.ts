/**
 * Slugs in `ticket.data_json.validation_team` and `user.direction` for the «На проверке» queue.
 * Developer / Coordinator: QA, Front, Back, Coordinator (slug `coordinator`).
 */
export const DEV_COORD_DIRECTION_SLUGS = ["qa", "front", "back", "coordinator"] as const;
export type DevCoordDirectionSlug = (typeof DEV_COORD_DIRECTION_SLUGS)[number];

export const DEV_COORD_DIRECTION_LABELS: Record<DevCoordDirectionSlug, string> = {
  qa: "QA",
  front: "Front",
  back: "Back",
  coordinator: "Координатор",
};

/** Expert `user.direction` */
export const EXPERT_DIRECTION_SLUGS = ["analytics", "design"] as const;
export type ExpertDirectionSlug = (typeof EXPERT_DIRECTION_SLUGS)[number];

export const EXPERT_DIRECTION_LABELS: Record<ExpertDirectionSlug, string> = {
  analytics: "Аналитик",
  design: "Дизайнер",
};

/** Ticket validation team (same slugs as dev/coord directions). */
export const VALIDATION_TEAM_SLUGS = DEV_COORD_DIRECTION_SLUGS;
export type ValidationTeamSlug = DevCoordDirectionSlug;
export const VALIDATION_TEAM_LABELS = DEV_COORD_DIRECTION_LABELS;

export const USER_DIRECTION_OPTIONS_DEV_COORD: { value: DevCoordDirectionSlug; label: string }[] =
  DEV_COORD_DIRECTION_SLUGS.map((slug) => ({ value: slug, label: DEV_COORD_DIRECTION_LABELS[slug] }));

export const USER_DIRECTION_OPTIONS_EXPERT: { value: ExpertDirectionSlug; label: string }[] =
  EXPERT_DIRECTION_SLUGS.map((slug) => ({ value: slug, label: EXPERT_DIRECTION_LABELS[slug] }));

/** Кому адресован вопрос: домен эпика (разработчик / координатор / часть админского списка). */
export const QUESTION_AUDIENCE_DOMAIN_SLUGS = EXPERT_DIRECTION_SLUGS;
export type QuestionAudienceDomainSlug = ExpertDirectionSlug;

/** Кому адресован вопрос: инженерное направление (эксперт / админ). */
export const QUESTION_AUDIENCE_ENG_SLUGS = ["qa", "front", "back"] as const;
export type QuestionAudienceEngSlug = (typeof QUESTION_AUDIENCE_ENG_SLUGS)[number];

export const QUESTION_AUDIENCE_ENG_LABELS: Record<QuestionAudienceEngSlug, string> = {
  qa: "QA",
  front: "Front",
  back: "Back",
};

/** Все допустимые slug для поля «Кому адресован» (админ). */
export const QUESTION_AUDIENCE_ALL_SLUGS = [
  ...QUESTION_AUDIENCE_DOMAIN_SLUGS,
  ...QUESTION_AUDIENCE_ENG_SLUGS,
  "coordinator",
] as const;
export type QuestionAudienceAllSlug = (typeof QUESTION_AUDIENCE_ALL_SLUGS)[number];

export const QUESTION_AUDIENCE_ALL_LABELS: Record<QuestionAudienceAllSlug, string> = {
  ...EXPERT_DIRECTION_LABELS,
  ...QUESTION_AUDIENCE_ENG_LABELS,
  coordinator: "Координатор",
};

export const LEGACY_QUESTION_AUDIENCE_LABELS: Record<string, string> = {
  manager: "Координатор",
};

export function isQuestionAudienceSlug(v: string): v is QuestionAudienceAllSlug {
  return (QUESTION_AUDIENCE_ALL_SLUGS as readonly string[]).includes(v);
}
