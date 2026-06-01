import { useCallback, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";

import { KanbanColumn } from "@/components/kanban-board/KanbanColumn";
import { TaskCard } from "@/components/kanban-board/TaskCard";
import { ApiError } from "@/lib/api";
import { useKanbanPatchTask } from "@/lib/kanban-ds/queries";
import type { KanbanColumn as KanbanColumnModel, KanbanTask } from "@/lib/kanban-ds/types";

/** Сначала зона под курсором (лучше для пустых колонок), иначе ближайшие углы. */
const kanbanBoardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};

export type KanbanBoardDndShellProps = {
  columns: KanbanColumnModel[];
  filteredTasks: KanbanTask[];
  onCardClick: (t: KanbanTask) => void;
  projectSlug: string;
  allowQuickAdd: boolean;
  createDefaults: { taskTypeId: number; priorityId: number; componentId: number | null } | null;
  /** Чуть больше порог на тач, чтобы реже конфликтовать со скроллом колонки */
  pointerActivationDistance?: number;
};

export function KanbanBoardDndShell({
  columns,
  filteredTasks,
  onCardClick,
  projectSlug,
  allowQuickAdd,
  createDefaults,
  pointerActivationDistance = 8,
}: KanbanBoardDndShellProps) {
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);
  const patchTask = useKanbanPatchTask();

  const movingTaskId =
    patchTask.isPending && patchTask.variables != null ? patchTask.variables.taskId : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: pointerActivationDistance },
    }),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current;
    if (data?.type === "task" && data.task) setActiveTask(data.task as KanbanTask);
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = e;
      if (!over) return;
      const activeData = active.data.current;
      if (!activeData || activeData.type !== "task") return;
      const task = activeData.task as KanbanTask;
      const sourceColumnId = Number(activeData.columnId);
      const overData = over.data.current as
        | { type?: string; columnId?: number; task?: KanbanTask }
        | undefined;
      let targetColumnId: number | null = null;
      if (overData?.type === "column" && typeof overData.columnId === "number") {
        targetColumnId = overData.columnId;
      } else if (overData?.type === "task" && overData.task) {
        targetColumnId = overData.task.columnId;
      } else {
        const overId = String(over.id);
        if (overId.startsWith("column-")) {
          targetColumnId = Number(overId.slice("column-".length));
        } else if (overId.startsWith("task-")) {
          const overTaskId = Number(overId.slice("task-".length));
          const overTask = filteredTasks.find((t) => t.id === overTaskId);
          if (overTask) targetColumnId = overTask.columnId;
        }
      }
      if (targetColumnId == null || Number.isNaN(targetColumnId)) return;
      if (targetColumnId === sourceColumnId) return;

      patchTask.mutate(
        { taskId: task.id, body: { stage_id: targetColumnId } },
        {
          onError: (err) => {
            toast.error(err instanceof ApiError ? err.message : "Не удалось переместить задачу");
          },
        },
      );
    },
    [filteredTasks, patchTask],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanBoardCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {columns.map((col) => (
        <KanbanColumn
          key={col.id}
          col={col}
          tasks={filteredTasks.filter((t) => t.columnId === col.id)}
          onCardClick={onCardClick}
          projectSlug={projectSlug}
          allowQuickAdd={allowQuickAdd}
          createDefaults={createDefaults}
          boardDndEnabled
          movingTaskId={movingTaskId}
        />
      ))}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="kanban-drag-overlay-wrap">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
