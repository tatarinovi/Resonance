import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart2,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  Clock,
  History,
  LayoutDashboard,
  ListTodo,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  X,
} from "lucide-react";

import { KanbanEpicAnalyticsPanel } from "@/components/kanban-analytics/KanbanEpicAnalyticsPanel";
import { useKanbanAnalyticsBootstrap, useKanbanProjectMemberRoles } from "@/lib/queries";
import {
  flattenChecklist,
  kanbanTaskRowIsEpicType,
  kanbanWorklogLaneFromMemberRole,
  mapDetailToBoardTask,
  mapDsComments,
  mapDsEpicByTasksFromDetail,
  mapDsWorkLogs,
  parseKanbanTaskHistory,
  type KanbanPriorityRef,
  resolveKanbanWorkLogs,
  type KanbanTaskHistoryEntry,
  type KanbanTaskTypeRef,
} from "@/lib/kanban-ds/mappers";
import {
  useKanbanPatchChecklistPoint,
  useKanbanPatchTask,
  useKanbanPostComment,
  useKanbanPostWork,
  useKanbanTaskComments,
  useKanbanTaskDetail,
  useKanbanTaskWork,
  useKanbanMultiTaskWork,
  useKanbanComponents,
} from "@/lib/kanban-ds/queries";
import type { KanbanColumn, KanbanEpicWorklogRow, KanbanTask, KanbanWorklogLane } from "@/lib/kanban-ds/types";
import type { KanbanMemberProjectRole } from "@/lib/queries";
import { mapKanbanComponentsToIdNameMap } from "@/lib/kanban-ds/refs";
import { KanbanCommentHtml } from "@/components/kanban-board/KanbanCommentHtml";
import { QaTaskBulkCreateDialog } from "@/components/kanban-board/QaTaskBulkCreateDialog";
import { Avatar, RteToolbar } from "@/components/kanban-board/kanban-ui";
import { getAvatarInfo, PRIORITY_CLASS, TYPE_CLASS, WORKFLOW_STATUS_COLOR } from "@/components/kanban-board/avatars";
import { detailPriorityPill, resolveDetailStageThemeVars } from "@/components/kanban-board/task-detail-ops-theme";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function personName(u: Record<string, unknown> | null): string {
  if (!u) return "";
  const name = String(u.name ?? "").trim();
  const surname = String(u.surname ?? "").trim();
  const full = [name, surname].filter(Boolean).join(" ");
  if (full) return full;
  return String(u.username ?? u.email ?? "").trim();
}

function userLabelById(
  id: number | null,
  detailUsers: unknown,
  projectMemberIdToName?: Map<number, string>,
): string {
  if (id == null || !(id > 0)) return "Система / скрипт";
  const fromMap = projectMemberIdToName?.get(id);
  if (fromMap) return fromMap;
  if (Array.isArray(detailUsers)) {
    for (const u of detailUsers) {
      const ur = asRecord(u);
      if (ur && Number(ur.id) === id) {
        const n = personName(ur);
        if (n) return n;
      }
    }
  }
  return `Пользователь #${id}`;
}

function formatHistoryValue(s: string, max = 280): string {
  const t = s.trim();
  if (!t) return "—";
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/** Шаг списания времени (минуты), как в форме Kanban. */
const LOG_WORK_STEP_MIN = 15;
const LOG_WORK_MAX_MIN = 48 * 60;

/** Отображение и ручной ввод длительности: `0ч 00мин`. */
function formatSpendMinutesRuMask(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}ч ${String(m).padStart(2, "0")}мин`;
}

function parseSpendMinutesRuMask(s: string): number | null {
  const raw = s.trim().replace(/\s+/g, " ");
  const m = raw.match(/^(\d+)\s*ч\s*(\d{1,2})\s*мин$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || mm < 0 || mm >= 60) return null;
  return h * 60 + mm;
}

function snapSpendMinutesToStep(raw: number, step: number, min: number, max: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return min;
  const snapped = Math.round(raw / step) * step;
  const v = snapped < min ? min : snapped;
  return Math.min(max, v);
}

/** Дата списания (`begin`): выбранный календарный день + текущее локальное время (как при ручной отправке в веб-клиенте). */
function beginIsoForWorkLog(dateYmd: string): string {
  const now = new Date();
  if (!dateYmd.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd.trim())) {
    return now.toISOString();
  }
  const [ys, ms, ds] = dateYmd.trim().split("-");
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return now.toISOString();
  return new Date(y, mo - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).toISOString();
}

function responsibleLabel(t: KanbanTask): string {
  const first = t.assignees[0];
  return first?.trim() || "—";
}

type DetailMainTab = "overview" | "comments" | "activity" | "time" | "charts" | "tasks" | "worklog";

const EPIC_WORKLOG_LANE_CHIPS: { lane: KanbanWorklogLane; label: string }[] = [
  { lane: "qa", label: "QA" },
  { lane: "front", label: "Front" },
  { lane: "back", label: "Back" },
  { lane: "manager", label: "Manager" },
  { lane: "other", label: "Прочее" },
];

export function TaskDetailContent({
  projectSlug,
  summary,
  columns,
  boardTasks = [],
  onOpenTask,
  projectMemberIdToName,
  priorityRefs,
  taskTypeRefs,
  onClose,
}: {
  projectSlug: string;
  summary: KanbanTask;
  columns: KanbanColumn[];
  /** Полный список задач доски (fallback, если в деталке эпика нет `epic_by`). */
  boardTasks?: KanbanTask[];
  /** Открыть карточку задачи в той же боковой панели. */
  onOpenTask?: (task: KanbanTask) => void;
  /** Участники проекта Kanban (id → имя) для фильтров и оценок. */
  projectMemberIdToName?: Map<number, string>;
  /** Справочник приоритетов (id → имя), как на доске — для маппинга `epic_by` из GET /task/{id}. */
  priorityRefs?: KanbanPriorityRef[];
  /** Справочник типов задач (id → имя), см. GET /task_type в helps/v1.json. */
  taskTypeRefs?: KanbanTaskTypeRef[];
  onClose: () => void;
}) {
  const bootstrap = useKanbanAnalyticsBootstrap(true);
  const detail = useKanbanTaskDetail(summary.id, true);
  const drec = asRecord(detail.data);
  /** DS v1: комментарии в TaskSingle — поле `comments`; отдельный GET /task/{id}/comment строже по правам. */
  const fetchCommentsSeparate = detail.isSuccess && !Array.isArray(drec?.comments);
  const commentsQ = useKanbanTaskComments(summary.id, fetchCommentsSeparate);
  const components = useKanbanComponents(true);
  const componentIdToName = useMemo(() => mapKanbanComponentsToIdNameMap(components.data ?? []), [components.data]);

  const patchTask = useKanbanPatchTask();
  const postComment = useKanbanPostComment(summary.id);
  const postWork = useKanbanPostWork(summary.id);
  const patchChecklist = useKanbanPatchChecklistPoint(summary.id);

  const [detailTab, setDetailTab] = useState<DetailMainTab>("overview");
  const [commentText, setCommentText] = useState("");
  const [logWorkOpen, setLogWorkOpen] = useState(false);
  const [qaTaskDialogOpen, setQaTaskDialogOpen] = useState(false);
  const [newTimeDesc, setNewTimeDesc] = useState("");
  const [spendMinutes, setSpendMinutes] = useState(15);
  const [spendMaskDraft, setSpendMaskDraft] = useState(() => formatSpendMinutesRuMask(15));
  const [newTimeDate, setNewTimeDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (logWorkOpen) {
      setSpendMinutes(LOG_WORK_STEP_MIN);
      setSpendMaskDraft(formatSpendMinutesRuMask(LOG_WORK_STEP_MIN));
    }
  }, [logWorkOpen]);

  const mergedTask: KanbanTask = useMemo(() => {
    if (!detail.data) return summary;
    return mapDetailToBoardTask(detail.data, summary, columns, undefined, projectMemberIdToName, taskTypeRefs, componentIdToName);
  }, [detail.data, summary, columns, projectMemberIdToName, taskTypeRefs, componentIdToName]);

  const isEpicRow = kanbanTaskRowIsEpicType(mergedTask);
  const workQ = useKanbanTaskWork(summary.id, !isEpicRow);

  useEffect(() => {
    if (isEpicRow && detailTab === "time") setDetailTab("overview");
    else if (!isEpicRow && (detailTab === "charts" || detailTab === "tasks" || detailTab === "worklog")) setDetailTab("overview");
  }, [isEpicRow, detailTab]);

  const epicChildTasks = useMemo(() => {
    if (!isEpicRow) return [];
    const epicId = summary.id;
    const fromDetail = mapDsEpicByTasksFromDetail(
      detail.data,
      columns,
      priorityRefs,
      projectMemberIdToName,
      taskTypeRefs,
      componentIdToName,
    );
    const linked =
      fromDetail.length > 0
        ? fromDetail
        : boardTasks.filter((t) => t.id !== epicId && t.epicId != null && t.epicId === epicId);
    const filtered = linked.filter((t) => t.id !== epicId);
    const colOrder = new Map(columns.map((c, i) => [c.id, i]));
    return [...filtered].sort((a, b) => {
      const ia = colOrder.get(a.columnId) ?? 999;
      const ib = colOrder.get(b.columnId) ?? 999;
      if (ia !== ib) return ia - ib;
      const titleCmp = a.title.localeCompare(b.title, "ru");
      if (titleCmp !== 0) return titleCmp;
      return a.id - b.id;
    });
  }, [
    isEpicRow,
    summary.id,
    detail.data,
    boardTasks,
    columns,
    priorityRefs,
    projectMemberIdToName,
    taskTypeRefs,
    componentIdToName,
  ]);

  const epicWorkTaskIds = useMemo(() => {
    if (!isEpicRow) return [];
    return [...new Set([summary.id, ...epicChildTasks.map((t) => t.id)])];
  }, [isEpicRow, summary.id, epicChildTasks]);

  const epicWorkQueries = useKanbanMultiTaskWork(epicWorkTaskIds, isEpicRow);
  const memberRolesQ = useKanbanProjectMemberRoles(projectSlug || null, isEpicRow);

  const roleByKanbanUserId = useMemo(() => {
    const m = new Map<number, KanbanMemberProjectRole>();
    for (const row of memberRolesQ.data?.members ?? []) {
      if (row.kanban_user_id > 0) m.set(row.kanban_user_id, row.role);
    }
    return m;
  }, [memberRolesQ.data?.members]);

  const [worklogLaneFilter, setWorklogLaneFilter] = useState<KanbanWorklogLane[]>([]);

  const epicWorkFetchToken = epicWorkQueries.reduce((acc, q) => acc + (q.dataUpdatedAt ?? 0), 0);

  const epicWorklogRows: KanbanEpicWorklogRow[] = useMemo(() => {
    if (!isEpicRow) return [];
    const taskById = new Map<number, KanbanTask>();
    taskById.set(summary.id, mergedTask);
    for (const t of epicChildTasks) taskById.set(t.id, t);
    const out: KanbanEpicWorklogRow[] = [];
    for (const q of epicWorkQueries) {
      if (q.status !== "success" || !q.data) continue;
      const { taskId, rows } = q.data;
      const task = taskById.get(taskId);
      const title = task?.title?.trim() ? task.title.trim() : `Задача #${taskId}`;
      const mapped = mapDsWorkLogs(rows, undefined, projectMemberIdToName);
      for (const w of mapped) {
        const kid = w.kanbanUserId != null && w.kanbanUserId > 0 ? w.kanbanUserId : null;
        const role = kid != null ? roleByKanbanUserId.get(kid) : undefined;
        const lane = kanbanWorklogLaneFromMemberRole(role);
        out.push({ ...w, sourceTaskId: taskId, sourceTaskTitle: title, lane });
      }
    }
    out.sort((a, b) => {
      const da = Date.parse(a.loggedAt);
      const db = Date.parse(b.loggedAt);
      if (Number.isFinite(da) && Number.isFinite(db) && db !== da) return db - da;
      if (Number.isFinite(db) && !Number.isFinite(da)) return 1;
      if (Number.isFinite(da) && !Number.isFinite(db)) return -1;
      if (a.sourceTaskId !== b.sourceTaskId) return b.sourceTaskId - a.sourceTaskId;
      return b.id - a.id;
    });
    return out;
  }, [isEpicRow, summary.id, mergedTask, epicChildTasks, projectMemberIdToName, epicWorkFetchToken, roleByKanbanUserId]);

  const epicWorklogFiltered = useMemo(() => {
    if (worklogLaneFilter.length === 0) return epicWorklogRows;
    const allowed = new Set(worklogLaneFilter);
    return epicWorklogRows.filter((r) => allowed.has(r.lane));
  }, [epicWorklogRows, worklogLaneFilter]);

  const epicWorklogLoading =
    isEpicRow && epicWorkTaskIds.length > 0 && epicWorkQueries.some((q) => q.isPending || q.isLoading);

  const toggleWorklogLane = (lane: KanbanWorklogLane) => {
    setWorklogLaneFilter((prev) => (prev.includes(lane) ? prev.filter((x) => x !== lane) : [...prev, lane]));
  };

  const commentsFromDetail = drec?.comments;
  const comments = useMemo(() => {
    if (Array.isArray(commentsFromDetail)) return mapDsComments(commentsFromDetail);
    return mapDsComments(commentsQ.data ?? []);
  }, [commentsFromDetail, commentsQ.data]);

  const historyEntries: KanbanTaskHistoryEntry[] = useMemo(() => parseKanbanTaskHistory(detail.data), [detail.data]);

  const checklist = useMemo(() => (isEpicRow ? [] : flattenChecklist(detail.data)), [detail.data, isEpicRow]);
  const workLogs = useMemo(
    () => (isEpicRow ? [] : resolveKanbanWorkLogs(detail.data, workQ.data, projectMemberIdToName)),
    [detail.data, workQ.data, isEpicRow, projectMemberIdToName],
  );

  const columnForTask = useMemo(
    () => columns.find((c) => c.id === mergedTask.columnId),
    [columns, mergedTask.columnId],
  );
  const columnColor = columnForTask?.color ?? "var(--kanban-text-muted)";
  const stageTitleForTheme = columnForTask?.title?.trim() || mergedTask.status?.trim() || "—";
  const detailStageVars = useMemo(
    () => resolveDetailStageThemeVars(stageTitleForTheme, columnColor),
    [stageTitleForTheme, columnColor],
  );
  const priorityPill = useMemo(() => detailPriorityPill(mergedTask.priority), [mergedTask.priority]);

  const totalLoggedMinutes = useMemo(() => {
    const t = asRecord(detail.data);
    const v = Number(t?.total_logged_time);
    if (Number.isFinite(v) && v >= 0) return Math.round(v);
    return mergedTask.trackedMinutes;
  }, [detail.data, mergedTask.trackedMinutes]);

  const estimateWorkerMinutes = useMemo(() => {
    const v = Number(drec?.estimate_worker);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  }, [drec]);

  const spentH = Math.floor(totalLoggedMinutes / 60);
  const spentM = totalLoggedMinutes % 60;
  const managerH = Math.floor(estimateWorkerMinutes / 60);
  const managerM = estimateWorkerMinutes % 60;

  const spentVsManagerPct =
    estimateWorkerMinutes > 0
      ? Math.min(100, (totalLoggedMinutes / estimateWorkerMinutes) * 100)
      : totalLoggedMinutes > 0
        ? 100
        : 0;

  const kanbanBase = bootstrap.data?.kanban_web_base_url?.replace(/\/$/, "") ?? null;
  const externalTaskUrl = kanbanBase ? `${kanbanBase}/projects/${encodeURIComponent(projectSlug)}/${summary.id}` : null;

  const detailUsers = drec?.users;

  const sendComment = () => {
    if (!commentText.trim()) return;
    postComment.mutate({ content: commentText.trim() });
    setCommentText("");
  };

  const toggleCheck = (pointId: number, done: boolean) => {
    patchChecklist.mutate({ pointId, body: { is_done: !done } });
  };

  const commitSpendMaskDraft = () => {
    const parsed = parseSpendMinutesRuMask(spendMaskDraft);
    if (parsed == null) {
      toast.error("Формат: 0ч 00мин");
      setSpendMaskDraft(formatSpendMinutesRuMask(spendMinutes));
      return;
    }
    const snapped = snapSpendMinutesToStep(parsed, LOG_WORK_STEP_MIN, LOG_WORK_STEP_MIN, LOG_WORK_MAX_MIN);
    setSpendMinutes(snapped);
    setSpendMaskDraft(formatSpendMinutesRuMask(snapped));
  };

  const addTime = () => {
    let total = spendMinutes;
    const parsed = parseSpendMinutesRuMask(spendMaskDraft.trim());
    if (parsed != null) {
      total = snapSpendMinutesToStep(parsed, LOG_WORK_STEP_MIN, LOG_WORK_STEP_MIN, LOG_WORK_MAX_MIN);
      setSpendMinutes(total);
      setSpendMaskDraft(formatSpendMinutesRuMask(total));
    }
    if (total < LOG_WORK_STEP_MIN || total % LOG_WORK_STEP_MIN !== 0) {
      toast.error(`Длительность кратна ${LOG_WORK_STEP_MIN} минутам`);
      return;
    }
    const begin = beginIsoForWorkLog(newTimeDate);
    const comment = newTimeDesc.trim();
    postWork.mutate(
      { time: total, comment, begin, overtime: false },
      {
        onSuccess: () => {
          setLogWorkOpen(false);
          setNewTimeDesc("");
          setSpendMinutes(LOG_WORK_STEP_MIN);
          setSpendMaskDraft(formatSpendMinutesRuMask(LOG_WORK_STEP_MIN));
        },
      },
    );
  };

  const tabTriggerClass = cn(
    "rounded-md px-3 py-1.5 text-xs font-medium text-[var(--kanban-text-muted)] data-[state=active]:bg-[var(--kanban-hover)] data-[state=active]:text-[var(--kanban-text)] data-[state=active]:shadow-none sm:text-sm",
  );

  const tabLabel = (Icon: LucideIcon, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      {label}
    </span>
  );

  const showTaskExtras = !isEpicRow;

  const showInitialLoader = useMemo(() => {
    if (!components.isFetched) return true;
    if (!detail.isFetched) return true;
    if (fetchCommentsSeparate && !commentsQ.isFetched) return true;
    if (!isEpicRow && !workQ.isFetched) return true;
    return false;
  }, [
    components.isFetched,
    detail.isFetched,
    fetchCommentsSeparate,
    commentsQ.isFetched,
    isEpicRow,
    workQ.isFetched,
  ]);

  return (
    <div className="kanban-detail-panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="kanban-detail-panel-header shrink-0">
        <span className="kanban-detail-panel-title">{isEpicRow ? `Эпик #${summary.id}` : `Задача #${summary.id}`}</span>
        <button
          type="button"
          className="modal-close kanban-detail-panel-close hidden md:flex"
          onClick={onClose}
          aria-label="Закрыть"
          data-testid="button-close-detail"
        >
          <X size={16} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {showInitialLoader ? (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--kanban-surface)]/88 px-6 text-center backdrop-blur-[1px]"
            aria-busy="true"
            aria-live="polite"
            data-testid="task-detail-initial-loader"
          >
            <Loader2 className="h-8 w-8 shrink-0 animate-spin text-[var(--kanban-text-muted)]" aria-hidden />
            <span className="text-sm text-[var(--kanban-text-muted)]">Загрузка карточки...</span>
          </div>
        ) : null}

      <div className="detail-task-sticky-summary detail-task-control-deck shrink-0 border-b border-[var(--kanban-border)] px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-start gap-2">
          <h1
            className="detail-title min-w-0 flex-1 text-base font-semibold leading-snug text-[var(--kanban-text)] sm:text-lg"
            data-testid={`detail-title-${summary.id}`}
          >
            {mergedTask.title}
          </h1>
          {externalTaskUrl && (
            <a
              href={externalTaskUrl}
              target="_blank"
              rel="noreferrer"
              title="Открыть в Kanban"
              className="mt-0.5 shrink-0"
            >
              <Link2 size={15} color="var(--kanban-accent)" />
            </a>
          )}
        </div>
        {showTaskExtras && mergedTask.epicId != null && mergedTask.epicId > 0 ? (
          <div className="mt-1.5 font-mono text-[11px] text-[var(--kanban-text-faint)]" data-testid="detail-epic-id">
            Эпик #{mergedTask.epicId}
            {mergedTask.epicFull && mergedTask.epicFull !== "—" ? (
              <span className="text-[var(--kanban-text-muted)]"> · {mergedTask.epicFull}</span>
            ) : null}
          </div>
        ) : null}
        {isEpicRow ? (
          <div className="mt-3">
            <button
              type="button"
              className="btn-secondary text-[12px]"
              onClick={() => setQaTaskDialogOpen(true)}
              data-testid="button-create-qa-tasks-dialog"
            >
              <ClipboardCheck size={14} /> Создать задачи для QA
            </button>
          </div>
        ) : null}
        <div className="detail-ops-row">
          <span
            className={cn(
              "detail-priority-pill flex h-9 shrink-0 items-center justify-center px-2.5 sm:min-w-[5.5rem] sm:px-3",
              priorityPill.className,
            )}
            title="Приоритет"
            aria-label={`Приоритет: ${priorityPill.label}`}
          >
            {priorityPill.label}
          </span>
          <div className="detail-stage-field min-w-0 flex-1" style={detailStageVars}>
            <label className="sr-only" htmlFor={`kanban-detail-stage-${summary.id}`}>
              Стадия на доске
            </label>
            <select
              id={`kanban-detail-stage-${summary.id}`}
              className="detail-stage-select"
              value={String(mergedTask.columnId)}
              onChange={(e) => {
                const sid = Number(e.target.value);
                patchTask.mutate({ taskId: summary.id, body: { stage_id: sid } });
              }}
              disabled={patchTask.isPending}
              data-testid="select-task-status"
            >
              {columns.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.title}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="detail-stage-chevron" strokeWidth={2} aria-hidden />
          </div>
        </div>
      </div>

      <Tabs
        value={detailTab}
        onValueChange={(v) => setDetailTab(v as DetailMainTab)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TabsList
          className="mx-3 mb-0 mt-2 h-auto w-auto shrink-0 flex-wrap justify-start gap-1 rounded-lg border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] p-1 text-[var(--kanban-text-muted)] sm:mx-4"
          data-testid="detail-main-tabs"
        >
          <TabsTrigger value="overview" className={tabTriggerClass} data-testid="detail-tab-overview">
            {tabLabel(LayoutDashboard, "Обзор")}
          </TabsTrigger>
          {showTaskExtras ? (
            <TabsTrigger value="time" className={tabTriggerClass} data-testid="detail-tab-time">
              {tabLabel(Clock, "Время")}
            </TabsTrigger>
          ) : null}
          {isEpicRow ? (
            <TabsTrigger value="tasks" className={tabTriggerClass} data-testid="detail-tab-tasks">
              {tabLabel(ListTodo, "Задачи")}
            </TabsTrigger>
          ) : null}
          {isEpicRow ? (
            <TabsTrigger value="charts" className={tabTriggerClass} data-testid="detail-tab-charts">
              {tabLabel(BarChart2, "Графы")}
            </TabsTrigger>
          ) : null}
          {isEpicRow ? (
            <TabsTrigger value="worklog" className={tabTriggerClass} data-testid="detail-tab-worklog">
              {tabLabel(ClipboardList, "Worklog")}
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="comments" className={tabTriggerClass} data-testid="detail-tab-comments">
            {tabLabel(MessageSquare, "Комментарии")}
          </TabsTrigger>
          <TabsTrigger value="activity" className={tabTriggerClass} data-testid="detail-tab-activity">
            {tabLabel(History, "Активность")}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
          data-testid="detail-panel-overview"
        >
          <div className="detail-body-stack px-4 pb-6 pt-4">
            {mergedTask.description && mergedTask.description.trim() ? (
              <section className="detail-body-card" style={{ marginBottom: 20 }}>
                <div className="detail-section-label" style={{ marginBottom: 10 }}>
                  Описание
                </div>
                {/<[a-z][\s\S]*>/i.test(mergedTask.description) ? (
                  <KanbanCommentHtml
                    className="detail-description-html text-[13px] leading-relaxed text-[var(--kanban-text-muted)] [&_a]:text-[var(--kanban-accent)] [&_p]:mb-2 [&_p:last-child]:mb-0"
                    html={mergedTask.description}
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--kanban-text-muted)]">{mergedTask.description}</div>
                )}
              </section>
            ) : null}

            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <div className="detail-meta-card">
                <div className="detail-meta-label" style={{ marginBottom: 6 }}>
                  Типы
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {mergedTask.types.map((t) => (
                    <span key={t} className={`badge ${TYPE_CLASS[t] || "badge-type-task"}`}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="detail-meta-card">
                <div className="detail-meta-label" style={{ marginBottom: 6 }}>
                  Дата создания
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--kanban-text-muted)" }}>
                  <Calendar size={13} style={{ color: "var(--kanban-text-faint)" }} />
                  {mergedTask.createdAt ? new Date(mergedTask.createdAt).toLocaleDateString("ru-RU") : "—"}
                </div>
              </div>

              {showTaskExtras ? (
                <>
                  <div className="detail-meta-card sm:col-span-2">
                    <div className="detail-meta-label" style={{ marginBottom: 6 }}>
                      Эпик
                    </div>
                    <div style={{ fontSize: 13, color: "var(--kanban-text-muted)", lineHeight: 1.45 }}>
                      {mergedTask.epicFull?.trim() && mergedTask.epicFull !== "—" ? mergedTask.epicFull : "—"}
                    </div>
                  </div>
                  <div className="detail-meta-card">
                    <div className="detail-meta-label" style={{ marginBottom: 6 }}>
                      Ответственный
                    </div>
                    <div style={{ fontSize: 13, color: "var(--kanban-text-muted)" }}>{responsibleLabel(mergedTask)}</div>
                  </div>
                  <div className="detail-meta-card sm:col-span-2">
                    <div className="detail-meta-label" style={{ marginBottom: 8 }}>
                      Участники
                    </div>
                    <div style={{ fontSize: 12, color: "var(--kanban-text-muted)", lineHeight: 1.45 }}>{mergedTask.assignees.join(", ") || "—"}</div>
                  </div>
                </>
              ) : null}
            </div>

            {showTaskExtras ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="detail-section-label">Чек-лист</span>
                </div>
                {checklist.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--kanban-text-faint)" }}>Нет пунктов чек-листа</div>
                ) : (
                  checklist.map((item) => (
                    <div
                      key={item.pointId}
                      onClick={() => toggleCheck(item.pointId, item.done)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", cursor: "pointer", borderRadius: 3 }}
                      data-testid={`checklist-item-${item.pointId}`}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 3,
                          border: `1px solid ${item.done ? "var(--kanban-accent)" : "var(--kanban-border)"}`,
                          background: item.done ? "var(--kanban-accent)" : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "all 0.15s",
                        }}
                      >
                        {item.done && <Check size={10} color="#fff" />}
                      </div>
                      <span
                        style={{
                          fontSize: 13,
                          color: item.done ? "var(--kanban-text-faint)" : "var(--kanban-text-muted)",
                          textDecoration: item.done ? "line-through" : "none",
                        }}
                      >
                        {item.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <div className="drop-zone" style={{ marginBottom: 0 }}>
              <Paperclip size={14} style={{ color: "var(--kanban-text-faint)" }} />
              <span>Файлы загружаются в Kanban</span>
            </div>
          </div>
        </TabsContent>

        {showTaskExtras ? (
          <TabsContent
            value="time"
            className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
            data-testid="detail-panel-time"
          >
            <div className="detail-body-stack px-4 pb-6 pt-4">
              <div className="detail-meta-card mb-5">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span className="detail-meta-label" style={{ margin: 0 }}>
                    Затраченное время
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--kanban-text)" }} data-testid="detail-total-logged-time">
                    {spentH}ч {spentM}м
                  </span>
                </div>
                {estimateWorkerMinutes > 0 ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, color: "var(--kanban-text-faint)" }}>
                      <span>к оценке менеджера</span>
                      <span>
                        {managerH}ч {managerM}м
                      </span>
                    </div>
                    <div style={{ height: 4, background: "var(--kanban-hover)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${spentVsManagerPct}%`, background: "var(--kanban-accent)", borderRadius: 2 }} />
                    </div>
                  </>
                ) : totalLoggedMinutes > 0 ? (
                  <div style={{ height: 4, background: "var(--kanban-hover)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: "100%", background: "var(--kanban-accent)", borderRadius: 2 }} />
                  </div>
                ) : null}
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span className="detail-section-label">Журнал времени</span>
                  <Popover open={logWorkOpen} onOpenChange={setLogWorkOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="btn-secondary" style={{ fontSize: 12 }} data-testid="detail-button-log-work">
                        <Clock size={12} /> Списать время
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-[min(calc(100vw-24px),340px)] border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] p-3 text-[var(--kanban-text)] shadow-lg sm:w-[320px]"
                      data-testid="detail-popover-log-work"
                    >
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="mfield-label mb-1">Описание</div>
                          <input
                            className="mfield-input w-full"
                            placeholder="Комментарий к записи"
                            value={newTimeDesc}
                            onChange={(e) => setNewTimeDesc(e.target.value)}
                            data-testid="detail-log-work-desc"
                          />
                        </div>
                        <div>
                          <div className="mfield-label mb-1">Время</div>
                          <div className="flex flex-col items-center gap-1 rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface)] px-3 py-2">
                            <button
                              type="button"
                              className="flex h-7 w-full max-w-[7rem] items-center justify-center rounded border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] text-[var(--kanban-text-muted)] hover:bg-[var(--kanban-hover)] hover:text-[var(--kanban-text)] disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Увеличить на 15 минут"
                              disabled={spendMinutes >= LOG_WORK_MAX_MIN || postWork.isPending}
                              onClick={() => {
                                setSpendMinutes((m) => {
                                  const n = Math.min(LOG_WORK_MAX_MIN, m + LOG_WORK_STEP_MIN);
                                  setSpendMaskDraft(formatSpendMinutesRuMask(n));
                                  return n;
                                });
                              }}
                              data-testid="detail-log-work-plus"
                            >
                              <ChevronUp className="h-4 w-4" aria-hidden />
                            </button>
                            <input
                              className="w-full max-w-[7rem] border-0 bg-transparent py-0.5 text-center font-mono text-sm font-semibold tabular-nums text-[var(--kanban-text)] outline-none ring-0 placeholder:text-[var(--kanban-text-faint)] focus-visible:ring-0"
                              value={spendMaskDraft}
                              onChange={(e) => setSpendMaskDraft(e.target.value)}
                              onBlur={commitSpendMaskDraft}
                              placeholder="0ч 00мин"
                              autoComplete="off"
                              spellCheck={false}
                              data-testid="detail-log-work-duration-display"
                              aria-label="Длительность в формате 0ч 00мин"
                            />
                            <button
                              type="button"
                              className="flex h-7 w-full max-w-[7rem] items-center justify-center rounded border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] text-[var(--kanban-text-muted)] hover:bg-[var(--kanban-hover)] hover:text-[var(--kanban-text)] disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="Уменьшить на 15 минут"
                              disabled={spendMinutes <= LOG_WORK_STEP_MIN || postWork.isPending}
                              onClick={() => {
                                setSpendMinutes((m) => {
                                  const n = Math.max(LOG_WORK_STEP_MIN, m - LOG_WORK_STEP_MIN);
                                  setSpendMaskDraft(formatSpendMinutesRuMask(n));
                                  return n;
                                });
                              }}
                              data-testid="detail-log-work-minus"
                            >
                              <ChevronDown className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                          <p className="mt-1.5 text-[11px] leading-snug text-[var(--kanban-text-faint)]">
                            Шаг ±15 минут; вручную — маска <span className="font-mono">0ч 00мин</span>, при уходе с поля округляется до 15 минут.
                          </p>
                        </div>
                        <div>
                          <div className="mfield-label mb-1">Дата</div>
                          <input
                            className="mfield-input w-full"
                            type="date"
                            value={newTimeDate}
                            onChange={(e) => setNewTimeDate(e.target.value)}
                            data-testid="detail-log-work-date"
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <button type="button" className="btn-secondary text-xs" onClick={() => setLogWorkOpen(false)}>
                            Отмена
                          </button>
                          <button type="button" className="btn-primary text-xs" onClick={addTime} disabled={postWork.isPending} data-testid="detail-log-work-submit">
                            OK
                          </button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                {workQ.isLoading ? (
                  <div className="flex items-center gap-2 py-4 text-[13px] text-[var(--kanban-text-faint)]">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    Загрузка журнала...
                  </div>
                ) : workLogs.length === 0 ? (
                  <div className="rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] px-4 py-6 text-center text-[13px] text-[var(--kanban-text-faint)]">Нет записей</div>
                ) : (
                  workLogs.map((log) => {
                    const lh = Math.floor(log.minutes / 60);
                    const lm = log.minutes % 60;
                    const when = log.loggedAt?.trim();
                    const whenLabel =
                      when && Number.isFinite(Date.parse(when)) ? new Date(when).toLocaleString("ru-RU") : when && when !== "—" ? when : "—";
                    return (
                      <div key={log.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--kanban-border)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--kanban-text)", fontWeight: 500 }}>{log.user}</div>
                          <div style={{ fontSize: 12, color: "var(--kanban-text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {log.description?.trim() ? log.description : "—"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--kanban-text)", fontWeight: 600 }}>
                            {lh > 0 ? `${lh}ч ` : ""}
                            {lm}м
                          </div>
                          <div style={{ fontSize: 11, color: "var(--kanban-text-faint)", marginTop: 2 }}>{whenLabel}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="detail-meta-card mb-0">
                <div className="detail-section-label" style={{ marginBottom: 8 }}>
                  Оценка менеджера
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--kanban-text)" }} data-testid="detail-estimate-worker">
                  {estimateWorkerMinutes > 0 ? (
                    <>
                      {managerH}ч {managerM}м
                      <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "var(--kanban-text-muted)" }}>({estimateWorkerMinutes} мин.)</span>
                    </>
                  ) : (
                    <span style={{ color: "var(--kanban-text-faint)", fontWeight: 400 }}>—</span>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        ) : null}

        {isEpicRow ? (
          <TabsContent
            value="tasks"
            className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
            data-testid="detail-panel-tasks"
          >
            <div className="detail-body-stack px-4 pb-6 pt-4">
              <p className="mb-3 text-[12px] leading-relaxed text-[var(--kanban-text-faint)]">
                Задачи на этой доске, привязанные к этому эпику.
              </p>
              {epicChildTasks.length === 0 ? (
                <div className="rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] px-4 py-8 text-center text-[13px] text-[var(--kanban-text-faint)]">
                  Нет связанных задач на доске
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {epicChildTasks.map((t) => {
                    const col = columns.find((c) => c.id === t.columnId);
                    const colColor = col?.color ?? "var(--kanban-text-muted)";
                    const statusLabel = t.status?.trim() || "—";
                    const wf = t.workflowStatus?.trim();
                    const statusColor =
                      (wf && WORKFLOW_STATUS_COLOR[wf]) || WORKFLOW_STATUS_COLOR[statusLabel] || colColor;
                    const open = () => onOpenTask?.(t);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="flex w-full min-w-0 flex-col gap-2 rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] px-3 py-2.5 text-left transition-colors hover:border-[var(--kanban-text-faint)] hover:bg-[var(--kanban-hover)] disabled:cursor-default disabled:opacity-60"
                          onClick={open}
                          disabled={!onOpenTask}
                          data-testid={`detail-epic-child-${t.id}`}
                        >
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-[var(--kanban-text)]">
                              #{t.id} · {t.title}
                            </span>
                            <span
                              className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
                              style={{
                                color: statusColor,
                                border: `1px solid ${statusColor}55`,
                                background: `${statusColor}14`,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {t.types.map((ty) => (
                              <span key={ty} className={`badge text-[11px] ${TYPE_CLASS[ty] || "badge-type-task"}`}>
                                {ty}
                              </span>
                            ))}
                            <span className={`badge text-[11px] ${PRIORITY_CLASS[t.priority] || "badge-priority-medium"}`}>
                              {t.priority}
                            </span>
                            {responsibleLabel(t) !== "—" ? (
                              <span className="ml-auto truncate text-[11px] text-[var(--kanban-text-faint)]">{responsibleLabel(t)}</span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </TabsContent>
        ) : null}

        {isEpicRow ? (
          <TabsContent
            value="charts"
            className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
            data-testid="detail-panel-charts"
          >
            <div className="px-3 pb-6 pt-3 sm:px-4">
              <KanbanEpicAnalyticsPanel projectSlug={projectSlug} epicKanbanId={summary.id} />
            </div>
          </TabsContent>
        ) : null}

        {isEpicRow ? (
          <TabsContent
            value="worklog"
            className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
            data-testid="detail-panel-worklog"
          >
            <div className="detail-body-stack px-4 pb-6 pt-4">
              <p className="mb-3 text-[12px] leading-relaxed text-[var(--kanban-text-faint)]">
                Списания времени по эпику и дочерним задачам (отдельный запрос work по каждой карточке). Направление в фильтрах
                совпадает с графами эпика: по роли автора в Resonance (настройки участников Kanban), а не по компоненту задачи;
                без явной роли — «Прочее».
              </p>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--kanban-text-faint)]">Направления</span>
                {EPIC_WORKLOG_LANE_CHIPS.map((c) => (
                  <button
                    key={c.lane}
                    type="button"
                    onClick={() => toggleWorklogLane(c.lane)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      worklogLaneFilter.length === 0
                        ? "border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] text-[var(--kanban-text-muted)] hover:border-[var(--kanban-accent)]/45"
                        : worklogLaneFilter.includes(c.lane)
                          ? "border-[var(--kanban-accent)] bg-[var(--kanban-hover)] text-[var(--kanban-text)]"
                          : "border-[var(--kanban-hover)] bg-transparent text-[var(--kanban-text-faint)] hover:border-[var(--kanban-text-faint)]",
                    )}
                    data-testid={`detail-worklog-filter-${c.lane}`}
                  >
                    {c.label}
                  </button>
                ))}
                {worklogLaneFilter.length > 0 ? (
                  <button
                    type="button"
                    className="ml-1 text-[11px] font-medium text-[var(--kanban-accent)] hover:underline"
                    onClick={() => setWorklogLaneFilter([])}
                    data-testid="detail-worklog-filter-reset"
                  >
                    Сбросить
                  </button>
                ) : null}
              </div>
              {epicWorklogLoading && epicWorklogFiltered.length === 0 ? (
                <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--kanban-text-faint)]">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  Загрузка worklog...
                </div>
              ) : epicWorklogFiltered.length === 0 ? (
                <div className="rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] px-4 py-8 text-center text-[13px] text-[var(--kanban-text-faint)]">
                  Нет записей по выбранным условиям
                </div>
              ) : (
                <div className="flex flex-col">
                  {epicWorklogFiltered.map((log) => {
                    const lh = Math.floor(log.minutes / 60);
                    const lm = log.minutes % 60;
                    const when = log.loggedAt?.trim();
                    const whenLabel =
                      when && Number.isFinite(Date.parse(when)) ? new Date(when).toLocaleString("ru-RU") : when && when !== "—" ? when : "—";
                    const task = log.sourceTaskId === summary.id ? mergedTask : epicChildTasks.find((t) => t.id === log.sourceTaskId);
                    const comp = task?.componentLabel?.trim() && task.componentLabel !== "—" ? task.componentLabel : "—";
                    return (
                      <div
                        key={`${log.sourceTaskId}-${log.id}`}
                        className="flex gap-3 border-b border-[var(--kanban-border)] py-3 last:border-b-0"
                        data-testid={`detail-worklog-row-${log.sourceTaskId}-${log.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[13px] font-semibold text-[var(--kanban-text)]">{log.user}</span>
                            <span className="rounded bg-[var(--kanban-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--kanban-text-muted)]">
                              {EPIC_WORKLOG_LANE_CHIPS.find((x) => x.lane === log.lane)?.label ?? log.lane}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-[var(--kanban-text-faint)]">
                            #{log.sourceTaskId} · {log.sourceTaskTitle}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--kanban-text-faint)]">Компонент задачи: {comp}</div>
                          <div className="mt-1 text-[12px] text-[var(--kanban-text-muted)]">{log.description?.trim() ? log.description : "—"}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[13px] font-semibold text-[var(--kanban-text)]">
                            {lh > 0 ? `${lh}ч ` : ""}
                            {lm}м
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--kanban-text-faint)]">{whenLabel}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        ) : null}

        <TabsContent
          value="comments"
          className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
          data-testid="detail-panel-comments"
        >
          <div className="detail-body-stack px-4 pb-6 pt-4">
            {comments.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {comments.map((c) => {
                  const authorAvatar = getAvatarInfo(c.author);
                  return (
                    <div key={c.id} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                      <Avatar initials={authorAvatar.initials} color={authorAvatar.color} size={28} title={c.author} />
                      <div style={{ flex: 1, background: "var(--kanban-surface-2)", border: "1px solid var(--kanban-border)", borderRadius: 4, padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--kanban-text)" }}>{c.author}</span>
                          <span style={{ fontSize: 11, color: "var(--kanban-text-faint)" }}>
                            {c.createdAt ? new Date(c.createdAt).toLocaleString("ru-RU") : ""}
                          </span>
                        </div>
                        <KanbanCommentHtml html={c.text} className="kanban-comment-html" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="rte-box" style={{ marginBottom: 10 }}>
              <RteToolbar />
              <textarea
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 80,
                  background: "none",
                  border: "none",
                  color: "var(--kanban-text)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  padding: "10px",
                  resize: "vertical",
                  outline: "none",
                  lineHeight: 1.5,
                  boxSizing: "border-box",
                }}
                placeholder="Введите текст (Ctrl+Enter — отправить)"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendComment();
                }}
                data-testid="textarea-comment"
              />
            </div>
            <button type="button" className="btn-primary" style={{ fontSize: 13 }} onClick={sendComment} disabled={postComment.isPending} data-testid="button-send-comment">
              <Send size={13} /> Отправить
            </button>
          </div>
        </TabsContent>

        <TabsContent
          value="activity"
          className="kanban-scroll mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden focus-visible:outline-none"
          data-testid="detail-panel-activity"
        >
          <div className="detail-body-stack px-4 pb-6 pt-4">
            {historyEntries.length === 0 ? (
              <div className="rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] px-4 py-8 text-center text-[13px] text-[var(--kanban-text-faint)]">Нет записей в истории</div>
            ) : (
              <ul className="flex flex-col gap-3">
                {historyEntries.map((entry, idx) => (
                  <li
                    key={`${entry.updatedAt}-${idx}`}
                    className="rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] p-3"
                    data-testid={`history-entry-${idx}`}
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-[var(--kanban-text-muted)]">
                      <span>
                        {entry.updatedAt !== "—" ? new Date(entry.updatedAt).toLocaleString("ru-RU") : "—"}
                      </span>
                      <span className="font-medium text-[var(--kanban-text)]">{userLabelById(entry.updatedById, detailUsers, projectMemberIdToName)}</span>
                    </div>
                    {entry.changes.length === 0 ? (
                      <div className="text-[12px] text-[var(--kanban-text-faint)]">Без детализации изменений</div>
                    ) : (
                      <ul className="space-y-2">
                        {entry.changes.map((ch, j) => (
                          <li key={j} className="border-t border-[var(--kanban-border)] pt-2 text-[13px] first:border-t-0 first:pt-0">
                            <div className="font-medium text-[var(--kanban-text)]">{formatHistoryValue(ch.type, 120)}</div>
                            <div className="mt-1 text-[var(--kanban-text-muted)]">
                              <span className="text-[var(--kanban-text-faint)]">Было: </span>
                              <span title={ch.old}>{formatHistoryValue(ch.old)}</span>
                            </div>
                            <div className="mt-0.5 text-[var(--kanban-text-muted)]">
                              <span className="text-[var(--kanban-text-faint)]">Стало: </span>
                              <span title={ch.new}>{formatHistoryValue(ch.new)}</span>
                            </div>
                            {ch.details.map((d, k) => (
                              <div key={k} className="mt-1 text-[12px] text-[var(--kanban-text-faint)]">
                                {d}
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>
      </div>
      {isEpicRow ? (
        <QaTaskBulkCreateDialog
          open={qaTaskDialogOpen}
          onOpenChange={setQaTaskDialogOpen}
          projectSlug={projectSlug}
          epic={mergedTask}
          epicDescription={mergedTask.description ?? ""}
          childTasks={epicChildTasks}
          columns={columns}
          taskTypes={taskTypeRefs}
          prioritiesList={priorityRefs}
          componentsList={components.data}
          memberIdToName={projectMemberIdToName ?? new Map()}
        />
      ) : null}
    </div>
  );
}
