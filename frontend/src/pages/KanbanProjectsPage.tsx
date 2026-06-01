import { useMemo } from "react";
import { Link } from "@/lib/router";
import { FolderKanban, Loader2, Star, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { useKanbanFavoriteProjectSlugs } from "@/hooks/useKanbanFavoriteProjectSlugs";
import { useKanbanProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function KanbanProjectsPage() {
  const projects = useKanbanProjects(true);
  const { toggleFavorite, isFavorite, orderProjects } = useKanbanFavoriteProjectSlugs();

  const list = projects.data ?? [];
  const displayList = useMemo(() => orderProjects(list), [list, orderProjects]);

  if (projects.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка проектов Kanban…
        </div>
      </div>
    );
  }

  if (projects.isError) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <EmptyState
          icon={FolderKanban}
          title="Не удалось загрузить проекты Kanban"
          description="Проверьте подключение Kanban (токен) и повторите попытку."
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Kanban проекты</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Список проектов, доступных через Kanban API. Звёздочка закрепляет проект вверху списка на этом устройстве.
          </p>
        </div>
        <Link
          href="/admin/kanban/team-roles"
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/60"
        >
          <Users className="h-4 w-4 text-muted-foreground" />
          Роли команды
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Проектов нет"
          description="Kanban API вернул пустой список проектов."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {displayList.map((p) => {
            const fav = isFavorite(p.slug);
            return (
              <div
                key={p.slug}
                className="relative rounded-xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-sm"
                data-testid={`kanban-project-card-${p.slug}`}
              >
                <Link
                  href={`/admin/kanban/projects/${encodeURIComponent(p.slug)}`}
                  state={{ name: p.name }}
                  className="block p-4 pr-14 md:p-5 md:pr-16"
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="mb-1 flex items-center gap-2">
                        <FolderKanban size={14} className="shrink-0 text-primary" />
                        <span className="font-mono text-[10px] text-muted-foreground">{p.slug}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">ID: {p.id ?? "—"}</div>
                </Link>
                <button
                  type="button"
                  className={cn(
                    "absolute right-2 top-3 z-10 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-amber-500",
                    fav && "text-amber-500 hover:text-amber-400",
                  )}
                  title={fav ? "Убрать из избранного" : "В избранное — закрепить вверху списка"}
                  aria-label={fav ? "Убрать проект из избранного" : "Добавить проект в избранное"}
                  aria-pressed={fav}
                  data-testid={`kanban-project-favorite-${p.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(p.slug);
                  }}
                >
                  <Star size={18} className={cn(fav ? "fill-amber-400 text-amber-400" : "fill-transparent")} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

