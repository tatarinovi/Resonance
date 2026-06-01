export const AVATARS: Record<string, { color: string; name: string }> = {
  АИ: { color: "#8b5cf6", name: "Александр Иванов" },
  КВ: { color: "#3fb950", name: "Кирилл Власов" },
  ИИ: { color: "#58a6ff", name: "Иван Иванов" },
  МС: { color: "#d29922", name: "Мария Смирнова" },
  АВ: { color: "#f85149", name: "Алексей Воронов" },
  ДБ: { color: "#a78bfa", name: "Дмитрий Баранов" },
  ОП: { color: "#58a6ff", name: "Ольга Петрова" },
  ТА: { color: "#3fb950", name: "Тимур Азимов" },
  НН: { color: "#8b949e", name: "Наталья Николаева" },
};

export const ALL_USERS = Object.values(AVATARS).map((v) => v.name);

export function getAvatarInfo(name: string) {
  const match = Object.entries(AVATARS).find(([, val]) => val.name === name);
  if (match) {
    return { initials: match[0], color: match[1].color, name };
  }

  const initials =
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "?";

  return { initials, color: "#444d56", name };
}

export const PRIORITY_CLASS: Record<string, string> = {
  Высокий: "badge-priority-high",
  Средний: "badge-priority-medium",
  Низкий: "badge-priority-low",
};

export const TYPE_CLASS: Record<string, string> = {
  Баг: "badge-type-bug",
  Задача: "badge-type-task",
  Эпик: "badge-type-epic",
  Улучшение: "badge-type-improvement",
  // Легаси-имена: карточки на доске сводятся к четырём категориям; оставлено на случай старых данных в `types[]`.
  Тестирование: "badge-type-task",
  Фронтенд: "badge-type-task",
  Разработка: "badge-type-task",
  Управление: "badge-type-task",
};

/** Порядок опций фильтра типа на доске (совпадает с `canonicalKanbanTaskTypeLabel`). */
export const ALL_TYPES = ["Баг", "Задача", "Эпик", "Улучшение"];

export const STATUS_COLOR: Record<string, string> = {
  Новые: "#58a6ff",
  "В работе": "#d29922",
  Выполнены: "#3fb950",
  Выполнено: "#3fb950",
  Ревью: "#8b5cf6",
  "Готово к тестированию": "#58a6ff",
  "Готовы к тестированию": "#58a6ff",
  "В тестировании": "#a78bfa",
  Решены: "#444d56",
};

export const WORKFLOW_STATUS_COLOR: Record<string, string> = {
  ...STATUS_COLOR,
  Новая: "#58a6ff",
  "Ожидает оценки": "#d29922",
  Проверена: "#8b5cf6",
};
