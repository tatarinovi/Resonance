import type { KanbanColumn } from "./types";

/** Колонки доски и подписи статусов задач — только этот набор (как в DS Kanban). */
export const KANBAN_BOARD_STATUS_ORDER: readonly string[] = [
  "Новые",
  "В работе",
  "Выполнены",
  "Ревью",
  "Готово к тестированию",
  "В тестировании",
  "Решены",
];

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const reg = (alias: string, canonical: string) => {
    m[norm(alias)] = canonical;
  };
  for (const c of KANBAN_BOARD_STATUS_ORDER) reg(c, c);
  reg("Новая", "Новые");
  reg("Выполнено", "Выполнены");
  reg("Готовы к тестированию", "Готово к тестированию");
  reg("Решена", "Решены");
  reg("Ожидает оценки", "В работе");
  reg("Проверена", "Ревью");
  return m;
})();

/** Приводит подпись стадии/статуса к каноническому виду из списка или null, если вне списка. */
export function kanbanCanonicalBoardStatus(label: string | null | undefined): string | null {
  if (!label?.trim()) return null;
  return ALIAS_TO_CANONICAL[norm(label)] ?? null;
}

/** Оставляет только колонки из белого списка; заголовок нормализуется к канону; порядок как в списке. */
export function filterKanbanColumnsByAllowlist(columns: KanbanColumn[]): KanbanColumn[] {
  const mapped = columns
    .map((c) => {
      const canon = kanbanCanonicalBoardStatus(c.title);
      return canon ? { ...c, title: canon } : null;
    })
    .filter((c): c is KanbanColumn => c != null);
  if (mapped.length === 0) return columns;
  const orderIndex = (t: string) => {
    const i = (KANBAN_BOARD_STATUS_ORDER as readonly string[]).indexOf(t);
    return i === -1 ? 999 : i;
  };
  return [...mapped].sort((a, b) => {
    const d = orderIndex(a.title) - orderIndex(b.title);
    if (d !== 0) return d;
    return a.position - b.position;
  });
}
