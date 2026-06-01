import type { RefUser } from "@/lib/mappers";
import type { KanbanMemberProjectRole } from "@/lib/queries";

import type {
  KanbanChecklistRow,
  KanbanColumn,
  KanbanCommentRow,
  KanbanEstimateRow,
  KanbanPriority,
  KanbanResponsibleEstimateRow,
  KanbanTask,
  KanbanWorkRow,
  KanbanWorklogLane,
} from "./types";
import { kanbanCanonicalBoardStatus } from "./status-allowlist";

/** DS Kanban: type_id 5 = «Эпик» (см. helps/v1.json, filter[type_id]). */
export function kanbanTaskRowIsEpicType(t: KanbanTask): boolean {
  if (t.taskTypeId === 5) return true;
  return t.types.includes("Эпик") || t.types.some((x) => /эпик|epic/i.test(x));
}

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

/** Kanban id автора записи Work (`user.id` или `user_id`). */
function workLogKanbanUserId(o: Record<string, unknown>): number | null {
  const user = asRecord(o.user);
  if (user) {
    const id = Number(user.id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  const uid = Number(o.user_id ?? o.userId);
  if (Number.isFinite(uid) && uid > 0) return uid;
  return null;
}

/** Автор записи Work: вложенный `user`, иначе `user_id` + массив пользователей задачи (GET /task/{id}). */
function workLogPersonName(o: Record<string, unknown>, taskUsers: unknown, memberIdToName?: Map<number, string>): string {
  const user = asRecord(o.user);
  if (user) {
    const n = personName(user);
    if (n) return n;
  }
  const uid = Number(o.user_id ?? o.userId);
  if (Number.isFinite(uid) && uid > 0) {
    const fromProject = memberIdToName?.get(uid);
    if (fromProject) return fromProject;
    if (Array.isArray(taskUsers)) {
      for (const u of taskUsers) {
        const ur = asRecord(u);
        if (ur && Number(ur.id) === uid) {
          const n = personName(ur);
          if (n) return n;
        }
      }
    }
  }
  return "—";
}

/**
 * Эвристика направления по подписи компонента задачи (поле `component` / `componentLabel`).
 * В OpenAPI у записи Work нет роли — фильтр эпика опирается на задачу, к которой относится списание.
 */
export function kanbanWorklogLaneFromComponentLabel(componentLabel: string): KanbanWorklogLane {
  const raw = componentLabel.trim();
  if (!raw || raw === "—" || raw === "-") return "other";
  const s = raw.toLowerCase();

  if (/\bqa\b|qa\/|\/qa|тестирован|тестер|quality\b/i.test(raw)) return "qa";
  if (/фронт|\bfront|\bfrontend|client-side|веб-клиент/i.test(s)) return "front";
  if (/бэк|\bback|\bbackend|server-side|серверн/i.test(s)) return "back";
  if (/менеджер|\bmanager|\bpm\b|руководител|project\s*manager/i.test(s)) return "manager";

  return "other";
}

/** Направление worklog по роли участника (настройки Resonance), в духе `effective_role` на бэкенде. */
export function kanbanWorklogLaneFromMemberRole(role: KanbanMemberProjectRole | undefined | null): KanbanWorklogLane {
  switch (role) {
    case "QA":
      return "qa";
    case "Frontend":
      return "front";
    case "Backend":
    case "Java":
      return "back";
    case "Manager":
      return "manager";
    case "Other":
    default:
      return "other";
  }
}

export function normalizePriorityLabel(name: string): KanbanPriority {
  const n = name.toLowerCase();
  if (n.includes("высок") || n.includes("high") || n.includes("urgent") || n.includes("критич")) return "Высокий";
  if (n.includes("низк") || n.includes("low")) return "Низкий";
  if (n.includes("medium") || n.includes("normal") || n.includes("средн")) return "Средний";
  return "Средний";
}

/** Collapse whitespace, trim, lowercase — for comparing Kanban person labels. */
export function normalizeKanbanPersonLabel(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Strings derived from app user profile to match against Kanban assignee display names. */
export function buildKanbanCurrentUserMatchNeedles(user: RefUser): string[] {
  const out = new Set<string>();
  const push = (raw: string) => {
    const n = normalizeKanbanPersonLabel(raw);
    if (n.length >= 2) out.add(n);
  };
  push(user.name);
  push(user.email);
  const local = user.email.includes("@") ? user.email.split("@")[0] : "";
  if (local) push(local);
  for (const part of user.name.split(/[.\s_\-]+/)) {
    if (part.length >= 2) push(part);
  }
  return [...out];
}

export function kanbanAssigneeListIncludesCurrent(assignees: string[], user: RefUser): boolean {
  if (!assignees.length) return false;
  const needles = buildKanbanCurrentUserMatchNeedles(user);
  if (!needles.length) return false;
  return assignees.some((a) => {
    const norm = normalizeKanbanPersonLabel(a);
    if (norm.length < 2) return false;
    return needles.some((n) => norm === n || norm.includes(n) || n.includes(norm));
  });
}

export function isKanbanHighPriorityFromRefName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("высок") || n.includes("high") || n.includes("urgent") || n.includes("критич");
}

/** Flat list of project member display names (for filters, selects). */
export function mapProjectMembersToNames(project: unknown): string[] {
  const p = asRecord(project);
  if (!p) return [];
  const raw = p.users ?? p.members ?? p.project_users ?? p.staff ?? [];
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    const ur = asRecord(item);
    const src = asRecord(ur?.user) ?? ur;
    if (src) {
      const n = personName(src);
      if (n) names.push(n);
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "ru"));
}

export function mapProjectMembersToIdNameMap(project: unknown): Map<number, string> {
  const m = new Map<number, string>();
  const p = asRecord(project);
  if (!p) return m;
  const raw = p.users ?? p.members ?? p.project_users ?? p.staff ?? [];
  if (!Array.isArray(raw)) return m;
  for (const item of raw) {
    const ur = asRecord(item);
    const src = asRecord(ur?.user) ?? ur;
    if (!src) continue;
    const id = Number(src.id ?? ur?.user_id ?? ur?.id);
    const n = personName(src);
    if (Number.isFinite(id) && id > 0 && n) m.set(id, n);
  }
  return m;
}

export function kanbanPersonDisplayName(u: unknown): string {
  return personName(asRecord(u));
}

export function mapKanbanUserRowsToNames(users: unknown): string[] {
  if (!Array.isArray(users)) return [];
  const names: string[] = [];
  for (const item of users) {
    const n = kanbanPersonDisplayName(item);
    if (n) names.push(n);
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "ru"));
}

export type KanbanPriorityRef = { id: number; name: string };

export type KanbanTaskTypeRef = { id: number; name: string };

function resolveComponentFields(
  o: Record<string, unknown>,
  componentIdToName?: Map<number, string>,
): { id: number | null; label: string } {
  const comp = o.component;
  if (comp == null || comp === "") return { id: null, label: "—" };

  const rec = asRecord(comp);
  if (rec) {
    const id = Number(rec.id);
    const name = String(rec.name ?? "").trim();
    if (name) return { id: Number.isFinite(id) && id > 0 ? id : null, label: name };
    if (Number.isFinite(id) && id > 0) {
      const mapped = componentIdToName?.get(id);
      return { id, label: mapped ?? `Компонент #${id}` };
    }
  }

  if (typeof comp === "number" || (typeof comp === "string" && /^\d+$/.test(String(comp).trim()))) {
    const cid = Number(comp);
    if (Number.isFinite(cid) && cid > 0) {
      const mapped = componentIdToName?.get(cid);
      return { id: cid, label: mapped ?? `Компонент #${cid}` };
    }
  }

  return { id: null, label: "—" };
}

function parseDeadlineStatus(o: Record<string, unknown>): number | null {
  const raw = o.deadline_status ?? o.deadlineStatus;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Ячейка «Дедлайн» в списке: дата + статус по `deadline_status` Kanban. */
export function formatKanbanDeadlineListCell(deadline: string | null | undefined, deadlineStatus: number | null): string {
  let datePart = "—";
  if (deadline) {
    const t = Date.parse(deadline);
    if (Number.isFinite(t)) {
      datePart = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(t);
    } else {
      const s = String(deadline).trim();
      datePart = s.length >= 10 ? s.slice(0, 10) : s;
    }
  }

  const code = deadlineStatus != null && Number.isFinite(deadlineStatus) ? deadlineStatus : null;
  let statusRu = "—";
  if (code === 0) statusRu = "В сроке";
  else if (code === 1) statusRu = "Срок близится";
  else if (code === 2) statusRu = "Просрочено";

  if (code === null && (!deadline || !String(deadline).trim())) return "—";
  if (code === 0 && (!deadline || !String(deadline).trim())) return "Без дедлайна";
  if (code === null) return datePart;
  if (!deadline || !String(deadline).trim()) return statusRu;
  return `${datePart} · ${statusRu}`;
}

/** Четыре категории типа для бейджей и фильтра доски (маппинг от DS, см. helps/v1.json filter[type_id]). */
export type KanbanTaskTypeCategory = "Баг" | "Задача" | "Эпик" | "Улучшение";

/**
 * Сводит тип из Kanban к четырём категориям UI.
 * Id: 1 Баг, 2 Задача, 3 Улучшение, 4 Новая функциональность, 5 Эпик, 6 Релиз, 7 Бэклог.
 */
export function canonicalKanbanTaskTypeLabel(apiLabel: string, taskTypeId: number | null): KanbanTaskTypeCategory {
  if (taskTypeId != null && Number.isFinite(taskTypeId) && taskTypeId > 0) {
    if (taskTypeId === 1) return "Баг";
    if (taskTypeId === 5) return "Эпик";
    if (taskTypeId === 3) return "Улучшение";
    if (taskTypeId === 2 || taskTypeId === 4 || taskTypeId === 6 || taskTypeId === 7) return "Задача";
  }
  const n = apiLabel.trim().toLowerCase();
  if (n.includes("баг") || /\bbug\b/.test(n)) return "Баг";
  if (n.includes("эпик") || n.includes("epic")) return "Эпик";
  if (n.includes("улучшен") || n.includes("improvement")) return "Улучшение";
  if (n.includes("новая функциональ") || n.includes("нов. функционал")) return "Задача";
  if (n.includes("релиз") || n.includes("бэклог") || n.includes("release") || n.includes("backlog")) return "Задача";
  if (n.includes("тестирован") || n.includes("фронтенд") || n.includes("разработк") || n.includes("управлен"))
    return "Задача";
  return "Задача";
}

function resolveTaskTypeId(o: Record<string, unknown>): number | null {
  const tt = asRecord(o.task_type);
  if (tt) {
    const tid = Number(tt.id);
    if (Number.isFinite(tid) && tid > 0) return tid;
  }
  const raw = o.task_type ?? o.task_type_id ?? o.type_id;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(String(raw).trim()))) {
    const tid = Number(raw);
    if (Number.isFinite(tid) && tid > 0) return tid;
  }
  return null;
}

function resolveTaskTypeLabel(o: Record<string, unknown>, taskTypes?: KanbanTaskTypeRef[]): string {
  const tt = asRecord(o.task_type);
  if (tt) {
    const nm = String(tt.name ?? "").trim();
    if (nm) return nm;
    const tid = Number(tt.id);
    if (taskTypes && Number.isFinite(tid) && tid > 0) {
      const hit = taskTypes.find((t) => t.id === tid);
      if (hit?.name) return hit.name.trim();
    }
  }
  const raw = o.task_type ?? o.task_type_id ?? o.type_id;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(String(raw).trim()))) {
    const tid = Number(raw);
    if (taskTypes && Number.isFinite(tid) && tid > 0) {
      const hit = taskTypes.find((t) => t.id === tid);
      if (hit?.name) return hit.name.trim();
    }
  }
  return "Задача";
}

function resolvePriorityNameAndId(
  o: Record<string, unknown>,
  priorities?: KanbanPriorityRef[],
): { name: string; id: number | null } {
  const pr = asRecord(o.priority);
  if (pr) {
    const prId = Number(pr.id);
    if (Number.isFinite(prId) && prId > 0) {
      if (priorities) {
        const hit = priorities.find((p) => p.id === prId);
        if (hit?.name) return { name: hit.name.trim(), id: prId };
      }
      const byName = String(pr.name ?? "").trim();
      if (byName) return { name: byName, id: prId };
      return { name: "", id: prId };
    }
    const byName = String(pr.name ?? "").trim();
    if (byName) return { name: byName, id: null };
  }
  const pid = Number(
    typeof o.priority === "number" || (typeof o.priority === "string" && String(o.priority).trim() !== "")
      ? o.priority
      : o.priority_id,
  );
  if (Number.isFinite(pid) && pid > 0) {
    if (priorities) {
      const hit = priorities.find((p) => p.id === pid);
      if (hit?.name) return { name: hit.name.trim(), id: pid };
    }
    return { name: "", id: pid };
  }
  return { name: "", id: null };
}

/** Цвет маркера колонки, если в API один и тот же «дефолтный» синий для всех стадий. */
const STAGE_MARKER_PALETTE = ["#58a6ff", "#a371f7", "#3fb950", "#d29922", "#f85149", "#39c5cf", "#db61a2", "#ffa657"];

function isGenericKanbanStageBlue(hex: string): boolean {
  const h = hex.trim().toLowerCase();
  if (!h) return true;
  return (
    h === "#58a6ff" ||
    h === "#388bfd" ||
    h === "#1f6feb" ||
    h === "#0969da" ||
    h === "#2188ff" ||
    h === "#79c0ff"
  );
}

export function mapDsStagesToColumns(stages: unknown): KanbanColumn[] {
  if (!Array.isArray(stages)) return [];
  type Row = { id: number; title: string; rawColor: string; position: number };
  const rows: Row[] = [];
  for (let idx = 0; idx < stages.length; idx++) {
    const o = asRecord(stages[idx]);
    if (!o) continue;
    const id = Number(o.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const title = String(o.name ?? o.title ?? "—");
    const raw = o.color != null ? String(o.color).trim() : "";
    const position = Number(o.sort ?? o.position ?? o.order ?? idx);
    rows.push({
      id,
      title,
      rawColor: raw,
      position: Number.isFinite(position) ? position : idx,
    });
  }
  rows.sort((a, b) => a.position - b.position);
  const normalized = rows.map((r) => r.rawColor.trim().toLowerCase()).filter(Boolean);
  const uniq = new Set(normalized);
  const allUniformOrGenericBlue =
    uniq.size === 0 || uniq.size === 1 || [...uniq].every((c) => isGenericKanbanStageBlue(c));

  return rows.map((r, i) => {
    const raw = r.rawColor.trim();
    const norm = raw.toLowerCase();
    const usePalette = allUniformOrGenericBlue || !raw || isGenericKanbanStageBlue(norm);
    const color = usePalette ? STAGE_MARKER_PALETTE[i % STAGE_MARKER_PALETTE.length] : raw;
    return { id: r.id, title: r.title, color, position: r.position };
  });
}

/** Kanban API: `status` on task is often workflow (1 Новая, 2 Ожидает оценки, 3 Проверена), not board stage. */
const WORKFLOW_STATUS_LABEL: Record<number, string> = {
  1: "Новая",
  2: "Ожидает оценки",
  3: "Проверена",
};

function mapWorkflowStatusLabel(o: Record<string, unknown>): string | null {
  const s = o.status;
  if (typeof s === "number" && WORKFLOW_STATUS_LABEL[s]) return WORKFLOW_STATUS_LABEL[s];
  if (typeof s === "string" && s.trim() !== "") {
    const n = Number(s);
    if (Number.isFinite(n) && WORKFLOW_STATUS_LABEL[n]) return WORKFLOW_STATUS_LABEL[n];
  }
  const obj = asRecord(s);
  if (obj) {
    const name = String(obj.name ?? "").trim();
    if (name) return name;
  }
  return null;
}

function resolveBoardStageId(o: Record<string, unknown>): number {
  const stage = o.stage;
  if (typeof stage === "number" && Number.isFinite(stage) && stage > 0) return stage;
  if (typeof stage === "string" && stage.trim() !== "") {
    const n = Number(stage);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const st = asRecord(stage);
  if (st) {
    const sid = Number(st.id);
    if (Number.isFinite(sid) && sid > 0) return sid;
  }
  const fromStageId = Number(o.stage_id);
  if (Number.isFinite(fromStageId) && fromStageId > 0) return fromStageId;
  return 0;
}

function resolveBoardStageTitle(o: Record<string, unknown>, columnId: number, columns?: KanbanColumn[]): string {
  const stage = o.stage;
  const st = asRecord(stage);
  if (st) {
    const n = String(st.name ?? st.title ?? "").trim();
    if (n) return n;
  }
  const named = String(o.stage_name ?? "").trim();
  if (named) return named;
  const byCol = columns?.find((c) => c.id === columnId)?.title;
  if (byCol) return byCol;
  return "—";
}

/** Сырая строка задачи (bundle / GET task): стадия доски для оптимистичного UI. */
export function optimisticDsTaskRowSetStage(raw: unknown, newStageId: number): unknown {
  const o = asRecord(raw);
  if (!o) return raw;
  const out: Record<string, unknown> = { ...o };
  out.stage_id = newStageId;
  const st = o.stage;
  if (st && typeof st === "object" && !Array.isArray(st)) {
    out.stage = { ...(st as Record<string, unknown>), id: newStageId };
  } else {
    out.stage = { id: newStageId };
  }
  return out;
}

function epicFromNestedTaskLike(obj: Record<string, unknown>): { epicId: number | null; epicFull: string } | null {
  const eid = Number(obj.id);
  const epicId = Number.isFinite(eid) && eid > 0 ? eid : null;
  const rawName = String(obj.name ?? obj.title ?? "").trim();
  if (rawName) return { epicId, epicFull: rawName };
  if (epicId) return { epicId, epicFull: `Эпик #${epicId}` };
  return null;
}

/**
 * Kanban list/detail: `epic` (TaskSingle / TaskShort), `epic_id`, legacy numeric `epic`,
 * строка **`epic_name`** в ответе `GET /project/{slug}/task` (реальный payload шире TaskMultiple в OpenAPI).
 * Также `parent` / `parent_id` (см. TaskSingle в v1.json).
 */
function resolveEpicFields(o: Record<string, unknown>): {
  epicId: number | null;
  epicFull: string;
  epicRefIsParentLink: boolean;
} {
  const epicNameTrim = String(o.epic_name ?? o.epicName ?? "").trim();

  const epicObj = asRecord(o.epic);
  if (epicObj) {
    const hit = epicFromNestedTaskLike(epicObj);
    if (hit) {
      const epicFull = epicNameTrim || hit.epicFull;
      return { epicId: hit.epicId, epicFull, epicRefIsParentLink: false };
    }
  }
  if (typeof o.epic === "number" || (typeof o.epic === "string" && /^\d+$/.test(String(o.epic).trim()))) {
    const eid = Number(o.epic);
    if (Number.isFinite(eid) && eid > 0) {
      return { epicId: eid, epicFull: epicNameTrim || `Эпик #${eid}`, epicRefIsParentLink: false };
    }
  }
  const topEpicId = Number(o.epic_id ?? o.epicId);
  if (Number.isFinite(topEpicId) && topEpicId > 0) {
    return { epicId: topEpicId, epicFull: epicNameTrim || `Эпик #${topEpicId}`, epicRefIsParentLink: false };
  }
  if (typeof o.epic === "string") {
    const s = o.epic.trim();
    if (s) return { epicId: null, epicFull: epicNameTrim || s, epicRefIsParentLink: false };
  }
  if (epicNameTrim) {
    return { epicId: null, epicFull: epicNameTrim, epicRefIsParentLink: false };
  }

  const superObj = asRecord(o.super_task) ?? asRecord(o.supertask);
  if (superObj) {
    const hit = epicFromNestedTaskLike(superObj);
    if (hit) return { ...hit, epicRefIsParentLink: false };
  }

  const parentObj = asRecord(o.parent);
  if (parentObj) {
    const hit = epicFromNestedTaskLike(parentObj);
    if (hit) return { ...hit, epicRefIsParentLink: true };
  }

  const parentId = Number(o.parent_id ?? o.parentId);
  if (Number.isFinite(parentId) && parentId > 0) {
    return { epicId: parentId, epicFull: `Эпик #${parentId}`, epicRefIsParentLink: true };
  }

  return { epicId: null, epicFull: "—", epicRefIsParentLink: false };
}

export function mapDsListItemToTask(
  raw: unknown,
  columns?: KanbanColumn[],
  priorities?: KanbanPriorityRef[],
  userIdToName?: Map<number, string>,
  taskTypes?: KanbanTaskTypeRef[],
  componentIdToName?: Map<number, string>,
): KanbanTask | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = Number(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const columnId = resolveBoardStageId(o);

  const title = String(o.name ?? o.title ?? "");

  const { name: priorityRaw, id: resolvedPriorityId } = resolvePriorityNameAndId(o, priorities);
  const priority = normalizePriorityLabel(priorityRaw || "средний");

  const taskTypeId = resolveTaskTypeId(o);
  const apiTypeLabel = resolveTaskTypeLabel(o, taskTypes);
  const types = [canonicalKanbanTaskTypeLabel(apiTypeLabel, taskTypeId)];

  const assignees: string[] = [];
  let usersRaw: unknown = o.users ?? o.assignees;
  if (usersRaw != null && !Array.isArray(usersRaw)) {
    if (typeof usersRaw === "number" || (typeof usersRaw === "string" && /^\d+$/.test(String(usersRaw).trim()))) {
      usersRaw = [usersRaw];
    }
  }
  if (Array.isArray(usersRaw)) {
    for (const u of usersRaw) {
      if (
        (typeof u === "number" || (typeof u === "string" && /^\d+$/.test(String(u).trim()))) &&
        userIdToName &&
        userIdToName.size > 0
      ) {
        const uid = Number(u);
        const n = userIdToName.get(uid);
        if (n) assignees.push(n);
        continue;
      }
      const ur = asRecord(u);
      if (ur) {
        const n = personName(ur);
        if (n) assignees.push(n);
      }
    }
  }
  const resp = asRecord(o.responsible);
  const rn = personName(resp);
  if (rn && !assignees.includes(rn)) assignees.unshift(rn);

  const { epicId, epicFull, epicRefIsParentLink } = resolveEpicFields(o);
  const epic = epicFull.length > 32 ? `${epicFull.slice(0, 29)}…` : epicFull;

  const stageTitle = resolveBoardStageTitle(o, columnId, columns);
  const workflowRaw = mapWorkflowStatusLabel(o);
  const workflowStatus = kanbanCanonicalBoardStatus(workflowRaw) ?? null;
  const statusCanon = kanbanCanonicalBoardStatus(stageTitle);
  const status = statusCanon ?? stageTitle;

  let tracked =
    Number(
      o.total_logged_time ??
        o.time_spent ??
        o.time_tracked ??
        o.logged_time ??
        o.works_sum ??
        0,
    ) || 0;

  if (!tracked && Array.isArray(o.works)) {
    let wsum = 0;
    for (const row of o.works) {
      const wr = asRecord(row);
      if (!wr) continue;
      wsum += Number(wr.time ?? wr.logged_time ?? 0) || 0;
    }
    if (wsum > 0) tracked = wsum;
  }

  if (!tracked && Array.isArray(o.work_detail)) {
    let dsum = 0;
    for (const row of o.work_detail) {
      const wr = asRecord(row);
      if (!wr) continue;
      dsum += Number(wr.time_sum ?? 0) || 0;
    }
    if (dsum > 0) tracked = dsum;
  }

  let commentCount = 0;
  if (Array.isArray(o.comments)) commentCount = o.comments.length;
  else if (typeof o.comments_count === "number") commentCount = o.comments_count;

  let attachmentCount = 0;
  if (Array.isArray(o.files)) attachmentCount = o.files.length;

  const createdAt = String(o.created_at ?? new Date().toISOString());
  const deadline = o.deadline != null ? String(o.deadline) : null;
  const deadlineStatus = parseDeadlineStatus(o);

  const { id: componentId, label: componentLabel } = resolveComponentFields(o, componentIdToName);

  const descriptionRaw = o.description ?? o.task_description ?? o.desc ?? o.text;
  const description =
    descriptionRaw != null && String(descriptionRaw).trim() !== "" ? String(descriptionRaw) : null;

  return {
    id,
    columnId: Number.isFinite(columnId) && columnId > 0 ? columnId : 0,
    title,
    description,
    priority,
    priorityId: resolvedPriorityId,
    types,
    assignees,
    epic,
    epicFull,
    epicId,
    epicRefIsParentLink: epicRefIsParentLink || undefined,
    taskTypeId,
    status: stageTitle,
    workflowStatus,
    componentId,
    componentLabel,
    deadlineStatus,
    trackedMinutes: tracked,
    createdAt,
    deadline,
    commentCount,
    attachmentCount,
  };
}

/**
 * Дочерние задачи эпика из **TaskSingle.epic_by** (ответ GET /task/{epic_id}, helps/v1.json).
 * Элементы — те же сущности, что и в списке доски; маппинг через {@link mapDsListItemToTask}.
 */
export function mapDsEpicByTasksFromDetail(
  detailData: unknown,
  columns?: KanbanColumn[],
  priorities?: KanbanPriorityRef[],
  userIdToName?: Map<number, string>,
  taskTypes?: KanbanTaskTypeRef[],
  componentIdToName?: Map<number, string>,
): KanbanTask[] {
  const o = asRecord(detailData);
  if (!o || !Array.isArray(o.epic_by)) return [];
  const out: KanbanTask[] = [];
  for (const row of o.epic_by) {
    const t = mapDsListItemToTask(row, columns, priorities, userIdToName, taskTypes, componentIdToName);
    if (t) out.push(t);
  }
  return out;
}

export function mapDsComments(rows: unknown): KanbanCommentRow[] {
  if (!Array.isArray(rows)) return [];
  const out: KanbanCommentRow[] = [];
  for (const r of rows) {
    const o = asRecord(r);
    if (!o) continue;
    const id = Number(o.id);
    if (!Number.isFinite(id)) continue;
    const user = asRecord(o.user);
    const author = personName(user) || "—";
    out.push({
      id,
      author,
      text: String(o.content ?? ""),
      createdAt: String(o.created_at ?? ""),
    });
  }
  return out;
}

export function mapDsWorkLogs(rows: unknown, taskUsers?: unknown, memberIdToName?: Map<number, string>): KanbanWorkRow[] {
  if (!Array.isArray(rows)) {
    if (rows && typeof rows === "object" && Array.isArray((rows as { data?: unknown }).data)) {
      return mapDsWorkLogs((rows as { data: unknown[] }).data, taskUsers, memberIdToName);
    }
    return [];
  }
  const out: KanbanWorkRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const o = asRecord(r);
    if (!o) continue;
    let id = Number(o.id);
    if (!Number.isFinite(id) || id <= 0) {
      id = 900_000_000 + i;
    }
    out.push({
      id,
      user: workLogPersonName(o, taskUsers, memberIdToName),
      description: String(o.comment ?? ""),
      minutes: Number(o.time ?? 0) || 0,
      loggedAt: String(o.begin ?? o.created_at ?? ""),
      kanbanUserId: workLogKanbanUserId(o),
    });
  }
  return out;
}

function roleLabelFromWorkDetail(roleRaw: unknown): string {
  const role = asRecord(roleRaw);
  if (!role) return "Роль";
  const kn = asRecord(role.kanban);
  const pl = asRecord(role.pricelist);
  const pricelistName = pl ? String(pl.name ?? "").trim() : "";
  const kanbanName = kn ? String(kn.name ?? "").trim() : "";
  const effective = String(role.name ?? "").trim();
  return pricelistName || kanbanName || effective || "Роль";
}

/** `work_detail` в TaskSingle (DS v1) — агрегаты по ролям (`time_sum`), не записи GET /task/{id}/work. */
export function mapDsWorkDetailRollup(rows: unknown): KanbanWorkRow[] {
  if (!Array.isArray(rows)) return [];
  const out: KanbanWorkRow[] = [];
  let idx = 0;
  for (const r of rows) {
    const o = asRecord(r);
    if (!o) continue;
    const minutes = Number(o.time_sum ?? o.time ?? 0) || 0;
    idx += 1;
    out.push({
      id: 1_000_000 + idx,
      user: roleLabelFromWorkDetail(o.role),
      description: "",
      minutes,
      loggedAt: "—",
    });
  }
  return out;
}

/**
 * Журнал списаний: только **GET /task/{id}/work** (массив `Work` в v1).
 * Не подставлять `work_detail` из TaskSingle — это агрегаты по ролям (подписи вроде «Менеджер»), не построчный журнал.
 */
export function resolveKanbanWorkLogs(
  detailData: unknown,
  workApiRows: unknown,
  memberIdToName?: Map<number, string>,
): KanbanWorkRow[] {
  if (!Array.isArray(workApiRows)) return [];
  const task = asRecord(detailData);
  const users = task?.users;
  return mapDsWorkLogs(workApiRows, users, memberIdToName);
}

export function flattenChecklist(raw: unknown): KanbanChecklistRow[] {
  const task = asRecord(raw);
  if (!task || !Array.isArray(task.checklist)) return [];
  const out: KanbanChecklistRow[] = [];
  for (const group of task.checklist) {
    const g = asRecord(group);
    if (!g || !Array.isArray(g.points)) continue;
    for (const p of g.points) {
      const pt = asRecord(p);
      if (!pt) continue;
      const pointId = Number(pt.id);
      if (!Number.isFinite(pointId)) continue;
      out.push({
        pointId,
        text: String(pt.name ?? pt.text ?? ""),
        done: Boolean(pt.is_done),
      });
    }
  }
  return out;
}

export function mapDsEstimates(raw: unknown): KanbanEstimateRow[] {
  const task = asRecord(raw);
  if (!task || !Array.isArray(task.estimates)) return [];
  const users = Array.isArray(task.users) ? task.users : [];
  const idToName = new Map<number, string>();
  for (const u of users) {
    const ur = asRecord(u);
    const id = Number(ur?.id);
    const n = personName(ur);
    if (id && n) idToName.set(id, n);
  }
  const out: KanbanEstimateRow[] = [];
  let idx = 0;
  for (const e of task.estimates) {
    const er = asRecord(e);
    if (!er) continue;
    const minutes = Number(er.estimate ?? 0) || 0;
    const uid = Number(er.user_id);
    out.push({
      id: Number(er.id) || idx++,
      user: (uid && idToName.get(uid)) || (uid ? `id ${uid}` : "—"),
      role: "Оценка",
      hours: minutes / 60,
    });
  }
  return out;
}

/** `responsible_estimates` в TaskSingle (helps/v1.json, TaskResponsibleEstimate). */
export function mapDsResponsibleEstimates(raw: unknown): KanbanResponsibleEstimateRow[] {
  const task = asRecord(raw);
  if (!task || !Array.isArray(task.responsible_estimates)) return [];
  const users = Array.isArray(task.users) ? task.users : [];
  const idToName = new Map<number, string>();
  for (const u of users) {
    const ur = asRecord(u);
    const id = Number(ur?.id);
    const n = personName(ur);
    if (id && n) idToName.set(id, n);
  }
  const out: KanbanResponsibleEstimateRow[] = [];
  let idx = 0;
  for (const e of task.responsible_estimates) {
    const er = asRecord(e);
    if (!er) continue;
    const minutes = Number(er.estimate ?? 0) || 0;
    const uid = Number(er.user_id);
    const roleRaw = er.role;
    const roleLabel = typeof roleRaw === "object" && roleRaw != null ? roleLabelFromWorkDetail(roleRaw) : "—";
    const id = Number(er.id);
    out.push({
      id: Number.isFinite(id) && id > 0 ? id : idx++,
      user: (uid && idToName.get(uid)) || (uid ? `#${uid}` : "—"),
      role: roleLabel,
      minutes,
      hours: minutes / 60,
      description: er.description != null && String(er.description).trim() ? String(er.description).trim() : null,
      createdAt: String(er.created_at ?? "").trim(),
      isActual: Boolean(er.is_actual),
      isReestimate: Boolean(er.is_reestimate),
    });
  }
  return out;
}

/** Одна строка изменения в `TaskSingle.history` (helps/v1.json). */
export type KanbanTaskHistoryChangeRow = {
  type: string;
  old: string;
  new: string;
  /** Доп. пояснения (old_description, responsible_estimate_user и т.п.) */
  details: string[];
};

export type KanbanTaskHistoryEntry = {
  updatedAt: string;
  updatedById: number | null;
  changes: KanbanTaskHistoryChangeRow[];
};

function historyEstimateUserLine(u: Record<string, unknown>): string {
  const id = Number(u.id);
  const name = String(u.name ?? "").trim();
  if (name) return name;
  if (Number.isFinite(id) && id > 0) return `#${id}`;
  return "";
}

/** Разбор `history` из ответа GET /task/{id} (TaskSingle). */
export function parseKanbanTaskHistory(payload: unknown): KanbanTaskHistoryEntry[] {
  const root = asRecord(payload);
  if (!root) return [];
  const h = root.history;
  if (!Array.isArray(h)) return [];

  const out: KanbanTaskHistoryEntry[] = [];
  for (const row of h) {
    const r = asRecord(row);
    if (!r) continue;
    const updatedAt = String(r.updated_at ?? "").trim() || "—";
    const uidRaw = r.updated_by_id;
    let updatedById: number | null = null;
    if (uidRaw !== null && uidRaw !== undefined && uidRaw !== "") {
      const n = Number(uidRaw);
      if (Number.isFinite(n) && n > 0) updatedById = n;
    }

    const changes: KanbanTaskHistoryChangeRow[] = [];
    if (Array.isArray(r.changes)) {
      for (const c of r.changes) {
        const cr = asRecord(c);
        if (!cr) continue;
        const type = String(cr.type ?? "—").trim() || "—";
        const old = String(cr.old ?? "").trim();
        const new_ = String(cr.new ?? "").trim();
        const details: string[] = [];
        const od = cr.old_description;
        if (od != null && String(od).trim()) {
          const s = String(od).trim();
          details.push(s.length > 200 ? `${s.slice(0, 197)}…` : s);
        }
        const reu = asRecord(cr.responsible_estimate_user);
        if (reu) {
          const line = historyEstimateUserLine(reu);
          if (line) details.push(`Оценка исполнителя: ${line}`);
        }
        changes.push({ type, old, new: new_, details });
      }
    }
    out.push({ updatedAt, updatedById, changes });
  }

  const ts = (s: string) => {
    if (s === "—") return 0;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  };
  out.sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
  return out;
}

export function mapDetailToBoardTask(
  detail: unknown,
  fallback: KanbanTask,
  columns?: KanbanColumn[],
  priorities?: KanbanPriorityRef[],
  userIdToName?: Map<number, string>,
  taskTypes?: KanbanTaskTypeRef[],
  componentIdToName?: Map<number, string>,
): KanbanTask {
  const mapped = mapDsListItemToTask(detail, columns, priorities, userIdToName, taskTypes, componentIdToName);
  return mapped ?? fallback;
}
