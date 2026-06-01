import { useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef, type CSSProperties } from "react";
import { ChevronRight, PanelRight } from "lucide-react";

import { formatKanbanDeadlineListCell, normalizeKanbanPersonLabel } from "@/lib/kanban-ds/mappers";
import type { KanbanColumn, KanbanTask } from "@/lib/kanban-ds/types";
import { PRIORITY_CLASS, TYPE_CLASS } from "@/components/kanban-board/avatars";

function columnStatusBadgeStyle(hex: string): CSSProperties {
  const c = hex.trim() || "#8b949e";
  return {
    background: `${c}1f`,
    color: c,
    border: `1px solid ${c}55`,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

function deadlineToneClass(code: number | null): string {
  if (code === 2) return "kanban-list-deadline kanban-list-deadline--over";
  if (code === 1) return "kanban-list-deadline kanban-list-deadline--near";
  if (code === 0) return "kanban-list-deadline kanban-list-deadline--ok";
  return "kanban-list-deadline kanban-list-deadline--neutral";
}

/** Стабильный «слот» цвета для направления (компонента) по подписи. */
function componentDirectionClass(label: string): string {
  const s = label.trim();
  if (!s || s === "—") return "badge badge-direction badge-direction--empty";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  const v = Math.abs(h) % 4;
  return `badge badge-direction badge-direction--v${v}`;
}

function hasRealEpic(t: KanbanTask): boolean {
  if (t.epicId != null && t.epicId > 0) return true;
  const x = t.epicFull.trim();
  return Boolean(x) && x !== "—" && x !== "-";
}

function epicGroupKey(t: KanbanTask): string {
  if (t.epicId != null && t.epicId > 0) return `id:${t.epicId}`;
  return `n:${normalizeKanbanPersonLabel(t.epicFull)}`;
}

function responsibleLabel(t: KanbanTask): string {
  const first = t.assignees[0];
  return first?.trim() || "—";
}

/** Согласовано с подсчётом в `analytics._build_snapshot` (stage id из Kanban). */
const STAGE_IDS_IN_PROGRESS = new Set([2, 4, 5, 6]);
const STAGE_IDS_DONE = new Set([3, 7, 8]);

function epicTaskStats(groupTasks: KanbanTask[]) {
  let inProgress = 0;
  let completed = 0;
  for (const t of groupTasks) {
    const id = t.columnId;
    if (STAGE_IDS_DONE.has(id)) completed += 1;
    else if (STAGE_IDS_IN_PROGRESS.has(id)) inProgress += 1;
  }
  return { total: groupTasks.length, inProgress, completed };
}

const LIST_HEAD = (
  <div className="kanban-list-table-head" role="row">
    <span className="kanban-list-head-cell">Id</span>
    <span className="kanban-list-head-cell">Заголовок</span>
    <span className="kanban-list-head-cell">Тип</span>
    <span className="kanban-list-head-cell">Приоритет</span>
    <span className="kanban-list-head-cell">Направление</span>
    <span className="kanban-list-head-cell">Статус</span>
    <span className="kanban-list-head-cell">Ответственный</span>
    <span className="kanban-list-head-cell">Дедлайн</span>
  </div>
);

export type KanbanListViewHandle = {
  collapseAll: () => void;
  expandAll: () => void;
};

export const KanbanListView = forwardRef<
  KanbanListViewHandle,
  {
    tasks: KanbanTask[];
    columns: KanbanColumn[];
    onRowClick: (task: KanbanTask) => void;
    /** Открыть карточку эпика Kanban в боковой панели (split); только при известном numeric epic id. */
    onEpicPanelOpen?: (epicKanbanId: number, epicTitle: string) => void;
    /** Для кнопок «Свернуть/Развернуть все» в тулбаре доски */
    onEpicGroupsMeta?: (meta: { epicGroupCount: number }) => void;
  }
>(function KanbanListView({ tasks, columns, onRowClick, onEpicPanelOpen, onEpicGroupsMeta }, ref) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const columnById = useMemo(() => {
    const m = new Map<number, KanbanColumn>();
    for (const c of columns) m.set(c.id, c);
    return m;
  }, [columns]);

  const { epicGroups, noEpicTasks } = useMemo(() => {
    const withEp: KanbanTask[] = [];
    const without: KanbanTask[] = [];
    for (const t of tasks) {
      if (hasRealEpic(t)) withEp.push(t);
      else without.push(t);
    }
    const m = new Map<string, { title: string; tasks: KanbanTask[] }>();
    for (const t of withEp) {
      const k = epicGroupKey(t);
      const title = t.epicFull.trim() || "—";
      const g = m.get(k);
      if (!g) m.set(k, { title, tasks: [t] });
      else {
        g.tasks.push(t);
        if (title.length > g.title.length) g.title = title;
      }
    }
    const epicGroups = [...m.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title, "ru"));
    const noEpicTasks = [...without].sort((a, b) => a.title.localeCompare(b.title, "ru"));
    return { epicGroups, noEpicTasks };
  }, [tasks]);

  const epicGroupKeys = useMemo(() => epicGroups.map(([k]) => k), [epicGroups]);

  useEffect(() => {
    onEpicGroupsMeta?.({ epicGroupCount: epicGroups.length });
  }, [epicGroups.length, onEpicGroupsMeta]);

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(epicGroupKeys));
  }, [epicGroupKeys]);

  const expandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      collapseAll,
      expandAll,
    }),
    [collapseAll, expandAll],
  );

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderTaskRow = (t: KanbanTask) => {
    const col = columnById.get(t.columnId);
    const statusLabel = col?.title ?? t.status;
    const statusColor = col?.color ?? "#8b949e";
    const deadlineLine = formatKanbanDeadlineListCell(t.deadline, t.deadlineStatus);
    const deadlineOver = Number(t.deadlineStatus) === 2;
    return (
      <button
        key={t.id}
        type="button"
        className="kanban-list-row"
        onClick={() => onRowClick(t)}
        data-testid={`kanban-list-task-${t.id}`}
      >
        <span className="kanban-list-cell kanban-list-cell--id" title={String(t.id)}>
          #{t.id}
        </span>
        <span className="kanban-list-cell kanban-list-cell--title" title={t.title}>
          {t.title}
        </span>
        <span className="kanban-list-cell kanban-list-cell--tags">
          {t.types.length ? (
            t.types.map((ty) => (
              <span key={ty} className={`badge ${TYPE_CLASS[ty] || "badge-type-task"}`}>
                {ty}
              </span>
            ))
          ) : (
            <span className="kanban-list-cell--muted">—</span>
          )}
        </span>
        <span className="kanban-list-cell kanban-list-cell--tag">
          <span className={`badge ${PRIORITY_CLASS[t.priority] ?? "badge-priority-medium"}`}>{t.priority}</span>
        </span>
        <span className="kanban-list-cell kanban-list-cell--tag" title={t.componentLabel}>
          {t.componentLabel !== "—" ? <span className={componentDirectionClass(t.componentLabel)}>{t.componentLabel}</span> : <span className="kanban-list-cell--muted">—</span>}
        </span>
        <span className="kanban-list-cell kanban-list-cell--tag">
          <span className="badge" style={columnStatusBadgeStyle(statusColor)} title={statusLabel}>
            {statusLabel}
          </span>
        </span>
        <span className="kanban-list-cell kanban-list-cell--muted" title={responsibleLabel(t)}>
          {responsibleLabel(t)}
        </span>
        <span className={`kanban-list-cell ${deadlineToneClass(t.deadlineStatus)}`} title={deadlineLine}>
          {deadlineOver ? "🔥 " : null}
          {deadlineLine}
        </span>
      </button>
    );
  };

  return (
    <div className="kanban-list-root kanban-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-[#0a0d14] p-3">
      {epicGroups.map(([key, { title, tasks: groupTasks }]) => {
        const open = !collapsed.has(key);
        const sorted = [...groupTasks].sort((a, b) => a.title.localeCompare(b.title, "ru"));
        const stats = epicTaskStats(sorted);
        const epicIdFromKey = key.startsWith("id:") ? Number(key.slice(3)) : NaN;
        const showEpicId = Number.isFinite(epicIdFromKey) && epicIdFromKey > 0;
        return (
          <section key={key} className="kanban-list-epic mb-2 rounded-md border border-[#2F363C] bg-[#0D1117]">
            <div className="kanban-list-epic-head-wrap">
              <button type="button" className="kanban-list-epic-head-main" onClick={() => toggle(key)} data-testid={`kanban-list-epic-toggle-${key}`}>
                <div className="kanban-list-epic-head-row">
                  <ChevronRight
                    size={16}
                    className="kanban-list-epic-chevron shrink-0 text-[#8b949e]"
                    style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
                  />
                  <span className="kanban-list-epic-title min-w-0 truncate">
                    {showEpicId ? (
                      <>
                        <span className="font-mono text-[#6e7681]" data-testid={`kanban-list-epic-id-${epicIdFromKey}`}>
                          Эпик #{epicIdFromKey}
                        </span>
                        <span className="text-[#444d56]"> · </span>
                      </>
                    ) : null}
                    {title}
                  </span>
                </div>
                <div className="kanban-list-epic-sub">
                  всего: {stats.total}, в работе: {stats.inProgress}, завершено: {stats.completed}
                </div>
              </button>
              {showEpicId && onEpicPanelOpen ? (
                <button
                  type="button"
                  className="kanban-list-epic-open-btn"
                  title="Открыть карточку эпика"
                  aria-label="Открыть карточку эпика"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEpicPanelOpen(epicIdFromKey, title);
                  }}
                  data-testid={`kanban-list-epic-open-panel-${epicIdFromKey}`}
                >
                  <PanelRight size={18} />
                </button>
              ) : null}
            </div>
            {open && (
              <div className="kanban-list-epic-body kanban-list-epic-body-scroll">
                {LIST_HEAD}
                {sorted.map(renderTaskRow)}
              </div>
            )}
          </section>
        );
      })}

      <section className="kanban-list-epic rounded-md border border-[#2F363C] bg-[#0D1117]">
        <div className="kanban-list-epic-head kanban-list-epic-head-static">
          <span className="kanban-list-epic-title">Без эпика</span>
          <span className="kanban-list-epic-count">{noEpicTasks.length}</span>
        </div>
        <div className="kanban-list-epic-body kanban-list-epic-body-scroll">
          {noEpicTasks.length ? (
            <>
              {LIST_HEAD}
              {noEpicTasks.map(renderTaskRow)}
            </>
          ) : (
            <div className="kanban-list-empty">Нет задач</div>
          )}
        </div>
      </section>
    </div>
  );
});

KanbanListView.displayName = "KanbanListView";
