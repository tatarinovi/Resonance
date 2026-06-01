import { useEffect, useState } from "react";

import { formatStagnationBadgeLabel, hoursSinceUpdated, stagnationBadgeColorClass } from "@/lib/questionStagnation";

interface QuestionStagnationBadgeProps {
  updatedAt: string;
}

export function QuestionStagnationBadge({ updatedAt }: QuestionStagnationBadgeProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const hours = hoursSinceUpdated(updatedAt);
  if (!Number.isFinite(hours)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const label = formatStagnationBadgeLabel(hours);
  const colorClass = stagnationBadgeColorClass(hours);

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${colorClass}`}
      title="Время без изменений с последнего обновления вопроса"
    >
      {label}
    </span>
  );
}
