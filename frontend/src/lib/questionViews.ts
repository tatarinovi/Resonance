import type { QuestionStatus, Priority } from "@/data/questions";
import type { TicketsQueryParams } from "@/lib/queries";
import { PRIORITY_FROM_REF, STATUS_FROM_REF } from "@/lib/mappers";

export type QuestionSavedViewId = "all" | "mine" | "stale" | "expert" | "waiting" | "blocked";

export interface QuestionSavedView {
  id: QuestionSavedViewId;
  label: string;
  description: string;
  href: string;
  sort: "date" | "stagnation" | "priority";
  status?: QuestionStatus;
  mineOnly?: boolean;
  localFilter?: "blocked";
}

export const QUESTION_SAVED_VIEWS: QuestionSavedView[] = [
  {
    id: "all",
    label: "Все вопросы",
    description: "Полный рабочий список",
    href: "/questions",
    sort: "date",
  },
  {
    id: "mine",
    label: "Мои вопросы",
    description: "Вопросы, где вы ответственный",
    href: "/questions?view=mine",
    sort: "date",
    mineOnly: true,
  },
  {
    id: "stale",
    label: "Без движения",
    description: "Самые старые обновления сверху",
    href: "/questions?view=stale",
    sort: "stagnation",
  },
  {
    id: "expert",
    label: "У эксперта",
    description: "Переданы на экспертный ответ",
    href: "/questions?view=expert",
    sort: "date",
    status: "У эксперта",
  },
  {
    id: "waiting",
    label: "Ждут автора",
    description: "Ответ получен, нужен следующий шаг",
    href: "/questions?view=waiting",
    sort: "date",
    status: "Ожидает автора",
  },
  {
    id: "blocked",
    label: "Блокируют работу",
    description: "Связаны с эпиками, где есть блокеры",
    href: "/questions?view=blocked",
    sort: "stagnation",
    localFilter: "blocked",
  },
];

export const DEFAULT_QUESTION_VIEW = QUESTION_SAVED_VIEWS[0];

export function normalizeQuestionView(raw: string | null | undefined): QuestionSavedView {
  return QUESTION_SAVED_VIEWS.find((view) => view.id === raw) ?? DEFAULT_QUESTION_VIEW;
}

export function questionSortToApi(sort: QuestionSavedView["sort"] | "date" | "stagnation" | "priority"): string {
  if (sort === "stagnation") return "updated_at";
  if (sort === "priority") return "priority";
  return "-updated_at";
}

export function buildSavedViewTicketParams(
  view: QuestionSavedView,
  options: {
    meId?: number | null;
    projectId?: number;
    status?: QuestionStatus | "all";
    priority?: Priority | "all";
    search?: string;
    sort: "date" | "stagnation" | "priority";
    page: number;
    pageSize: number;
  },
): TicketsQueryParams {
  const status = options.status && options.status !== "all" ? options.status : view.status;
  return {
    page: view.localFilter === "blocked" ? 1 : options.page,
    page_size: view.localFilter === "blocked" ? Math.max(options.pageSize, 100) : options.pageSize,
    project_id: options.projectId,
    status: status ? STATUS_FROM_REF[status] : undefined,
    priority: options.priority && options.priority !== "all" ? PRIORITY_FROM_REF[options.priority] : undefined,
    assignee_id: view.mineOnly && options.meId ? options.meId : undefined,
    search: options.search?.trim() || undefined,
    sort: questionSortToApi(options.sort),
  };
}
