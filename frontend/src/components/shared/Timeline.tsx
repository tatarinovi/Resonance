import { formatDateTime } from "@/lib/formatDateTime";
import { UserAvatar } from "./UserAvatar";

interface TimelineEvent {
  id: string;
  userId: string;
  action: string;
  date: string;
}

interface TimelineProps {
  events: TimelineEvent[];
}

export function Timeline({ events }: TimelineProps) {
  return (
    <div className="relative pl-4">
      {events.map((event, i) => (
        <div key={event.id} className="relative flex gap-3 pb-4">
          {i < events.length - 1 && (
            <div className="absolute left-0 top-3 bottom-0 w-px bg-border ml-[3px]" />
          )}
          <div className="mt-1 w-1.5 h-1.5 rounded-full bg-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <UserAvatar userId={event.userId} size="sm" />
              <span className="text-xs text-foreground/90">{event.action}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(event.date)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
