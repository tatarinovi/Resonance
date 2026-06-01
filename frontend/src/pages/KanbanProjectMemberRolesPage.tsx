import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ApiError } from "@/lib/api";
import {
  KANBAN_MEMBER_PROJECT_ROLE_ORDER,
  useKanbanProjectMemberRoles,
  usePutKanbanProjectMemberRoles,
  type KanbanMemberProjectRole,
  type KanbanMemberRoleRow,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Link } from "@/lib/router";

export default function KanbanProjectMemberRolesPage() {
  const params = useParams();
  const slug = (params as { slug?: string }).slug ?? "";

  const rolesQ = useKanbanProjectMemberRoles(slug || null, Boolean(slug));
  const putRoles = usePutKanbanProjectMemberRoles(slug);

  const [draft, setDraft] = useState<Record<number, KanbanMemberProjectRole>>({});

  const members = rolesQ.data?.members ?? [];

  useEffect(() => {
    if (!rolesQ.data?.members) return;
    const next: Record<number, KanbanMemberProjectRole> = {};
    for (const m of rolesQ.data.members) {
      next[m.kanban_user_id] = m.role;
    }
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

  if (!slug) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <EmptyState title="Нет slug проекта" description="Откройте страницу через «Роли команды» в списке проектов Kanban или выберите проект на странице выбора." />
      </div>
    );
  }

  if (rolesQ.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка участников…
      </div>
    );
  }

  if (rolesQ.isError) {
    const err = rolesQ.error as unknown;
    const needsConnect = err instanceof ApiError && [401, 403, 409].includes(err.status);
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <EmptyState
          title="Не удалось загрузить роли"
          description={needsConnect ? "Подключите Kanban в сайдбаре." : err instanceof ApiError ? err.message : "Ошибка"}
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
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <Link
        href="/admin/kanban/team-roles"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К выбору проекта для ролей
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Роли команды Kanban</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{slug}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Роль привязана к пользователю Kanban и одна на все проекты: изменение здесь сразу отражается везде.
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
                    <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">Роль не назначена (Other)</div>
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
    </div>
  );
}
