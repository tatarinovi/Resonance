import { forwardRef } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { MessageSquare, Paperclip } from "lucide-react";

import type { KanbanTask } from "@/lib/kanban-ds/types";
import { PRIORITY_CLASS, TYPE_CLASS, getAvatarInfo } from "@/components/kanban-board/avatars";
import { Avatar } from "@/components/kanban-board/kanban-ui";
import { cn } from "@/lib/utils";

export type TaskCardProps = {
  task: KanbanTask;
  onClick: () => void;
  isDragging?: boolean;
  dndListeners?: DraggableSyntheticListeners;
  dndAttributes?: DraggableAttributes;
};

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, onClick, isDragging, dndListeners, dndAttributes },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("kanban-card", isDragging && "kanban-card--dragging", dndListeners && "kanban-card--draggable")}
      onClick={onClick}
      data-testid={`card-task-${task.id}`}
      {...dndListeners}
      {...dndAttributes}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#444d56", fontFamily: "monospace" }} data-testid={`text-task-id-${task.id}`}>
          #{task.id}
        </span>
        <span className={`badge ${PRIORITY_CLASS[task.priority] ?? "badge-priority-medium"}`} data-testid={`badge-priority-${task.id}`}>
          {task.priority}
        </span>
      </div>
      <p
        style={{
          fontSize: 13,
          color: "#E6EEF4",
          lineHeight: 1.45,
          marginBottom: 8,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        data-testid={`text-task-title-${task.id}`}
      >
        {task.title}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {task.epicId != null && task.epicId > 0 ? (
          <span
            className="badge-epic"
            style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={task.epicFull}
            data-testid={`badge-epic-${task.id}`}
          >
            <span style={{ fontFamily: "monospace", color: "#6e7681", marginRight: 4 }}>#{task.epicId}</span>
            <span>{task.epic}</span>
          </span>
        ) : null}
        {task.types.map((t) => (
          <span key={t} className={`badge ${TYPE_CLASS[t] || "badge-type-task"}`} data-testid={`badge-type-${t}`}>
            {t}
          </span>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 8,
          borderTop: "1px solid #2F363C",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#444d56" }}>
          {task.commentCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }} data-testid={`text-comments-${task.id}`}>
              <MessageSquare size={12} /> {task.commentCount}
            </span>
          )}
          {task.attachmentCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }} data-testid={`text-attachments-${task.id}`}>
              <Paperclip size={12} /> {task.attachmentCount}
            </span>
          )}
        </div>
        <div style={{ display: "flex" }}>
          {task.assignees.map((name, i) => {
            const a = getAvatarInfo(name);
            return (
              <div key={name + i} style={{ marginLeft: i > 0 ? -6 : 0, borderRadius: "50%", border: "2px solid #0D1117" }}>
                <Avatar initials={a.initials} color={a.color} size={20} title={name} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
