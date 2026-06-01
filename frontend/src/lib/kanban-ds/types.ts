export type KanbanPriority = "Высокий" | "Средний" | "Низкий";

export interface KanbanColumn {
  id: number;
  title: string;
  color: string;
  position: number;
}

export interface KanbanTask {
  id: number;
  columnId: number;
  title: string;
  description?: string | null;
  priority: KanbanPriority;
  /** Raw Kanban priority id when API exposes it (for filters). */
  priorityId?: number | null;
  types: string[];
  assignees: string[];
  epic: string;
  epicFull: string;
  /** Kanban epic id when API returns `epic.id`. */
  epicId?: number | null;
  /**
   * True when `epicId` came from `parent` / `parent_id` (список канбана в v1 часто не включает `epic` в TaskMultiple).
   * Название подставляем только если целевая задача — тип «Эпик» (см. v1: type_id 5).
   */
  epicRefIsParentLink?: boolean;
  /** Сырой id типа задачи из Kanban (`task_type` / `task_type_id`). */
  taskTypeId?: number | null;
  /** Board column / stage title (for filters, colors, column select). */
  status: string;
  /** Kanban workflow label when API exposes `status` separately from stage (e.g. 1–3). */
  workflowStatus?: string | null;
  /** Направление / компонент (из поля `component` задачи). */
  componentId?: number | null;
  componentLabel: string;
  /** 0 — в сроке / нет дедлайна, 1 — срок близится, 2 — просрочено (Kanban `deadline_status`). */
  deadlineStatus: number | null;
  trackedMinutes: number;
  createdAt: string;
  deadline?: string | null;
  commentCount: number;
  attachmentCount: number;
}

export interface KanbanBoardBundle {
  stages: unknown[];
  project: Record<string, unknown>;
  tasks: unknown[];
}

export interface KanbanCommentRow {
  id: number;
  author: string;
  text: string;
  createdAt: string;
}

export interface KanbanWorkRow {
  id: number;
  user: string;
  description: string;
  minutes: number;
  loggedAt: string;
  /** Kanban user id автора списания (`user.id` / `user_id` в Work), для сопоставления с ролями Resonance. */
  kanbanUserId?: number | null;
}

/** Направление для фильтра worklog эпика (по роли участника в Resonance, как в аналитике). */
export type KanbanWorklogLane = "qa" | "front" | "back" | "manager" | "other";

/** Строка журнала времени в контексте эпика (GET /task/{id}/work по эпику и дочерним задачам). */
export interface KanbanEpicWorklogRow extends KanbanWorkRow {
  sourceTaskId: number;
  sourceTaskTitle: string;
  lane: KanbanWorklogLane;
}

export interface KanbanChecklistRow {
  pointId: number;
  text: string;
  done: boolean;
}

export interface KanbanEstimateRow {
  id: number;
  user: string;
  role: string;
  hours: number;
}

/** Элемент `responsible_estimates` в TaskSingle (helps/v1.json). */
export interface KanbanResponsibleEstimateRow {
  id: number;
  user: string;
  role: string;
  minutes: number;
  hours: number;
  description: string | null;
  createdAt: string;
  isActual: boolean;
  isReestimate: boolean;
}
