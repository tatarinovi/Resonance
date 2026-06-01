import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Layers, LayoutGrid, List, Plus } from "lucide-react";

import { CreateEpicDialog } from "@/components/epics/CreateEpicDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { EnvironmentPill } from "@/components/shared/EnvironmentPill";
import { ListPagination } from "@/components/shared/ListPagination";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import type { Epic } from "@/data/epics";
import { projects } from "@/data/projects";
import { useAuth } from "@/contexts/AuthContext";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";
import { isCoordinatorRole, mapApiEpicToRefEpic, refIdToNumeric } from "@/lib/mappers";
import { useEpics } from "@/lib/queries";
import { useLocation } from "@/lib/router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : pct > 0 ? "bg-amber-500" : "bg-slate-600";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{value}/{total}</span>
    </div>
  );
}

function EpicCard({ e, hideKanban }: { e: Epic; hideKanban: boolean }) {
  const [, setLocation] = useLocation();
  const envs = ["TEST", "STAGE", "PROD"] as const;
  const envOrder = { "TEST complete": 1, "STAGE complete": 2, "PROD complete": 3, "Закрыто": 3 };
  const completedUpTo = envOrder[e.qaStatus as keyof typeof envOrder] ?? 0;

  return (
    <div
      onClick={() => setLocation(`/epics/${e.id}`)}
      className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group"
      data-testid={`epic-card-${e.id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono">{e.id}</span>
            <ProjectBadge projectId={e.projectId} />
          </div>
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary leading-snug line-clamp-2">{e.name}</h3>
        </div>
        {e.blockers.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] bg-destructive/15 text-destructive border border-destructive/30 rounded px-1.5 py-0.5 font-medium flex-shrink-0">
            <AlertTriangle size={10} /> {e.blockers.length}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <StatusBadge status={e.epicStatus} size="sm" />
        <StatusBadge status={e.qaStatus} size="sm" />
      </div>

      <div className="flex items-center gap-1 flex-wrap mb-3">
        {envs.map((env, i) => (
          <EnvironmentPill key={env} env={env} active={e.activeEnvironment === env} done={completedUpTo > i && e.activeEnvironment !== env} />
        ))}
      </div>

      <div className="mb-3">
        <p className="text-[10px] text-muted-foreground mb-1">Тест-план</p>
        <ProgressBar value={e.testCasesCompleted} total={e.testCasesTotal} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center -space-x-1">
          <UserAvatar userId={e.leadAnalystId} size="sm" />
          <UserAvatar userId={e.leadDesignerId} size="sm" />
        </div>
        <div className="flex items-center gap-2">
          {e.openQuestionsCount > 0 && <span className="text-[10px] text-muted-foreground">{e.openQuestionsCount} вопр.</span>}
          <div className="flex gap-2">
            {([
              ["Jira", e.jiraLink],
              ...(hideKanban ? [] : [["Kanban", e.kanbanLink] as const]),
            ] as const).map(([label, href]) => (
              href !== "#" ? (
                <a key={label} href={href as string} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                  <ExternalLink size={9} /> {label}
                </a>
              ) : (
                <span key={label} className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                  <ExternalLink size={9} /> {label}
                </span>
              )
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EpicsPage() {
  const hideKanban = useIsNotaWorkspace();
  const { me } = useAuth();
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const canCreateEpic = me?.role === "admin" || isCoordinatorRole(me?.role);
  const projectNumericId = projectFilter === "all" ? undefined : refIdToNumeric(projectFilter);

  useEffect(() => {
    setPage(1);
  }, [projectFilter, statusFilter]);

  const epicsQuery = useEpics({
    page,
    page_size: pageSize,
    ...(projectNumericId != null ? { project_id: projectNumericId } : {}),
    ...(statusFilter === "all" ? {} : { status: statusFilter }),
  });
  const rows = useMemo(() => (epicsQuery.data?.items ?? []).map(mapApiEpicToRefEpic), [epicsQuery.data?.items]);
  const total = epicsQuery.data?.total ?? 0;

  return (
    <div className="p-4 md:p-6">
      <h1 className="sr-only">Эпики</h1>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          <span className="text-lg font-semibold tabular-nums text-foreground">{total}</span> эпиков
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {canCreateEpic && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              data-testid="button-create-epic"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Новый эпик</span>
              <span className="sm:hidden">Эпик</span>
            </button>
          )}
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-7 text-xs w-36 sm:w-44" data-testid="select-epic-page-project">
              <SelectValue placeholder="Проект" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все проекты</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs w-28 sm:w-32" data-testid="select-epic-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="new">Новый</SelectItem>
              <SelectItem value="in-progress">В работе</SelectItem>
              <SelectItem value="released">Выпущен</SelectItem>
            </SelectContent>
          </Select>
          <div className="hidden sm:flex items-center gap-0.5 bg-muted p-0.5 rounded-md">
            <button onClick={() => setView("grid")} className={`p-1.5 rounded ${view === "grid" ? "bg-card shadow-sm" : "text-muted-foreground"}`} data-testid="button-view-grid"><LayoutGrid size={14} /></button>
            <button onClick={() => setView("list")} className={`p-1.5 rounded ${view === "list" ? "bg-card shadow-sm" : "text-muted-foreground"}`} data-testid="button-view-list"><List size={14} /></button>
          </div>
        </div>
      </div>

      <CreateEpicDialog open={createOpen} onOpenChange={setCreateOpen} defaultProjectRefId={projectFilter === "all" ? null : projectFilter} />

      {rows.length === 0 ? (
        <EmptyState icon={Layers} title={epicsQuery.isLoading ? "Загружаем эпики" : "Эпиков не найдено"} description="Измените фильтры" />
      ) : (
        <>
          <div className={view === "grid" ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" : "space-y-3"}>
            {rows.map((e) => (
              <EpicCard key={e.id} e={e} hideKanban={hideKanban} />
            ))}
          </div>
          <ListPagination page={page} pageSize={pageSize} total={total} isLoading={epicsQuery.isFetching} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
