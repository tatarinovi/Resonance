import { AlertCircle, Loader2 } from "lucide-react";

import { EpicAnalyticsOverview } from "@/components/kanban-analytics/EpicAnalyticsOverview";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiError } from "@/lib/api";
import { useKanbanEpicCharts } from "@/lib/queries";

/** Графики конкретного Kanban-эпика вне карточки Resonance Epic. */
export function KanbanEpicAnalyticsPanel({ projectSlug, epicKanbanId }: { projectSlug: string; epicKanbanId: number }) {
  const charts = useKanbanEpicCharts(epicKanbanId, projectSlug, true);
  if (charts.isLoading) return <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка графиков…</div>;
  if (charts.isError || !charts.data) {
    const err = charts.error as unknown;
    return <EmptyState icon={AlertCircle} title="Не удалось загрузить графики" description={err instanceof ApiError ? err.message : "Проверьте доступ к Kanban API."} />;
  }
  return <div className="rounded-lg border border-border bg-card p-3 text-foreground"><EpicAnalyticsOverview d={charts.data} chartsReady={charts.data.charts_ready} /></div>;
}
