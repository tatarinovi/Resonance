import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { ArrowLeft, Loader2, Save, Users } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ApiError } from "@/lib/api";
import { useKanbanFavoriteProjectSlugs } from "@/hooks/useKanbanFavoriteProjectSlugs";
import {
  KANBAN_MEMBER_PROJECT_ROLE_ORDER,
  useKanbanProjectMemberRoles,
  usePutKanbanProjectMemberRoles,
  type KanbanMemberProjectRole,
  type KanbanMemberRoleRow,
} from "@/lib/queries";
import { useKanbanProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function KanbanTeamRolesHubPage() {
  const projects = useKanbanProjects(true);
  const { orderProjects } = useKanbanFavoriteProjectSlugs();
  const [slug, setSlug] = useState<string>("");

  const list = projects.data ?? [];
  const displayList = useMemo(() => orderProjects(list), [list, orderProjects]);
  const selected = useMemo(() => displayList.find((p) => p.slug === slug) ?? null, [displayList, slug]);

  const rolesQ = useKanbanProjectMemberRoles(slug || null, Boolean(slug));
  const putRoles = usePutKanbanProjectMemberRoles(slug || "");

  const [draft, setDraft] = useState<Record<number, KanbanMemberProjectRole>>({});
  const members = rolesQ.data?.members ?? [];

  useEffect(() => {
    if (!rolesQ.data?.members) return;
    const next: Record<number, KanbanMemberProjectRole> = {};
    for (const m of rolesQ.data.members) next[m.kanban_user_id] = m.role;
    setDraft(next);
  }, [rolesQ.data?.members]);

  const dirty = useMemo(() => {
    if (!rolesQ.data?.members) return false;
    for (const m of rolesQ.data.members) {
      if (draft[m.kanban_user_id] !== m.role) return true;
    }
    return false;
  }, [rolesQ.data?.members, draft]);

  const save = async () => {
    if (!slug) return;
    const roles = Object.entries(draft).map(([kanban_user_id, role]) => ({
      kanban_user_id: Number(kanban_user_id),
      role,
    }));
    try {
      await putRoles.mutateAsync(roles);
      toast.success("Роли сохранены");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    }
  };

  if (projects.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка проектов…
      </div>
    );
  }

  if (projects.isError) {
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto">
        <EmptyState title="Не удалось загрузить проекты" description="Проверьте подключение Kanban и повторите попытку." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <Link
        href="/admin/kanban/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку проектов Kanban
      </Link>

      <div className="mb-6">
        <h1 className="text-lg font-semibold">Роли команды</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Роли привязаны к пользователям Kanban и общие для всех проектов. После выбора проекта ниже сразу покажем
          список участников и форму редактирования ролей.
        </p>
      </div>

      {list.length === 0 ? (
        <EmptyState title="Проектов нет" description="Сначала появятся проекты в Kanban, затем можно настроить роли." />
      ) : (
        <>
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
            <label className="block text-sm font-medium text-foreground" htmlFor="kanban-team-roles-project">
              Проект
            </label>
            <select
              id="kanban-team-roles-project"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            >
              <option value="">Выберите проект…</option>
              {displayList.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </div>

          {slug ? (
            <div className="mt-6">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Роли в проекте</h2>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{selected?.name ?? slug}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Для графиков учёта времени по отделам без явной роли используется «Other»; такие строки подсвечены.
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  disabled={!dirty || putRoles.isPending}
                  onClick={() => void save()}
                >
                  {putRoles.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Сохранить
                </button>
              </div>

              {rolesQ.isLoading ? (
                <div className="flex h-[35vh] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загрузка участников…
                </div>
              ) : rolesQ.isError ? (
                (() => {
                  const err = rolesQ.error as unknown;
                  const needsConnect = err instanceof ApiError && [401, 403, 409].includes(err.status);
                  return (
                    <div className="p-4 md:p-6 max-w-3xl mx-auto">
                      <EmptyState
                        title="Не удалось загрузить роли"
                        description={
                          needsConnect ? "Подключите Kanban в сайдбаре." : err instanceof ApiError ? err.message : "Ошибка"
                        }
                        action={
                          needsConnect ? (
                            <button
                              type="button"
                              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                              onClick={() => window.dispatchEvent(new Event("resonance:kanban-login"))}
                            >
                              Подключить Kanban
                            </button>
                          ) : null
                        }
                      />
                    </div>
                  );
                })()
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Участник</th>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Роль</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m: KanbanMemberRoleRow) => (
                        <tr
                          key={m.kanban_user_id}
                          className={cn(
                            "border-t border-border",
                            !m.role_explicit && "bg-amber-500/[0.06] ring-1 ring-inset ring-amber-500/25",
                          )}
                        >
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-foreground">{m.display_name}</div>
                            {!m.role_explicit ? (
                              <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                                Роль не назначена (Other)
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{m.kanban_user_id}</td>
                          <td className="px-3 py-2.5">
                            <select
                              className="w-full max-w-[200px] rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                              value={draft[m.kanban_user_id] ?? m.role}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  [m.kanban_user_id]: e.target.value as KanbanMemberProjectRole,
                                }))
                              }
                            >
                              {KANBAN_MEMBER_PROJECT_ROLE_ORDER.map((r) => (
                                <option key={r} value={r}>
                                  {r === "Other" ? "Other (прочее)" : r}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
