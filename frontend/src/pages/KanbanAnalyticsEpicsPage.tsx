import { useMemo, useState } from "react";
import { BarChart2, FolderKanban, Loader2, RefreshCw, Search, Star } from "lucide-react";
import { toast } from "sonner";

import { KanbanSnapshotRefreshBanner, formatKanbanSnapshotTime, isKanbanSnapshotRefreshing } from "@/components/kanban-analytics/KanbanSnapshotRefreshBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { KANBAN_FAVORITE_EPICS_STORAGE_KEY, useKanbanFavoriteItems } from "@/hooks/useKanbanFavoriteItems";
import { Link } from "@/lib/router";
import { ApiError } from "@/lib/api";
import { useKanbanAnalyticsBootstrap, useKanbanAnalyticsEpics, useKanbanAnalyticsRefresh } from "@/lib/queries";
import { cn } from "@/lib/utils";

function formatResonanceTestStage(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "test") return "Тест";
  if (s === "stage") return "Предпрод";
  if (s === "prod") return "Прод";
  return raw;
}

/** Единая оболочка страницы: фиксированная максимальная ширина 72rem + контейнерные запросы для сетки карточек. */
const EPICS_PAGE_SHELL =
  "mx-auto box-border w-[min(100%,72rem)] min-w-0 px-4 py-4 md:px-6 md:py-6 @container/kanban-epics";

function formatQaStatusShort(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim().toLowerCase().replace(/^"|"$/g, "");
  const norm = s.replace(/-/g, "_");
  const map: Record<string, string> = {
    draft: "Черновик",
    in_review: "На ревью",
    changes_requested: "Доработка",
    approved: "Одобрено",
    in_testing: "В тестировании",
    blocked: "Блокер",
    test_complete: "Тест завершён",
    stage_complete: "Предпрод завершён",
    prod_complete: "Прод завершён",
    closed: "Закрыто",
  };
  return map[norm] ?? map[s] ?? raw;
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatDeviationPercent(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

export default function KanbanAnalyticsEpicsPage() {
  const bootstrap = useKanbanAnalyticsBootstrap(true, true);
  const refresh = useKanbanAnalyticsRefresh();
  const refreshRunning = isKanbanSnapshotRefreshing(bootstrap.data?.refresh_state, refresh.isPending);
  const {
    orderItems: orderFavoriteEpics,
    isFavorite: isFavoriteEpic,
    toggleFavorite: toggleFavoriteEpic,
  } = useKanbanFavoriteItems(KANBAN_FAVORITE_EPICS_STORAGE_KEY);

  const [search, setSearch] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const project_slugs = useMemo(() => {
    const slugs = Array.from(selectedProjects.values());
    return slugs.length ? slugs.join(",") : undefined;
  }, [selectedProjects]);

  const epics = useKanbanAnalyticsEpics({ project_slugs, search: search.trim() || undefined, page, page_size: pageSize }, bootstrap.data?.snapshot_ready ?? false);

  const projects = bootstrap.data?.projects ?? [];
  const epicItems = useMemo(() => {
    const items = epics.data?.items ?? [];
    return orderFavoriteEpics(items, (e) => `${e.project.slug}:${e.id}`);
  }, [epics.data?.items, orderFavoriteEpics]);

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
      toast.success(`Снимок обновлён: ${res.epics} эпиков, ${res.tasks} задач`);
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
      <div className={EPICS_PAGE_SHELL}>
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
      <div className={EPICS_PAGE_SHELL}>
        <KanbanSnapshotRefreshBanner refreshState={bootstrap.data?.refresh_state} localPending={refresh.isPending} />
        <EmptyState
          icon={BarChart2}
          title="Снимок Kanban ещё не создан"
          description="Нажмите «Собрать данные», чтобы загрузить эпики, задачи и часы."
          action={
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={() => void doRefresh()}
              disabled={refreshRunning}
              data-testid="kanban-analytics-refresh"
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
    <div className={EPICS_PAGE_SHELL}>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold">Kanban · Эпики</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Снимок: {formatKanbanSnapshotTime(bootstrap.data.snapshot_updated_at)}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          onClick={() => void doRefresh()}
          disabled={refreshRunning}
          data-testid="kanban-analytics-refresh-top"
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
            placeholder="Поиск по названию эпика…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            data-testid="kanban-analytics-epics-search"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => toggleProject(p.slug)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                selectedProjects.has(p.slug) ? "bg-primary/15 text-primary border-primary/30" : "bg-card text-muted-foreground border-border hover:text-foreground"
              }`}
              data-testid={`kanban-analytics-project-chip-${p.slug}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {epics.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка эпиков…
        </div>
      ) : epics.isError ? (
        <EmptyState icon={BarChart2} title="Не удалось загрузить эпики" description="Попробуйте обновить снимок." />
      ) : (epics.data?.items?.length ?? 0) === 0 ? (
        <EmptyState icon={FolderKanban} title="Эпиков нет" description="По текущим фильтрам Kanban API не вернул эпиков." />
      ) : (
        <div className="grid grid-cols-1 gap-4 @md/kanban-epics:grid-cols-2">
          {epicItems.map((e) => {
            const ts = e.task_summary;
            const testStage = formatResonanceTestStage(e.local_meta?.active_test_stage);
            const qaLine = formatQaStatusShort(e.local_meta?.qa_status);
            const favoriteKey = `${e.project.slug}:${e.id}`;
            const favorite = isFavoriteEpic(favoriteKey);
            const qaFactHours = finiteNumber(e.local_meta?.qa_fact_hours);
            const estimateHours = finiteNumber(e.local_meta?.qa_estimate_hours);
            const hasEstimate = estimateHours != null && estimateHours > 0;
            const progressPercent = hasEstimate && qaFactHours != null ? (qaFactHours / estimateHours) * 100 : null;
            const progressBarPercent = progressPercent == null ? 0 : Math.min(100, Math.max(0, progressPercent));
            const deviationPercent = progressPercent == null ? null : progressPercent - 100;
            return (
              <div
                key={favoriteKey}
                className="relative rounded-xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-md"
                data-testid={`kanban-epic-${e.project.slug}-${e.id}`}
              >
                <Link
                  href={`/admin/kanban/analytics/epics/${e.id}?project_slug=${encodeURIComponent(e.project.slug)}`}
                  className="block cursor-pointer p-4 pr-14 md:p-5 md:pr-16"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground font-mono mb-1">{e.project.slug} · #{e.id}</div>
                  <div className="text-sm font-semibold text-foreground truncate">{e.name}</div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground flex-shrink-0">
                  {e.stage?.name ?? "—"}
                </span>
              </div>
              {ts ? (
                <div className="text-xs text-foreground/90 mb-1.5" data-testid="kanban-epic-card-task-summary">
                  всего: {ts.total}, в работе: {ts.in_progress}, завершено: {ts.completed}
                </div>
              ) : null}
              {(testStage || qaLine) ? (
                <div className="text-xs text-muted-foreground mb-1.5 space-y-0.5">
                  {testStage ? (
                    <div>
                      Этап тестирования (Resonance): <span className="text-foreground/90">{testStage}</span>
                      {qaLine ? <span className="text-muted-foreground"> · {qaLine}</span> : null}
                    </div>
                  ) : qaLine ? (
                    <div>
                      QA (Resonance): <span className="text-foreground/90">{qaLine}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground">
                QA: {e.local_meta?.qa_fact_hours ?? "—"} ч (оценка {e.local_meta?.qa_estimate_hours ?? "—"} ч)
              </div>
              <div className="mt-3 space-y-1.5" data-testid="kanban-epic-card-tracked-progress">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">
                    QA:{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {qaFactHours != null ? formatHours(qaFactHours) : "—"} ч
                    </span>{" "}
                    / {estimateHours != null ? `${formatHours(estimateHours)} ч` : "—"}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-medium tabular-nums",
                      deviationPercent == null
                        ? "text-muted-foreground"
                        : deviationPercent > 0
                          ? "text-destructive"
                          : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {deviationPercent != null ? formatDeviationPercent(deviationPercent) : "—"}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      deviationPercent != null && deviationPercent > 0 ? "bg-destructive" : "bg-primary",
                    )}
                    style={{ width: `${progressBarPercent}%` }}
                  />
                </div>
              </div>
                </Link>
                <button
                  type="button"
                  className={cn(
                    "absolute right-2 top-3 z-10 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-amber-500",
                    favorite && "text-amber-500 hover:text-amber-400",
                  )}
                  title={favorite ? "Убрать закрепление" : "Закрепить вверху списка"}
                  aria-label={favorite ? "Убрать закрепление эпика" : "Закрепить эпик"}
                  aria-pressed={favorite}
                  data-testid={`kanban-epic-favorite-${e.project.slug}-${e.id}`}
                  onClick={() => toggleFavoriteEpic(favoriteKey)}
                >
                  <Star size={18} className={cn(favorite ? "fill-amber-400 text-amber-400" : "fill-transparent")} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <ListPagination page={page} pageSize={pageSize} total={epics.data?.total ?? 0} isLoading={epics.isFetching} onPageChange={setPage} />
    </div>
  );
}
