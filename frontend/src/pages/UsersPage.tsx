import { useEffect, useState } from "react";
import { Loader2, Users, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { users, Role } from "@/data/users";
import { projects } from "@/data/projects";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { ListPagination } from "@/components/shared/ListPagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "@/lib/router";
import { useCreateUser, useDeleteUser, useReferenceData, useUpdateUser, useUsers as useUsersQuery } from "@/lib/queries";
import {
  ADMIN_EDITABLE_ROLES,
  BACKEND_ROLE_LABEL,
  mapApiUserToRefUser,
  refIdToNumeric,
  type RefUser,
} from "@/lib/mappers";
import type { ApiUser, BackendUserRole } from "@/lib/types";
import { USER_DIRECTION_OPTIONS_EXPERT } from "@/lib/validationTeam";

function normalizeEditableRole(role: BackendUserRole): BackendUserRole {
  return role === "manager" ? "coordinator" : role;
}

function normalizeDirectionValue(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "backend") return "back";
  if (v === "frontend") return "front";
  return v;
}

function directionPayloadValue(value: string): string | undefined {
  const normalized = normalizeDirectionValue(value);
  return normalized || undefined;
}

const roles: Role[] = ["Координатор", "Эксперт", "Разработчик", "Админ"];

const roleColors: Record<Role, string> = {
  "Координатор": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "Эксперт": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "Разработчик": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "Админ": "bg-red-500/15 text-red-700 dark:text-red-400",
};

const USER_DIRECTION_OPTIONS_DEV = [
  { value: "back", label: "Backend" },
  { value: "front", label: "Frontend" },
  { value: "qa", label: "QA" },
] as const;

type UserDirectionOption = { value: string; label: string };

function directionOptionsForRole(role: BackendUserRole): UserDirectionOption[] {
  if (role === "expert") return USER_DIRECTION_OPTIONS_EXPERT;
  if (role === "coordinator" || role === "manager" || role === "employee") return [...USER_DIRECTION_OPTIONS_DEV];
  return [];
}

function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const h = Math.floor(d / 3600000);
  if (h < 1) return "только что";
  if (h < 24) return `${h} ч. назад`;
  return `${Math.floor(h / 24)} д. назад`;
}

function UserCard({ u, onEdit }: { u: RefUser; onEdit: () => void }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex items-start gap-3" data-testid={`user-row-${u.id}`}>
      <UserAvatar userId={u.id} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Link href={`/users/${refIdToNumeric(u.id) ?? u.id}`}>
            <span className="text-sm font-medium text-foreground hover:underline">{u.name}</span>
          </Link>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${roleColors[u.role]}`}>{u.role}</span>
        </div>
        <p className="text-xs text-muted-foreground">{u.email}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {u.lastActive ? `Активен ${timeAgo(u.lastActive)}` : "—"}
        </p>
      </div>
      <button onClick={onEdit} className="text-xs text-primary hover:underline flex-shrink-0" data-testid={`button-edit-user-${u.id}`}>
        Изм.
      </button>
    </div>
  );
}

function projectNumericIds(u: RefUser): number[] {
  return (u.projectIds ?? []).map((id) => refIdToNumeric(id)).filter((n): n is number => n != null);
}

function apiUserForRef(apiUsers: ApiUser[] | undefined, ref: RefUser | null): ApiUser | null {
  if (!apiUsers || !ref) return null;
  const id = refIdToNumeric(ref.id);
  if (id == null) return null;
  return apiUsers.find((u) => u.id === id) ?? null;
}

function backendRoleForLabel(role: string): BackendUserRole | undefined {
  if (role === "all") return undefined;
  const match = Object.entries(BACKEND_ROLE_LABEL).find(([, label]) => label === role);
  return match?.[0] as BackendUserRole | undefined;
}

type FormValues = {
  username: string;
  password: string;
  role: BackendUserRole;
  workspace: "ds" | "nota";
  project_ids: number[];
  is_approved: boolean;
  direction: string;
};

export default function UsersPage() {
  const [roleFilter, setRoleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RefUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RefUser | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { me } = useAuth();
  const selectedBackendRole = backendRoleForLabel(roleFilter);
  const { data: apiUsersPage, isFetching: usersFetching } = useUsersQuery({
    page,
    page_size: pageSize,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(selectedBackendRole ? { role: selectedBackendRole } : {}),
  });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const isCurrentUser = (u: RefUser) => me != null && refIdToNumeric(u.id) === me.id;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = refIdToNumeric(deleteTarget.id);
    if (id == null) {
      toast.error("Некорректный идентификатор");
      return;
    }
    try {
      await deleteUser.mutateAsync(id);
      toast.success("Пользователь удалён");
      setDeleteTarget(null);
      if (editing && refIdToNumeric(editing.id) === id) setEditing(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось удалить пользователя";
      if (/your own account/i.test(msg)) toast.error("Нельзя удалить свою учётную запись");
      else toast.error(msg);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [roleFilter, search]);

  const apiUsers = apiUsersPage?.items;
  const filtered = apiUsers ? apiUsers.map(mapApiUserToRefUser) : users;
  const totalUsers = apiUsersPage?.total ?? filtered.length;

  const projectOptions = projects
    .map((p) => {
      const numeric = refIdToNumeric(p.id);
      return numeric != null ? { refId: p.id, numeric, name: p.name } : null;
    })
    .filter((p): p is { refId: string; numeric: number; name: string } => p !== null);

  const editingApi = apiUserForRef(apiUsers, editing);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold">Пользователи</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{totalUsers} в системе</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          data-testid="button-add-user"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="px-3 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 flex-1 min-w-[140px] max-w-[220px]"
          data-testid="input-user-search"
        />
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-role-filter">
            <SelectValue placeholder="Роль" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все роли</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="Пользователи не найдены" description="Измените параметры поиска" />
      ) : (
        <>
          <div className="md:hidden space-y-2">
            {filtered.map((u) => (
              <UserCard key={u.id} u={u} onEdit={() => setEditing(u)} />
            ))}
          </div>

          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full" data-testid="users-table">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground">Пользователь</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-28">Роль</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-24">Статус</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-28">Активность</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-medium text-muted-foreground w-20">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, idx) => (
                  <tr
                    key={u.id}
                    className={`border-b border-border/50 last:border-0 hover:bg-accent/40 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                    data-testid={`user-row-${u.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar userId={u.id} size="md" />
                        <Link href={`/users/${refIdToNumeric(u.id) ?? u.id}`}>
                          <span className="text-sm font-medium text-foreground hover:underline">{u.name}</span>
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{u.email}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${roleColors[u.role]}`}>{u.role}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${u.isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-slate-500/15 text-slate-600 dark:text-slate-400"}`}
                      >
                        {u.isActive ? "Активен" : "Неактивен"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{u.lastActive ? timeAgo(u.lastActive) : "—"}</td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => setEditing(u)} className="text-xs text-primary hover:underline">
                        Изменить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination page={page} pageSize={pageSize} total={totalUsers} isLoading={usersFetching} onPageChange={setPage} />
        </>
      )}

      <UserFormDialog
        title="Новый пользователь"
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        projectOptions={projectOptions}
        initialRef={null}
        initialApi={null}
        onSubmit={async (values) => {
          await createUser.mutateAsync({
            username: values.username.trim(),
            password: values.password,
            role: values.role,
            workspace: values.workspace,
            project_ids: values.project_ids,
            is_approved: values.is_approved,
            telegram_notifications: true,
            direction: directionPayloadValue(values.direction),
          });
          toast.success("Пользователь создан");
          setCreateOpen(false);
        }}
        busy={createUser.isPending}
      />

      <UserFormDialog
        title="Редактирование"
        open={editing != null}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        projectOptions={projectOptions}
        initialRef={editing}
        initialApi={editingApi}
        onSubmit={async (values) => {
          if (!editing) return;
          const id = refIdToNumeric(editing.id);
          if (id == null) {
            toast.error("Некорректный идентификатор");
            return;
          }
          await updateUser.mutateAsync({
            id,
            body: {
              username: values.username.trim(),
              password: values.password || undefined,
              role: values.role,
              workspace: values.workspace,
              project_ids: values.project_ids,
              is_approved: values.is_approved,
              direction: directionPayloadValue(values.direction),
            },
          });
          toast.success("Сохранено");
          setEditing(null);
        }}
        busy={updateUser.isPending}
        onRequestDelete={
          editing && !isCurrentUser(editing)
            ? () => {
                const u = editing;
                setEditing(null);
                setDeleteTarget(u);
              }
            : undefined
        }
        deleteBusy={deleteUser.isPending}
      />

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
            <AlertDialogDescription>
              Учётная запись «{deleteTarget?.name}» будет удалена. Это действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUser.isPending}>Отмена</AlertDialogCancel>
            <button
              type="button"
              disabled={deleteUser.isPending}
              onClick={() => void confirmDelete()}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-70"
            >
              {deleteUser.isPending && <Loader2 size={14} className="animate-spin" />}
              Удалить
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UserFormDialog({
  title,
  open,
  onOpenChange,
  mode,
  initialRef,
  initialApi,
  projectOptions,
  onSubmit,
  busy,
  onRequestDelete,
  deleteBusy = false,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialRef: RefUser | null;
  initialApi: ApiUser | null;
  projectOptions: { refId: string; numeric: number; name: string }[];
  onSubmit: (v: FormValues) => Promise<void>;
  busy: boolean;
  onRequestDelete?: () => void;
  deleteBusy?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<BackendUserRole>("employee");
  const [workspace, setWorkspace] = useState<"ds" | "nota">("ds");
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [isApproved, setIsApproved] = useState(true);
  const [direction, setDirection] = useState("");
  const [directionComment, setDirectionComment] = useState("");
  const reference = useReferenceData();
  const isEditHydrating = mode === "edit" && initialRef != null && initialApi == null;
  const directionOptionsForCurrentRole = (nextRole: BackendUserRole) =>
    reference.data?.role_directions?.[nextRole] ?? directionOptionsForRole(nextRole);

  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setUsername("");
      setPassword("");
      setRole("employee");
      setWorkspace("ds");
      setProjectIds([]);
      setIsApproved(true);
      setDirection("");
      setDirectionComment("");
      return;
    }
    if (!initialApi) return;
    if (initialRef && initialApi) {
      const nextRole = normalizeEditableRole(initialApi.role);
      const rawDirection = normalizeDirectionValue(initialApi.direction);
      const options = directionOptionsForCurrentRole(nextRole);
      const isKnownDirection = options.some((option) => option.value === rawDirection);
      setUsername(initialApi.username);
      setPassword("");
      setRole(nextRole);
      setWorkspace((initialApi.workspace === "nota" ? "nota" : "ds") as "ds" | "nota");
      setProjectIds(initialApi.project_ids ?? []);
      setIsApproved(initialApi.is_approved);
      setDirection(isKnownDirection ? rawDirection : "");
      setDirectionComment(rawDirection && !isKnownDirection ? rawDirection : "");
      return;
    }
  }, [open, mode, initialRef, initialApi]);

  const directionOptions = directionOptionsForCurrentRole(role);
  const showDirectionSelect = directionOptions.length > 0;

  const handleRoleChange = (nextRole: BackendUserRole) => {
    setRole(nextRole);
    const options = directionOptionsForCurrentRole(nextRole);
    const normalizedDirection = normalizeDirectionValue(direction);
    if (normalizedDirection !== direction) {
      setDirection(normalizedDirection);
    }
    if (!options.some((option) => option.value === normalizedDirection)) {
      setDirection(options[0]?.value ?? "");
    }
  };

  useEffect(() => {
    if (!open || isEditHydrating || !showDirectionSelect || direction) return;
    setDirection(directionOptions[0]?.value ?? "");
  }, [open, isEditHydrating, showDirectionSelect, direction, directionOptions]);

  const toggleProject = (id: number) => {
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditHydrating) {
      toast.error("Данные пользователя ещё загружаются");
      return;
    }
    if (!username.trim()) {
      toast.error("Укажите имя пользователя");
      return;
    }
    if (mode === "create" && !password.trim()) {
      toast.error("Задайте пароль");
      return;
    }
    if (showDirectionSelect && !direction) {
      toast.error("Выберите направление");
      return;
    }
    await onSubmit({
      username,
      password,
      role,
      workspace,
      project_ids: projectIds,
      is_approved: isApproved,
      direction,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Форма пользователя: логин, пароль, роль и проекты.</DialogDescription>
        </DialogHeader>
        {isEditHydrating ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Загружаем данные пользователя...
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Логин *</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              name="username"
              autoComplete="username"
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Пароль {mode === "create" ? "*" : "(оставьте пустым, чтобы не менять)"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoComplete="new-password"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Роль</label>
              <Select value={role} onValueChange={(v) => handleRoleChange(v as BackendUserRole)}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_EDITABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {BACKEND_ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Рабочее пространство</label>
              <Select value={workspace} onValueChange={(v) => setWorkspace(v as "ds" | "nota")}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ds">DS</SelectItem>
                  <SelectItem value="nota">Nota</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {showDirectionSelect && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Направление / команда *</label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Выберите направление" />
                </SelectTrigger>
                <SelectContent>
                  {directionOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {directionComment && (
                <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Комментарий из заявки</p>
                  <p className="mt-1 text-sm text-foreground break-words">{directionComment}</p>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Проекты</label>
            <div className="rounded-md border border-border p-2 space-y-2 max-h-36 overflow-y-auto">
              {projectOptions.map((p) => (
                <label key={p.numeric} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={projectIds.includes(p.numeric)} onCheckedChange={() => toggleProject(p.numeric)} />
                  <span>{p.name}</span>
                </label>
              ))}
              {projectOptions.length === 0 && <p className="text-xs text-muted-foreground">Нет проектов в списке</p>}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={isApproved} onCheckedChange={(v) => setIsApproved(Boolean(v))} />
            Учётная запись одобрена
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {mode === "edit" && onRequestDelete && (
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={onRequestDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 rounded-md disabled:opacity-70"
                  data-testid="button-delete-user-form"
                >
                  {deleteBusy && <Loader2 size={14} className="animate-spin" />}
                  <Trash2 size={14} />
                  Удалить пользователя
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2 ml-auto">
              <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm border border-border rounded-md">
                Отмена
              </button>
              <button
                type="submit"
                disabled={busy || isEditHydrating}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md flex items-center gap-2 disabled:opacity-70"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
