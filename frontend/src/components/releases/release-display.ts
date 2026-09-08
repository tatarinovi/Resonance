import { formatDateTime } from "@/lib/formatDateTime";
export const labels: Record<string, string> = {
  draft: "Черновик",
  in_progress: "В работе",
  ready: "Готов",
  released: "Выпущен",
  cancelled: "Отменён",
  in_testing: "Тестирование идёт",
  blocked: "Заблокировано",
  test_complete: "TEST завершён",
  stage_complete: "STAGE завершён",
  prod_complete: "PROD завершён",
  closed: "Закрыт",
  planned: "Запланирован",
  running: "Выполняется",
  passed: "Успешно",
  failed: "Ошибка",
  broken: "Сломано",
  unknown: "Статус не определён",
  fresh: "Актуально",
  stale: "Устарело",
  empty: "Не загружено",
  error: "Ошибка загрузки",
  partial: "Частично",
  refreshing: "Обновляется",
  not_configured: "Не подключено",
  skipped: "Пропущено",
  success: "Обновлено",
  refreshed: "Обновлено",
  timed_out: "Время ожидания истекло",
  pending_approval: "На согласовании",
  forwarded: "Ожидает эксперта",
  returned: "Возвращён",
  answered: "Получен ответ",
  jira_blocker: "Блокирующая задача",
  jira_critical: "Критичная задача",
  testops_failed: "Тест с ошибкой",
  testops_broken: "Тест сломан",
  testops_blocked: "Тест заблокирован",
  local_blocker: "Блокер эпика",
  qa_failed: "Ран завершён с ошибкой",
  overdue_question: "Просроченный вопрос",
  qa_incomplete: "QA не завершён",
  data_unavailable: "Недостаточно данных",
  source_not_configured: "Источник не подключён",
  integration_failure: "Ошибка синхронизации",
};
export const label = (s?: string | null) =>
  s ? (labels[s.toLowerCase()] ?? s) : "—";
// Legacy cached endpoints return UTC timestamps without an explicit offset.
export const date = (s?: string | null) => {
  if (!s) return "—";
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s) ? `${s}Z` : s;
  return formatDateTime(instant);
};
export const panel = "rounded-xl border border-border bg-card p-5";
