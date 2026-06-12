import { Bell, Check, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useNotifications } from "@/contexts/NotificationContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveNotificationTargetUrl } from "@/lib/notificationNavigation";
import { useLocation } from "@/lib/router";

const typeLabels: Record<string, string> = {
  "статус изменён": "Статус изменён",
  "новый вопрос": "Новый вопрос",
  "передан эксперту": "Передан эксперту",
  "получен ответ": "Получен ответ",
  "на уточнение": "На уточнение",
  "упоминание": "Упоминание",
  "блокер добавлен": "Блокер",
  "вопрос: сообщение": "Вопрос: сообщение",
  "вопрос: статус": "Вопрос: статус",
  "Вопрос долго без движения": "Вопрос долго без движения",
  "напоминание": "Напоминание",
  "Kanban: новая задача": "Kanban",
};

const typeColors: Record<string, string> = {
  "статус изменён": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "новый вопрос": "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  "передан эксперту": "bg-purple-500/15 text-purple-400",
  "получен ответ": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "на уточнение": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "упоминание": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "блокер добавлен": "bg-red-500/15 text-red-700 dark:text-red-400",
  "вопрос: сообщение": "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  "вопрос: статус": "bg-indigo-500/15 text-indigo-400",
  "Вопрос долго без движения": "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  "напоминание": "bg-rose-500/15 text-rose-300",
  "Kanban: новая задача": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} д. назад`;
}

export function NotificationBell() {
  const { notifications, unreadCount, totalCount, hasMore, loadMore, markAsRead, markAllAsRead } = useNotifications();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          data-testid="button-notifications"
        >
          <Bell className="w-4.5 h-4.5" size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-[9px] text-white font-bold flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 border-border shadow-lg" align="end" sideOffset={6}>
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-sm font-semibold">Уведомления</span>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-[11px] text-primary hover:underline flex items-center gap-1"
              data-testid="button-mark-all-read"
            >
              <CheckCheck size={12} /> Прочитать все
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Нет уведомлений</div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className={`flex gap-2.5 px-3 py-2.5 border-b border-border/50 cursor-pointer hover:bg-accent/50 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}
                onClick={() => {
                  markAsRead(n.id);
                  const raw = (n.targetUrl ?? "").trim();
                  if (raw) {
                    const resolved = resolveNotificationTargetUrl(raw);
                    if (resolved?.kind === "in_app") {
                      setOpen(false);
                      setLocation(resolved.path);
                      return;
                    }
                    if (resolved?.kind === "external") {
                      setOpen(false);
                      window.open(resolved.url, "_blank", "noopener,noreferrer");
                      return;
                    }
                  }
                  if (n.targetType === "kanban") {
                    return;
                  }
                  setOpen(false);
                  setLocation(n.targetType === "question" ? `/questions/${n.targetId}` : `/epics/${n.targetId}`);
                }}
                data-testid={`notification-${n.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium max-w-[11rem] line-clamp-2 leading-tight ${typeColors[n.type] ?? "bg-muted text-muted-foreground"}`}>
                      {typeLabels[n.type] ?? n.type}
                    </span>
                    {(n.severity === "high" || n.severity === "critical") && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-destructive/20 text-destructive">
                        {n.severity === "critical" ? "critical" : "high"}
                      </span>
                    )}
                    {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  <p className="text-xs font-medium text-foreground line-clamp-1">{n.title}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); markAsRead(n.id); }}
                  className="text-muted-foreground hover:text-foreground mt-1 flex-shrink-0"
                >
                  <Check size={12} />
                </button>
              </div>
            ))
          )}
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            className="w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent/40"
          >
            Показать ещё ({notifications.length} из {totalCount})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
