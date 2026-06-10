import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, HelpCircle, Layers, MessageSquare, RefreshCw } from "lucide-react";

import type { ActivityType } from "@/data/activity";
import { users } from "@/data/users";
import { ListPagination } from "@/components/shared/ListPagination";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatCalendarDay, formatTime } from "@/lib/formatDateTime";
import { mapActivity, refIdToNumeric } from "@/lib/mappers";
import { useActivity } from "@/lib/queries";
import { Link } from "@/lib/router";

const typeIcon: Record<ActivityType, typeof Activity> = {
  question: HelpCircle,
  epic: Layers,
  status: RefreshCw,
  comment: MessageSquare,
  blocker: AlertTriangle,
};

const typeBorder: Record<ActivityType, string> = {
  question: "border-l-violet-500",
  epic: "border-l-blue-500",
  status: "border-l-emerald-500",
  comment: "border-l-slate-500",
  blocker: "border-l-red-500",
};

const typeLabel: Record<ActivityType, string> = {
  question: "Вопрос",
  epic: "Эпик",
  status: "Статус",
  comment: "Комм.",
  blocker: "Блокер",
};

type ActivityRow = ReturnType<typeof mapActivity>;

function groupByDay(events: ActivityRow[]) {
  const groups: { date: string; events: ActivityRow[] }[] = [];
  events.forEach((event) => {
    const day = formatCalendarDay(event.date);
    const group = groups.find((g) => g.date === day);
    if (group) group.events.push(event);
    else groups.push({ date: day, events: [event] });
  });
  return groups;
}

function targetTypeForFilter(filter: "all" | ActivityType): string | undefined {
  if (filter === "all") return undefined;
  if (filter === "epic" || filter === "blocker") return "epic";
  return "question";
}

export default function ActivityPage() {
  const [filter, setFilter] = useState<"all" | ActivityType>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const activity = useActivity({
    page,
    page_size: pageSize,
    ...(targetTypeForFilter(filter) ? { target_type: targetTypeForFilter(filter) } : {}),
    ...(filter === "all" ? {} : { activity_type: filter }),
  });
  const rows = useMemo(
    () => (activity.data?.items ?? []).map(mapActivity),
    [activity.data?.items],
  );
  const groups = groupByDay(rows);
  const total = activity.data?.total ?? 0;

  const filters: { value: "all" | ActivityType; label: string }[] = [
    { value: "all", label: "Все" },
    { value: "question", label: "Вопросы" },
    { value: "epic", label: "Эпики" },
    { value: "status", label: "Статусы" },
    { value: "comment", label: "Комменты" },
    { value: "blocker", label: "Блокеры" },
  ];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Активность</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Все действия в системе</p>
      </div>

      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
              filter === f.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            data-testid={`filter-${f.value}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {groups.map((group) => (
        <div key={group.date} className="mb-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">{group.date}</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="space-y-2">
            {group.events.map((event) => {
              const user = users.find((u) => u.id === event.userId);
              const border = typeBorder[event.type];
              const Icon = typeIcon[event.type];
              return (
                <div
                  key={event.id}
                  className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2.5 pl-3 border-l-2 ${border} bg-card rounded-r-lg py-2.5 pr-3`}
                  data-testid={`activity-${event.id}`}
                >
                  <div className="pt-0.5">
                    <UserAvatar userId={event.userId} size="sm" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      {user ? (
                        <Link href={`/users/${refIdToNumeric(user.id) ?? user.id}`}>
                          <span className="block max-w-[140px] truncate text-xs font-semibold text-foreground hover:underline sm:max-w-[220px]">{user.name}</span>
                        </Link>
                      ) : (
                        <span className="text-xs font-semibold text-foreground">Система</span>
                      )}
                      <span className="min-w-0 truncate text-xs text-muted-foreground">{event.action}</span>
                    </div>
                    <Link href={event.targetType === "question" ? `/questions/${event.targetId}` : `/epics/${event.targetId}`}>
                      <span className="text-xs text-primary hover:underline cursor-pointer line-clamp-1 block mt-0.5">{event.targetTitle}</span>
                    </Link>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                      <Icon size={10} />
                      {typeLabel[event.type]}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">{formatTime(event.date)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {rows.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {activity.isLoading ? "Загружаем активность..." : "Нет активности для выбранного фильтра"}
        </div>
      )}

      <ListPagination page={page} pageSize={pageSize} total={total} isLoading={activity.isFetching} onPageChange={setPage} />
    </div>
  );
}
