import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FolderKanban, FolderOpen, HelpCircle, Layers, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ProjectFormDialog, apiProjectForRef, projectTeamIds } from "@/components/projects/ProjectFormDialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { PriorityBadge } from "@/components/shared/PriorityBadge";
import { QuestionStagnationBadge } from "@/components/shared/QuestionStagnationBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useDataBridgeVersion } from "@/data/_bridge";
import { epics } from "@/data/epics";
import { projects } from "@/data/projects";
import { questions } from "@/data/questions";
import type { User } from "@/data/users";
import { users } from "@/data/users";
import { useAuth } from "@/contexts/AuthContext";
import { useIsNotaWorkspace } from "@/hooks/useIsNotaWorkspace";
import { isCoordinatorRole, mapApiEpicToRefEpic, mapApiProjectToRefProject, mapApiTicketToRefQuestion, refIdToNumeric } from "@/lib/mappers";
import { Link, useParams, useLocation } from "@/lib/router";
import { useDeleteProject, useEpics, useProjects, useTickets, useUpdateProject, useUsers } from "@/lib/queries";
import type { ApiProject } from "@/lib/types";
import { formatDate } from "@/lib/formatDateTime";

/** Участники проекта по связи user ↔ project из каталога пользователей (совпадает с `project_ids` в API). */
function sortedTeamRefIdsForProject(projectRefId: string, userList: readonly User[]): string[] {
  return [...userList]
    .filter((u) => u.projectIds.includes(projectRefId))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((u) => u.id);
}

function sortedTeamNumericIdsForProject(projectRefId: string, userList: readonly User[]): number[] {
  return sortedTeamRefIdsForProject(projectRefId, userList)
    .map((uid) => refIdToNumeric(uid))
    .filter((n): n is number => n != null);
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const numericId = id ? refIdToNumeric(id) : null;
  const { me } = useAuth();
  const isNota = useIsNotaWorkspace();
  const ProjectIcon = isNota ? FolderOpen : FolderKanban;
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [epicsPage, setEpicsPage] = useState(1);
  const [questionsPage, setQuestionsPage] = useState(1);
  const pageSize = 25;

  const usersQuery = useUsers(me?.role === "admin");
  const dataBridgeV = useDataBridgeVersion();

  const projectsQuery = useProjects();
  const epicsQuery = useEpics({ project_id: numericId ?? -1, page: epicsPage, page_size: pageSize });
  const ticketsQuery = useTickets({ project_id: numericId ?? -1, page: questionsPage, page_size: pageSize });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  useEffect(() => {
    setEpicsPage(1);
    setQuestionsPage(1);
  }, [numericId]);

  const apiProject = apiProjectForRef(projectsQuery.data, id);
  const project = apiProject ? mapApiProjectToRefProject(apiProject) : projects.find((p) => p.id === id);

  const syncedUserNumericIds = useMemo(() => {
    if (me?.role !== "admin" || !usersQuery.isSuccess || !id) return null;
    return sortedTeamNumericIdsForProject(id, [...users]);
  }, [me?.role, usersQuery.isSuccess, id, dataBridgeV]);

  const initialProject = useMemo<ApiProject | null>(() => {
    let base: ApiProject | null = null;
    if (apiProject) base = apiProject;
    else if (project && numericId != null) {
      base = {
        id: numericId,
        name: project.name,
        config_json: {
          description: project.description,
          user_ids: project.teamMemberIds.map((teamId) => refIdToNumeric(teamId)).filter((n): n is number => n != null),
        },
      };
    }
    if (!base) return null;
    if (me?.role === "admin" && usersQuery.isSuccess && syncedUserNumericIds != null) {
      return {
        ...base,
        config_json: {
          ...base.config_json,
          user_ids: syncedUserNumericIds,
        },
      };
    }
    return base;
  }, [apiProject, numericId, project, me?.role, usersQuery.isSuccess, syncedUserNumericIds]);

  const projectEpics = epicsQuery.data
    ? [...(epicsQuery.data.items ?? [])]
        .map(mapApiEpicToRefEpic)
        .filter((e) => e.projectId === id)
        .sort((a, b) => (refIdToNumeric(b.id) ?? 0) - (refIdToNumeric(a.id) ?? 0))
    : epics.filter((e) => e.projectId === id);

  const projectQuestions = ticketsQuery.data
    ? [...(ticketsQuery.data.items ?? [])]
        .map(mapApiTicketToRefQuestion)
        .filter((q) => q.projectId === id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    : questions
        .filter((q) => q.projectId === id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const projectEpicsTotal = epicsQuery.data?.total ?? projectEpics.length;
  const projectQuestionsTotal = ticketsQuery.data?.total ?? projectQuestions.length;

  const teamIds = useMemo(() => {
    if (me?.role === "admin" && usersQuery.isSuccess && id) {
      return sortedTeamRefIdsForProject(id, [...users]);
    }
    if (apiProject) return projectTeamIds(apiProject);
    return project?.teamMemberIds ?? [];
  }, [me?.role, usersQuery.isSuccess, id, dataBridgeV, apiProject, project]);
  const canEdit =
    numericId != null &&
    me != null &&
    (me.role === "admin" || (isCoordinatorRole(me.role) && (me.project_ids ?? []).includes(numericId)));

  const removeProject = async () => {
    if (numericId == null) return;
    try {
      await deleteProject.mutateAsync(numericId);
      toast.success("Проект удалён");
      setDeleteOpen(false);
      setLocation("/projects");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить проект");
    }
  };

  if (projectsQuery.isLoading && !project) {
    return (
      <div className="p-4 md:p-6">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project || numericId == null) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState icon={ProjectIcon} title="Проект не найден" description={`Проект ${id} не существует`} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/projects">
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft size={13} /> Проекты
        </button>
      </Link>

      <div className="bg-card border border-border rounded-xl p-4 md:p-5 mb-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <ProjectIcon size={15} className="text-primary" />
              <span className="text-sm text-muted-foreground font-mono">{project.id}</span>
            </div>
            <h1 className="text-lg md:text-xl font-semibold text-foreground">{project.name}</h1>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex h-7 flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              data-testid="button-edit-project"
            >
              <Pencil size={12} />
              Изменить
            </button>
          )}
        </div>

        <p className="text-sm text-foreground/75 leading-relaxed mb-4">
          {project.description || "Описание проекта пока не заполнено"}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Эпики</p>
            <p className="text-lg font-semibold tabular-nums">{projectEpicsTotal}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Вопросы</p>
            <p className="text-lg font-semibold tabular-nums">{projectQuestionsTotal}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3 col-span-2 sm:col-span-1">
            <p className="text-[10px] text-muted-foreground mb-1">Команда</p>
            <p className="text-lg font-semibold tabular-nums">{teamIds.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Эпики</h3>
            {epicsQuery.isLoading && projectEpics.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Загружаем эпики...
              </div>
            ) : projectEpics.length === 0 ? (
              <EmptyState icon={Layers} title="Эпиков нет" description="В этом проекте пока нет эпиков" />
            ) : (
              <div className="space-y-2">
                {projectEpics.map((e) => (
                  <Link key={e.id} href={`/epics/${e.id}`}>
                    <div className="rounded-lg border border-border bg-background/40 p-3 transition-colors hover:border-primary/40 hover:bg-accent/30">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-muted-foreground font-mono">{e.id}</span>
                            <p className="text-sm text-foreground line-clamp-2">{e.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{e.description}</p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1 flex-wrap justify-end">
                          <StatusBadge status={e.epicStatus} size="sm" />
                          <StatusBadge status={e.qaStatus} size="sm" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                <ListPagination page={epicsPage} pageSize={pageSize} total={projectEpicsTotal} isLoading={epicsQuery.isFetching} onPageChange={setEpicsPage} />
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 md:p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Вопросы</h3>
            {ticketsQuery.isLoading && projectQuestions.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Загружаем вопросы...
              </div>
            ) : projectQuestions.length === 0 ? (
              <EmptyState icon={HelpCircle} title="Вопросов нет" description="В этом проекте пока нет вопросов" />
            ) : (
              <div className="space-y-2">
                {projectQuestions.map((q) => (
                  <Link key={q.id} href={`/questions/${q.id}`}>
                    <div className="rounded-lg border border-border bg-background/40 p-3 transition-colors hover:border-primary/40 hover:bg-accent/30">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">{q.id}</span>
                            <p className="text-sm text-foreground line-clamp-2">{q.title}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusBadge status={q.status} size="sm" />
                            <PriorityBadge priority={q.priority} />
                            <QuestionStagnationBadge updatedAt={q.updatedAt} />
                            {q.epicId && <span className="text-[10px] text-primary">{q.epicId}</span>}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <UserAvatar userId={q.assigneeId} size="sm" />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatDate(q.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                <ListPagination page={questionsPage} pageSize={pageSize} total={projectQuestionsTotal} isLoading={ticketsQuery.isFetching} onPageChange={setQuestionsPage} />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Команда</h3>
            {teamIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Команда проекта не указана</p>
            ) : (
              <div className="space-y-2">
                {teamIds.map((userId) => {
                  const user = users.find((u) => u.id === userId);
                  return (
                    <div key={userId} className="flex items-center gap-2">
                      <UserAvatar userId={userId} size="sm" />
                      <div className="min-w-0">
                        {user ? (
                          <Link href={`/users/${refIdToNumeric(user.id) ?? user.id}`}>
                            <span className="text-sm text-foreground truncate hover:underline">{user.name}</span>
                          </Link>
                        ) : (
                          <p className="text-sm text-foreground truncate">{userId}</p>
                        )}
                        {user && <p className="text-[10px] text-muted-foreground">{user.role}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ProjectFormDialog
        title="Редактирование проекта"
        open={editOpen}
        onOpenChange={setEditOpen}
        initialProject={initialProject}
        onSubmit={async (values) => {
          await updateProject.mutateAsync({ id: numericId, body: values });
          toast.success("Проект сохранён");
          setEditOpen(false);
        }}
        busy={updateProject.isPending}
        onDelete={
          me?.role === "admin"
            ? () => {
                setEditOpen(false);
                setDeleteOpen(true);
              }
            : undefined
        }
        deleteBusy={deleteProject.isPending}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить проект?</AlertDialogTitle>
            <AlertDialogDescription>
              Проект «{project.name}», все его эпики и связанные тикеты будут удалены без восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>Отмена</AlertDialogCancel>
            <button
              type="button"
              disabled={deleteProject.isPending}
              onClick={() => void removeProject()}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-70"
            >
              {deleteProject.isPending && <Loader2 size={14} className="animate-spin" />}
              Удалить
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
