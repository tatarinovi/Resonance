import { AlertCircle, Loader2 } from "lucide-react";

import { EpicAnalyticsOverview } from "@/components/kanban-analytics/EpicAnalyticsOverview";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiError } from "@/lib/api";
import { useKanbanEpicCharts } from "@/lib/queries";

/**
 * Графики эпика Kanban: live `/analytics/kanban/epics/:id/charts` (без снимка).
 */
export function KanbanEpicAnalyticsPanel({
  projectSlug,
  epicKanbanId,
}: {
  projectSlug: string;
  epicKanbanId: number;
}) {
  const charts = useKanbanEpicCharts(epicKanbanId, projectSlug, true);

  if (charts.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка графиков…
      </div>
    );
  }

  if (charts.isError || !charts.data) {
    const err = charts.error as unknown;
    const needsConnect = err instanceof ApiError && [401, 403, 409].includes(err.status);
    return (
      <EmptyState
        icon={AlertCircle}
        title="Не удалось загрузить графики"
        description={
          needsConnect
            ? "Подключите Kanban в сайдбаре и попробуйте снова."
            : err instanceof ApiError
              ? err.message
              : "Проверьте доступ к Kanban API."
        }
        action={
          needsConnect ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => window.dispatchEvent(new Event("resonance:kanban-login"))}
            >
              Подключить Kanban
            </button>
          ) : null
        }
      />
    );
  }

  return (
    <div className="rounded-lg border border-[#2F363C] bg-[#0D1117] p-3 text-[#E6EEF4]">
      <EpicAnalyticsOverview d={charts.data} chartsReady={charts.data.charts_ready} />
    </div>
  );
}
