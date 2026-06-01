import { Loader2 } from "lucide-react";

import { formatDateTime } from "@/lib/formatDateTime";
import type { KanbanAnalyticsBootstrap } from "@/lib/queries";

export function isKanbanSnapshotRefreshing(
  refreshState: KanbanAnalyticsBootstrap["refresh_state"] | undefined,
  localPending = false,
): boolean {
  return localPending || refreshState?.status === "running";
}

export function formatKanbanSnapshotTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "—";
}

export function KanbanSnapshotRefreshBanner({
  refreshState,
  localPending = false,
}: {
  refreshState: KanbanAnalyticsBootstrap["refresh_state"] | undefined;
  localPending?: boolean;
}) {
  if (!isKanbanSnapshotRefreshing(refreshState, localPending)) return null;

  return (
    <div
      className="mb-4 flex gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-sm shadow-sm"
      data-testid="kanban-snapshot-refresh-banner"
    >
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium text-foreground">Обновляем снимок Kanban</div>
        <p className="mt-0.5 text-muted-foreground">
          Собираем проекты, эпики, задачи и списания времени. Это может занять пару минут. Пока показаны данные предыдущего снимка.
        </p>
        {refreshState?.started_at ? (
          <div className="mt-2 text-xs text-muted-foreground">
            Начато: <span className="text-foreground">{formatDateTime(refreshState.started_at)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
