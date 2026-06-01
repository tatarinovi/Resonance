import { useState } from "react";
import { Inbox, CheckCheck, HelpCircle, Layers } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ProjectBadge } from "@/components/shared/ProjectBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useInbox } from "@/hooks/useInbox";
import { Link } from "@/lib/router";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "только что";
  if (h < 24) return `${h} ч. назад`;
  return `${Math.floor(h / 24)} д. назад`;
}

export default function InboxPage() {
  const [tab, setTab] = useState<"new" | "all">("new");
  const { rows, readIds, unreadCount, markItemRead, markAllRead } = useInbox();

  const displayed = tab === "new" ? rows.filter((i) => !readIds.has(i.id)) : rows;

  const markAll = () => {
    markAllRead();
    toast.success("Все отмечены как прочитанные");
  };

  return (
    <div className="mx-auto box-border w-full min-w-0 max-w-4xl p-4 md:p-6">
      <div className="flex w-full min-w-0 items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold">Входящие</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Назначено вам</p>
        </div>
        <button
          onClick={markAll}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          data-testid="button-mark-all-read"
        >
          <CheckCheck size={13} />
          <span className="hidden sm:inline">Прочитать все</span>
        </button>
      </div>

      <div className="flex gap-0.5 mb-4 bg-muted p-0.5 rounded-lg w-fit">
        {(["new", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${t}`}
          >
            {t === "new" ? `Новые (${unreadCount})` : "Все"}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <EmptyState icon={Inbox} title="Входящих нет" description="Все задачи обработаны" />
        </div>
      ) : (
        <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          {displayed.map((item, idx) => {
            const isUnread = !readIds.has(item.id);
            return (
              <Link
                key={item.id}
                href={item.type === "q" ? `/questions/${item.id}` : `/epics/${item.id}`}
                onClick={() => markItemRead(item.id)}
                className="block text-inherit no-underline"
              >
                <div
                  className={`flex items-start gap-3 px-3 md:px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors ${idx !== 0 ? "border-t border-border/50" : ""} ${isUnread ? "bg-primary/[0.03]" : ""}`}
                  data-testid={`inbox-item-${item.id}`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${isUnread ? "bg-primary" : "bg-transparent"}`}
                  />
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    {item.type === "q" ? (
                      <HelpCircle size={14} className="text-muted-foreground" />
                    ) : (
                      <Layers size={14} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] text-muted-foreground font-mono">{item.id}</span>
                      <p className="text-sm text-foreground line-clamp-1">{item.title}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ProjectBadge projectId={item.projectId} />
                      <UserAvatar userId={item.authorId} size="sm" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <StatusBadge status={item.status as never} size="sm" />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo(item.date)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
