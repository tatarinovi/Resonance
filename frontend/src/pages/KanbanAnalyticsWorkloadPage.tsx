import { useMemo, useState } from "react";
import { BarChart2, Loader2 } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Link } from "@/lib/router";
import { ApiError } from "@/lib/api";
import { useKanbanAnalyticsBootstrap, useKanbanAnalyticsEpics } from "@/lib/queries";

/**
 * В API нет отдельного endpoint “team workload overall”, поэтому делаем
 * workload-страницу как выбор эпика → открытие его detail (там есть workload).
 */
export default function KanbanAnalyticsWorkloadPage() {
  const bootstrap = useKanbanAnalyticsBootstrap(true);
  const [selectedProject, setSelectedProject] = useState<string>("all");

  const project_slugs = useMemo(() => (selectedProject === "all" ? undefined : selectedProject), [selectedProject]);
  const epics = useKanbanAnalyticsEpics({ project_slugs, page: 1, page_size: 100 }, bootstrap.data?.snapshot_ready ?? false);

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
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
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
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <EmptyState
          icon={BarChart2}
          title="Снимок Kanban ещё не создан"
          description="Перейдите в «Эпики» и нажмите «Собрать данные»."
        />
      </div>
    );
  }

  const projects = bootstrap.data.projects ?? [];
  const list = epics.data?.items ?? [];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Kanban · Нагрузка</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Выберите эпик — в его карточке будет доступен workload (часы по людям).
        </p>
      </div>

      <div className="mb-4">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Проект</label>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="w-full max-w-md text-sm"
        >
          <option value="all">Все проекты</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {epics.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка эпиков…
        </div>
      ) : (list.length ?? 0) === 0 ? (
        <EmptyState icon={BarChart2} title="Эпиков нет" description="Выберите другой проект или обновите снимок." />
      ) : (
        <div className="space-y-2">
          {list.map((e) => (
            <Link
              key={`${e.project.slug}-${e.id}`}
              href={`/admin/kanban/analytics/epics/${e.id}?project_slug=${encodeURIComponent(e.project.slug)}`}
              className="block bg-card border border-border rounded-lg p-3 hover:border-primary/40 transition-colors"
            >
              <div className="text-sm font-medium text-foreground">{e.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {e.project.slug} · #{e.id} · {e.stage?.name ?? "—"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
