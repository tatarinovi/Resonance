import { Priority } from "@/data/questions";

const colors: Record<Priority, string> = {
  "Критический": "text-red-700 dark:text-red-400",
  "Высокий": "text-orange-700 dark:text-orange-400",
  "Средний": "text-amber-700 dark:text-amber-400",
  "Низкий": "text-slate-600 dark:text-slate-400",
};

const dots: Record<Priority, string> = {
  "Критический": "bg-red-500",
  "Высокий": "bg-orange-500",
  "Средний": "bg-amber-500",
  "Низкий": "bg-slate-500",
};

interface PriorityBadgeProps {
  priority: Priority;
  showLabel?: boolean;
}

export function PriorityBadge({ priority, showLabel = true }: PriorityBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${colors[priority]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dots[priority]}`} />
      {showLabel && priority}
    </span>
  );
}
