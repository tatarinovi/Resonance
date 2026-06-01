import { useMemo, useState } from "react";
import { BarChart2, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { KanbanSnapshotRefreshBanner, formatKanbanSnapshotTime, isKanbanSnapshotRefreshing } from "@/components/kanban-analytics/KanbanSnapshotRefreshBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { ApiError } from "@/lib/api";
import {
  useKanbanAnalyticsBootstrap,
  useKanbanAnalyticsRefresh,
  useKanbanAnalyticsTasks,
} from "@/lib/queries";

export default function KanbanAnalyticsTasksPage() {
  const bootstrap = useKanbanAnalyticsBootstrap(true, true);
  const refresh = useKanbanAnalyticsRefresh();
  const refreshRunning = isKanbanSnapshotRefreshing(bootstrap.data?.refresh_state, refresh.isPending);

  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const project_slugs = useMemo(() => {
    const slugs = Array.from(selectedProjects.values());
    return slugs.length ? slugs.join(",") : undefined;
  }, [selectedProjects]);

  const tasks = useKanbanAnalyticsTasks(
    { project_slugs, search: search.trim() || undefined, only_mine: onlyMine || undefined, page, page_size: pageSize },
    bootstrap.data?.snapshot_ready ?? false,
  );

  const projects = bootstrap.data?.projects ?? [];

  const toggleProject = (slug: string) => {
    setPage(1);
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const doRefresh = async () => {
    try {
      const res = await refresh.mutateAsync();
      toast.success(`Снимок обновлён: ${res.tasks} задач`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось обновить снимок");
    }
  };

  if (bootstrap.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка Kanban аналитики…
        </div>
      </div>
    );
  }

  if (bootstrap.isError) {
    const err = bootstrap.error;
    const needsConnect = err instanceof ApiError && [401, 403, 409].includes(err.status);
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <KanbanSnapshotRefreshBanner refreshState={bootstrap.data?.refresh_state} localPending={refresh.isPending} />
        <EmptyState
          icon={BarChart2}
          title="Не удалось загрузить Kanban аналитику"
          description={needsConnect ? "Подключите Kanban в сайдбаре и попробуйте снова." : "Проверьте подключение Kanban и права доступа."}
          action={
            needsConnect ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                onClick={() => window.dispatchEvent(new Event("resonance:kanban-login"))}
              >
                Подключить Kanban
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  if (!bootstrap.data?.snapshot_ready) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <KanbanSnapshotRefreshBanner refreshState={bootstrap.data?.refresh_state} localPending={refresh.isPending} />
        <EmptyState
          icon={BarChart2}
          title="Снимок Kanban ещё не создан"
          description="Нажмите «Собрать данные», чтобы загрузить задачи и часы."
          action={
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={() => void doRefresh()}
              disabled={refreshRunning}
            >
              {refreshRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Собрать данные
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold">Kanban · Задачи</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Снимок: {formatKanbanSnapshotTime(bootstrap.data.snapshot_updated_at)}</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          onClick={() => void doRefresh()}
          disabled={refreshRunning}
        >
          {refreshRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </button>
      </div>

      <KanbanSnapshotRefreshBanner refreshState={bootstrap.data.refresh_state} localPending={refresh.isPending} />

      <div className="flex flex-col gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Поиск по названию задачи…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setOnlyMine((v) => !v);
              setPage(1);
            }}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              onlyMine ? "bg-primary/15 text-primary border-primary/30" : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            Только мои
          </button>

          <div className="flex flex-wrap gap-2">
            {projects.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => toggleProject(p.slug)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  selectedProjects.has(p.slug) ? "bg-primary/15 text-primary border-primary/30" : "bg-card text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tasks.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка задач…
        </div>
      ) : tasks.isError ? (
        <EmptyState icon={BarChart2} title="Не удалось загрузить задачи" description="Попробуйте обновить снимок." />
      ) : (tasks.data?.items?.length ?? 0) === 0 ? (
        <EmptyState icon={BarChart2} title="Задач нет" description="По текущим фильтрам Kanban API не вернул задач." />
      ) : (
        <div className="space-y-2">
          {(tasks.data?.items ?? []).map((t) => (
            <div key={`${t.project.slug}-${t.id}`} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.project.slug} · #{t.id} · {t.stage?.name ?? "—"} · {t.assignees?.join(", ") || "—"}
                  </div>
                </div>
                {t.tracked_hours != null ? (
                  <span className="text-xs font-medium text-muted-foreground flex-shrink-0">{t.tracked_hours} ч</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      <ListPagination page={page} pageSize={pageSize} total={tasks.data?.total ?? 0} isLoading={tasks.isFetching} onPageChange={setPage} />
    </div>
  );
}
