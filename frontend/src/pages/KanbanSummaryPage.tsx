import { useEffect, useMemo, useState } from "react";
import { format, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { BarChart2, CalendarDays, Check, ChevronsUpDown, Loader2, RefreshCw, Star } from "lucide-react";
import { toast } from "sonner";

import { KanbanSnapshotRefreshBanner, formatKanbanSnapshotTime, isKanbanSnapshotRefreshing } from "@/components/kanban-analytics/KanbanSnapshotRefreshBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { KANBAN_FAVORITE_USERS_STORAGE_KEY, useKanbanFavoriteItems } from "@/hooks/useKanbanFavoriteItems";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/formatDateTime";
import {
  useKanbanAnalyticsBootstrap,
  useKanbanAnalyticsRefresh,
  useKanbanDailySummary,
  type KanbanDailySummaryTaskNode,
  type KanbanDailySummaryWorklog,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE_SHELL = "mx-auto box-border w-[min(100%,76rem)] min-w-0 px-4 py-4 md:px-6 md:py-6";

function ymdToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(value: string): Date | undefined {
  const d = parse(value, "yyyy-MM-dd", new Date());
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} м`;
  if (h > 0) return `${h} ч`;
  return `${m} м`;
}

function WorklogRow({ row }: { row: KanbanDailySummaryWorklog }) {
  return (
    <li className="flex flex-col gap-2 border-t border-border px-3 py-2.5 first:border-t-0 @md/kanban-summary:flex-row @md/kanban-summary:items-start @md/kanban-summary:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{row.user_name}</span>
          {row.member_role ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{row.member_role}</span> : null}
          <span>{row.begin ? formatDateTime(row.begin) : "—"}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
          {row.comment?.trim() ? row.comment.trim() : <span className="text-muted-foreground">Без описания</span>}
        </p>
      </div>
      <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
        {formatMinutes(row.minutes)}
      </div>
    </li>
  );
}

function TaskNode({ node }: { node: KanbanDailySummaryTaskNode }) {
  const task = node.task;
  const taskName = task.name?.trim() || `#${task.id}`;
  return (
    <section className="overflow-hidden rounded-md border border-border bg-background" data-testid={`kanban-summary-task-${task.id}`}>
      <header className="flex flex-col gap-1 border-b border-border bg-muted/30 px-3 py-2 @md/kanban-summary:flex-row @md/kanban-summary:items-center @md/kanban-summary:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-muted-foreground">#{task.id}</div>
          {task.url ? (
            <a href={task.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-primary hover:underline">
              {taskName}
            </a>
          ) : (
            <div className="truncate text-sm font-medium text-foreground">{taskName}</div>
          )}
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">
          {node.worklogs.length} записей · <span className="font-semibold text-foreground">{formatMinutes(node.total_minutes)}</span>
        </div>
      </header>
      <ul>
        {node.worklogs.map((row, index) => (
          <WorklogRow key={`${row.task_id}-${row.begin}-${index}`} row={row} />
        ))}
      </ul>
    </section>
  );
}

function SummaryDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseYmd(value);
  const label = selected ? format(selected, "d MMMM yyyy", { locale: ru }) : "Выбрать день";

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">День</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-9 justify-start gap-2 px-3 text-sm font-normal"
            data-testid="kanban-summary-day"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            locale={ru}
            onSelect={(date) => {
              if (!date) return;
              onChange(format(date, "yyyy-MM-dd"));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function UserCombobox({
  users,
  value,
  onChange,
}: {
  users: { id: number; name: string }[];
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const {
    orderItems: orderFavoriteUsers,
    isFavorite: isFavoriteUser,
    toggleFavorite: toggleFavoriteUser,
  } = useKanbanFavoriteItems(KANBAN_FAVORITE_USERS_STORAGE_KEY);
  const selected = users.find((user) => user.id === value);
  const orderedUsers = useMemo(() => orderFavoriteUsers(users, (user) => String(user.id)), [orderFavoriteUsers, users]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Пользователь</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 justify-between gap-2 px-3 text-sm font-normal"
            data-testid="kanban-summary-user"
          >
            <span className="truncate">{selected?.name ?? "Пользователь из снимка"}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput placeholder="Найти пользователя..." />
            <CommandList>
              <CommandEmpty>Пользователь не найден</CommandEmpty>
              <CommandGroup>
                {orderedUsers.map((user) => {
                  const favoriteKey = String(user.id);
                  const favorite = isFavoriteUser(favoriteKey);
                  return (
                    <CommandItem
                      key={user.id}
                      value={`${user.name} ${user.id}`}
                      onSelect={() => {
                        onChange(user.id);
                        setOpen(false);
                      }}
                      data-testid={`kanban-summary-user-option-${user.id}`}
                    >
                      <Check className={cn("h-4 w-4", value === user.id ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1 truncate">{user.name}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">#{user.id}</span>
                      <button
                        type="button"
                        className={cn(
                          "ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-amber-500",
                          favorite && "text-amber-500 hover:text-amber-400",
                        )}
                        title={favorite ? "Убрать закрепление" : "Закрепить вверху списка"}
                        aria-label={favorite ? "Убрать закрепление пользователя" : "Закрепить пользователя"}
                        aria-pressed={favorite}
                        data-testid={`kanban-summary-user-favorite-${user.id}`}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleFavoriteUser(favoriteKey);
                        }}
                      >
                        <Star className={cn("h-4 w-4", favorite ? "fill-amber-400 text-amber-400" : "fill-transparent")} />
                      </button>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function KanbanSummaryPage() {
  const bootstrap = useKanbanAnalyticsBootstrap(true, true);
  const refresh = useKanbanAnalyticsRefresh();
  const refreshRunning = isKanbanSnapshotRefreshing(bootstrap.data?.refresh_state, refresh.isPending);
  const [day, setDay] = useState(() => ymdToday());
  const [kanbanUserId, setKanbanUserId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (kanbanUserId != null) return;
    const id = bootstrap.data?.current_user?.id;
    if (typeof id === "number" && id > 0) setKanbanUserId(id);
  }, [bootstrap.data?.current_user?.id, kanbanUserId]);

  const summary = useKanbanDailySummary(
    { day, kanban_user_id: kanbanUserId },
    (bootstrap.data?.snapshot_ready ?? false) && !!day,
  );

  const users = useMemo(() => {
    const fromSummary = summary.data?.users ?? [];
    const current = bootstrap.data?.current_user;
    if (!current?.id) return fromSummary;
    if (fromSummary.some((u) => u.id === current.id)) return fromSummary;
    return [{ id: current.id, name: current.name ?? `#${current.id}` }, ...fromSummary];
  }, [bootstrap.data?.current_user, summary.data?.users]);

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
      <div className={PAGE_SHELL}>
        <KanbanSnapshotRefreshBanner refreshState={bootstrap.data?.refresh_state} localPending={refresh.isPending} />
        <EmptyState
          icon={BarChart2}
          title="Не удалось загрузить Kanban аналитику"
          description={needsConnect ? "Подключите Kanban в сайдбаре и попробуйте снова." : "Проверьте подключение Kanban и права доступа."}
          action={
            needsConnect ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
      <div className={PAGE_SHELL}>
        <KanbanSnapshotRefreshBanner refreshState={bootstrap.data?.refresh_state} localPending={refresh.isPending} />
        <EmptyState
          icon={CalendarDays}
          title="Снимок Kanban ещё не создан"
          description="Нажмите «Собрать данные», чтобы загрузить эпики, задачи и списания времени."
          action={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              onClick={() => void doRefresh()}
              disabled={refreshRunning}
              data-testid="kanban-summary-refresh-empty"
            >
              {refreshRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Собрать данные
            </button>
          }
        />
      </div>
    );
  }

  const totalLabel = summary.data ? formatMinutes(summary.data.summary.total_minutes) : "—";

  return (
    <div className={`${PAGE_SHELL} @container/kanban-summary`}>
      <div className="mb-5 flex flex-col gap-4 @lg/kanban-summary:flex-row @lg/kanban-summary:items-start @lg/kanban-summary:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Kanban · Сводка</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Снимок: {formatKanbanSnapshotTime(bootstrap.data.snapshot_updated_at)}</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          onClick={() => void doRefresh()}
          disabled={refreshRunning}
          data-testid="kanban-summary-refresh"
        >
          {refreshRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </button>
      </div>

      <KanbanSnapshotRefreshBanner refreshState={bootstrap.data.refresh_state} localPending={refresh.isPending} />

      <div className="mb-4 grid gap-3 rounded-lg border border-border bg-card p-3 shadow-sm @lg/kanban-summary:grid-cols-[1fr_1fr_auto] @lg/kanban-summary:items-end">
        <SummaryDatePicker value={day} onChange={setDay} />
        <UserCombobox users={users} value={kanbanUserId} onChange={setKanbanUserId} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDay(ymdToday())}
            data-testid="kanban-summary-today"
          >
            Сегодня
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDay(ymdYesterday())}
            data-testid="kanban-summary-yesterday"
          >
            Вчера
          </button>
        </div>
      </div>

      {summary.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка сводки…
        </div>
      ) : summary.isError ? (
        <EmptyState icon={CalendarDays} title="Не удалось загрузить сводку" description="Попробуйте обновить снимок Kanban." />
      ) : (summary.data?.projects.length ?? 0) === 0 ? (
        <EmptyState icon={CalendarDays} title="Списаний нет" description="За выбранный день и пользователя в снимке Kanban нет списаний времени." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 text-sm @md/kanban-summary:grid-cols-4">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Всего</div>
              <div className="mt-1 font-semibold tabular-nums">{totalLabel}</div>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Проекты</div>
              <div className="mt-1 font-semibold tabular-nums">{summary.data?.summary.projects}</div>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Задачи</div>
              <div className="mt-1 font-semibold tabular-nums">{summary.data?.summary.tasks}</div>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Записи</div>
              <div className="mt-1 font-semibold tabular-nums">{summary.data?.summary.worklogs}</div>
            </div>
          </div>

          {summary.data?.projects.map((projectNode) => (
            <section key={projectNode.project.slug} className="rounded-lg border border-border bg-card p-3 shadow-sm" data-testid={`kanban-summary-project-${projectNode.project.slug}`}>
              <header className="mb-3 flex flex-col gap-1 @md/kanban-summary:flex-row @md/kanban-summary:items-center @md/kanban-summary:justify-between">
                <div>
                  <div className="text-[11px] font-mono text-muted-foreground">{projectNode.project.slug}</div>
                  <h2 className="text-base font-semibold text-foreground">{projectNode.project.name}</h2>
                </div>
                <div className="text-sm font-semibold tabular-nums text-foreground">{formatMinutes(projectNode.total_minutes)}</div>
              </header>

              <div className="space-y-3">
                {projectNode.epics.map((epicNode) => (
                  <section key={epicNode.epic.id} className="rounded-md border border-border bg-muted/20 p-3" data-testid={`kanban-summary-epic-${epicNode.epic.id}`}>
                    <header className="mb-2 flex flex-col gap-1 @md/kanban-summary:flex-row @md/kanban-summary:items-center @md/kanban-summary:justify-between">
                      <div className="min-w-0">
                        <div className="text-[11px] font-mono text-muted-foreground">Эпик #{epicNode.epic.id}</div>
                        {epicNode.epic.url ? (
                          <a href={epicNode.epic.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-primary hover:underline">
                            {epicNode.epic.name}
                          </a>
                        ) : (
                          <div className="truncate text-sm font-semibold text-foreground">{epicNode.epic.name}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">
                        {epicNode.tasks.length} задач · <span className="font-semibold text-foreground">{formatMinutes(epicNode.total_minutes)}</span>
                      </div>
                    </header>
                    <div className="space-y-2">
                      {epicNode.tasks.map((taskNode) => (
                        <TaskNode key={taskNode.task.id} node={taskNode} />
                      ))}
                    </div>
                  </section>
                ))}

                {projectNode.without_epic.tasks.length > 0 ? (
                  <section className="rounded-md border border-border bg-muted/20 p-3" data-testid={`kanban-summary-without-epic-${projectNode.project.slug}`}>
                    <header className="mb-2 flex flex-col gap-1 @md/kanban-summary:flex-row @md/kanban-summary:items-center @md/kanban-summary:justify-between">
                      <div className="text-sm font-semibold text-foreground">Без эпика</div>
                      <div className="shrink-0 text-xs text-muted-foreground">
                        {projectNode.without_epic.tasks.length} задач ·{" "}
                        <span className="font-semibold text-foreground">{formatMinutes(projectNode.without_epic.total_minutes)}</span>
                      </div>
                    </header>
                    <div className="space-y-2">
                      {projectNode.without_epic.tasks.map((taskNode) => (
                        <TaskNode key={taskNode.task.id} node={taskNode} />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
