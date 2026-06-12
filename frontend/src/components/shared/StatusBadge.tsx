import { QuestionStatus } from "@/data/questions";
import { EpicStatus, QAStatus } from "@/data/epics";

type AnyStatus = QuestionStatus | EpicStatus | QAStatus;

const questionColors: Record<string, string> = {
  "На проверке": "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  "У эксперта": "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
  "На уточнении": "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  "Ожидает автора": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  "Закрыт": "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  "Отменён": "bg-red-500/10 text-red-700/80 dark:text-red-400/70 border-red-500/20",
};

const epicColors: Record<string, string> = {
  "Новый": "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  "В работе": "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  "Выпущен": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

const qaColors: Record<string, string> = {
  "Подготовка тест-плана": "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  "В тестировании": "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
  "Заблокировано": "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  "TEST complete": "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/30",
  "STAGE complete": "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  "PROD complete": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  "Закрыто": "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
};

const allColors = { ...questionColors, ...epicColors, ...qaColors };

interface StatusBadgeProps {
  status: AnyStatus | string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const colorClass = allColors[status] ?? "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30";
  const sizeClass = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center rounded border font-medium whitespace-nowrap ${colorClass} ${sizeClass}`}>
      {status}
    </span>
  );
}
