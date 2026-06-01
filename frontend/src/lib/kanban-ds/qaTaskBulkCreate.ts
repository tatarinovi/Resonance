import type { KanbanTask } from "./types";

export type QaBulkTaskKind = "test_cases" | "testing" | "demo" | "instruction";

export const QA_BULK_TASK_LABELS: Record<QaBulkTaskKind, string> = {
  test_cases: "Написание тест-кейсов",
  testing: "Тестирование",
  demo: "Проведение демонстрации",
  instruction: "Написание инструкции",
};

export const QA_BULK_TASK_CHECKLISTS: Partial<Record<QaBulkTaskKind, string[]>> = {
  test_cases: [
    "Написание тест-плана",
    "Написание тест-кейсов",
    "Сбор кейсов в тест-ран (ссылку прикрепить в комментарии)",
  ],
  demo: [
    "Подготовка контента",
    "Написание сценария в Confluence (ссылку прикрепить в комментарии)",
    "Проведение демо",
  ],
};

export function normalizeQaTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function qaTaskBaseTitle(kind: QaBulkTaskKind, epicTitle: string): string {
  return `[QA] ${QA_BULK_TASK_LABELS[kind]} | ${epicTitle.trim()}`;
}

export function qaTestingTaskTitle(
  epicTitle: string,
  _executorIds: number[],
  _memberIdToName: Map<number, string>,
  _sequence: number,
  _totalTestingRows: number,
): string {
  return qaTaskBaseTitle("testing", epicTitle);
}

export function findQaTaskDuplicate(
  tasks: Pick<KanbanTask, "id" | "title">[],
  title: string,
): Pick<KanbanTask, "id" | "title"> | null {
  const wanted = normalizeQaTaskTitle(title);
  return tasks.find((task) => normalizeQaTaskTitle(task.title) === wanted) ?? null;
}
