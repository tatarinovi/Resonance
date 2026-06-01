import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";

import type { KanbanColumn as KanbanColumnT, KanbanTask } from "@/lib/kanban-ds/types";
import { useKanbanCreateTask } from "@/lib/kanban-ds/queries";
import { TaskCard } from "@/components/kanban-board/TaskCard";
import { cn } from "@/lib/utils";

function KanbanDraggableTaskCard({
  task,
  columnId,
  boardDndEnabled,
  movingTaskId,
  onCardClick,
}: {
  task: KanbanTask;
  columnId: number;
  boardDndEnabled: boolean;
  movingTaskId: number | null;
  onCardClick: (t: KanbanTask) => void;
}) {
  const dragDisabled = !boardDndEnabled || movingTaskId === task.id;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    disabled: dragDisabled,
    data: { type: "task", task, columnId },
  });

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      onClick={() => onCardClick(task)}
      isDragging={isDragging}
      dndAttributes={attributes}
      dndListeners={listeners}
    />
  );
}

export function KanbanColumn({
  col,
  tasks,
  onCardClick,
  projectSlug,
  allowQuickAdd,
  createDefaults,
  boardDndEnabled = false,
  movingTaskId = null,
}: {
  col: KanbanColumnT;
  tasks: KanbanTask[];
  onCardClick: (t: KanbanTask) => void;
  projectSlug: string;
  allowQuickAdd: boolean;
  createDefaults: { taskTypeId: number; priorityId: number; componentId: number | null } | null;
  boardDndEnabled?: boolean;
  movingTaskId?: number | null;
}) {
  const [showQuick, setShowQuick] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const createTask = useKanbanCreateTask(projectSlug);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `column-${col.id}`,
    data: { type: "column", columnId: col.id },
    disabled: !boardDndEnabled,
  });

  useEffect(() => {
    if (showQuick) inputRef.current?.focus();
  }, [showQuick]);

  const submitQuick = () => {
    const title = quickTitle.trim();
    if (!title || !createDefaults) {
      setShowQuick(false);
      return;
    }
    const body: Record<string, unknown> = {
      name: title,
      description: "",
      stage_id: col.id,
      task_type_id: createDefaults.taskTypeId,
      priority_id: createDefaults.priorityId,
    };
    if (createDefaults.componentId) {
      body.component_id = createDefaults.componentId;
    }
    createTask.mutate(body, {
      onSuccess: () => {
        setQuickTitle("");
        setShowQuick(false);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submitQuick();
    if (e.key === "Escape") {
      setShowQuick(false);
      setQuickTitle("");
    }
  };

  return (
    <div
      ref={setDropRef}
      className={cn("kanban-col", boardDndEnabled && isOver && "kanban-col--drop-target")}
      data-testid={`column-${col.id}`}
    >
      <div className="col-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: col.color,
              flexShrink: 0,
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 500, color: "#E6EEF4", fontSize: 13 }} data-testid={`text-column-title-${col.id}`}>
            {col.title}
          </span>
          <span
            style={{
              background: "#21262d",
              color: "#8b949e",
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 10,
              fontWeight: 600,
            }}
            data-testid={`text-column-count-${col.id}`}
          >
            {tasks.length}
          </span>
        </div>
        {allowQuickAdd && createDefaults && (
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "#444d56",
              cursor: "pointer",
              padding: 4,
              display: "flex",
            }}
            onClick={() => setShowQuick(true)}
            data-testid={`button-quick-add-${col.id}`}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 6 }} className="kanban-scroll">
        {tasks.map((task) =>
          boardDndEnabled ? (
            <KanbanDraggableTaskCard
              key={task.id}
              task={task}
              columnId={col.id}
              boardDndEnabled={boardDndEnabled}
              movingTaskId={movingTaskId}
              onCardClick={onCardClick}
            />
          ) : (
            <TaskCard key={task.id} task={task} onClick={() => onCardClick(task)} />
          ),
        )}
        {tasks.length === 0 && !showQuick && (
          <div className="col-empty" data-testid={`empty-column-${col.id}`}>
            <span style={{ fontSize: 13 }}>Нет задач</span>
          </div>
        )}
        {showQuick && (
          <div style={{ margin: "6px 6px 0", background: "#0D1117", border: "1px solid #8b5cf6", borderRadius: 4 }}>
            <input
              ref={inputRef}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#E6EEF4",
                padding: "8px 10px",
                fontSize: 13,
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
              placeholder="Название задачи"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!quickTitle.trim()) setShowQuick(false);
              }}
              data-testid={`input-quick-add-${col.id}`}
              disabled={createTask.isPending}
            />
          </div>
        )}
      </div>

      {allowQuickAdd && createDefaults && (
        <div style={{ padding: "0 6px 6px" }}>
          <button
            type="button"
            className="col-add-btn"
            onClick={() => setShowQuick(true)}
            data-testid={`button-add-bottom-${col.id}`}
          >
            <Plus size={12} /> Добавить задачу
          </button>
        </div>
      )}
    </div>
  );
}
