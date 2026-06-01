/**
 * Convert backend DTOs (snake_case ints) into the reference UI's domain shapes
 * (PascalCase strings, Russian role labels). We keep all reference-shaped types
 * here so the pages can keep their existing imports from `@/data/*`.
 */
import type {
  ApiActivityEvent,
  ApiEpic,
  ApiNotification,
  ApiProject,
  ApiTicket,
  ApiUser,
  BackendUserRole,
  TicketPriority,
  TicketStatus,
} from "./types";

export type RefRole = "Координатор" | "Эксперт" | "Разработчик" | "Админ";

export interface RefUser {
  id: string;
  name: string;
  email: string;
  role: RefRole;
  avatarInitials: string;
  projectIds: string[];
  isActive: boolean;
  lastActive: string | null;
}

export type RefQuestionStatus = "На проверке" | "У эксперта" | "На уточнении" | "Ожидает автора" | "Закрыт" | "Отменён";
export type RefPriority = "Критический" | "Высокий" | "Средний" | "Низкий";

export interface RefThreadMessage {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface RefAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  url: string;
  mimeType: string;
}

export interface RefQuestion {
  id: string;
  title: string;
  description: string;
  authorId: string;
  projectId: string;
  epicId?: string;
  status: RefQuestionStatus;
  priority: RefPriority;
  assigneeId: string;
  createdAt: string;
  updatedAt: string;
  slaHours: number;
  thread: RefThreadMessage[];
  attachments: RefAttachment[];
}

export interface RefProject {
  id: string;
  name: string;
  description: string;
  activeEpicsCount: number;
  openQuestionsCount: number;
  teamMemberIds: string[];
  status: "Активен" | "Архив";
}

export type RefEpicStatus = "Новый" | "В работе" | "Выпущен";
export type RefQAStatus =
  | "Подготовка тест-плана"
  | "В тестировании"
  | "Заблокировано"
  | "TEST complete"
  | "STAGE complete"
  | "PROD complete"
  | "Закрыто";

export type RefEnvironment = "TEST" | "STAGE" | "PROD";

export interface RefEpic {
  id: string;
  name: string;
  description: string;
  projectId: string;
  epicStatus: RefEpicStatus;
  qaStatus: RefQAStatus;
  activeEnvironment: RefEnvironment | null;
  testCasesTotal: number;
  testCasesCompleted: number;
  blockers: { id: string; text: string; reportedBy: string }[];
  leadAnalystId: string;
  leadDesignerId: string;
  jiraLink: string;
  kanbanLink: string;
  designLink: string;
  startDate: string;
  targetDate: string;
  qaTimeEstimate: number;
  qaTimeSpent: number;
  openQuestionsCount: number;
  testRuns: { id: string; env: string; status: string; date: string; link: string }[];
  checklist: { area: string; items: { id: string; text: string; checked: boolean }[] }[];
  comments: { id: string; authorId: string; text: string; createdAt: string }[];
  history: { id: string; userId: string; action: string; date: string }[];
}

export interface RefNotification {
  id: string;
  type:
    | "статус изменён"
    | "новый вопрос"
    | "передан эксперту"
    | "получен ответ"
    | "на уточнение"
    | "упоминание"
    | "блокер добавлен"
    | "вопрос: сообщение"
    | "вопрос: статус"
    | "Вопрос долго без движения"
    | "напоминание"
    | "Kanban: новая задача";
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  targetType: "question" | "epic" | "kanban";
  targetId: string;
  /** Абсолютный URL (Kanban web) — если задан, клик по уведомлению открывает его, а не SPA-маршрут. */
  targetUrl?: string | null;
  severity?: string;
  urgency?: string;
  lifecycleStatus?: string;
}

export interface RefActivityEvent {
  id: string;
  type: "question" | "epic" | "status" | "comment" | "blocker";
  userId: string;
  action: string;
  targetTitle: string;
  targetId: string;
  targetType: "question" | "epic";
  date: string;
}

const ROLE_MAP: Record<BackendUserRole, RefRole> = {
  admin: "Админ",
  coordinator: "Координатор",
  manager: "Координатор",
  expert: "Эксперт",
  employee: "Разработчик",
};

/** Совпадает с backend/app/expert_utils.EXPERT_DIRECTIONS — лиды аналитики и дизайна работают как эксперты по вопросам. */
const DOMAIN_EXPERT_DIRECTIONS = new Set(["analytics", "design"]);

/** Роли, которые можно выставить при создании пользователя (есть в UserRole на бэкенде). */
export const ADMIN_EDITABLE_ROLES: BackendUserRole[] = ["admin", "coordinator", "expert", "employee"];

export const BACKEND_ROLE_LABEL: Record<BackendUserRole, string> = {
  admin: "Админ",
  coordinator: "Координатор",
  manager: "Координатор",
  expert: "Эксперт",
  employee: "Разработчик",
};

export function isCoordinatorRole(role: BackendUserRole | string | null | undefined): boolean {
  return role === "coordinator" || role === "manager";
}

const PRIORITY_MAP: Record<TicketPriority, RefPriority> = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const STATUS_MAP: Record<TicketStatus, RefQuestionStatus> = {
  pending_approval: "На проверке",
  forwarded: "У эксперта",
  returned: "На уточнении",
  answered: "Ожидает автора",
  closed: "Закрыт",
  cancelled: "Отменён",
};

export function ticketStatusToRefQuestion(ts: TicketStatus): RefQuestionStatus {
  return STATUS_MAP[ts];
}

export const PRIORITY_FROM_REF: Record<RefPriority, TicketPriority> = {
  Критический: "critical",
  Высокий: "high",
  Средний: "medium",
  Низкий: "low",
};

export const STATUS_FROM_REF: Record<RefQuestionStatus, TicketStatus> = {
  "На проверке": "pending_approval",
  "У эксперта": "forwarded",
  "На уточнении": "returned",
  "Ожидает автора": "answered",
  Закрыт: "closed",
  Отменён: "cancelled",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join("");
}

export function userIdToRef(id: number): string {
  return `U-${String(id).padStart(3, "0")}`;
}

export function projectIdToRef(id: number): string {
  return `PRJ-${id}`;
}

export function ticketIdToRef(id: number): string {
  return `Q-${String(id).padStart(3, "0")}`;
}

export function epicIdToRef(id: number): string {
  return `EP-${String(id).padStart(3, "0")}`;
}

export function refIdToNumeric(id: string): number | null {
  const match = id.match(/(\d+)$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function mapApiUserToRefUser(user: ApiUser): RefUser {
  let role = ROLE_MAP[user.role] ?? "Разработчик";
  if (user.role === "employee" && user.direction && DOMAIN_EXPERT_DIRECTIONS.has(user.direction)) {
    role = "Эксперт";
  }
  return {
    id: userIdToRef(user.id),
    name: user.username,
    email: user.username + "@resonance.local",
    role,
    avatarInitials: initials(user.username),
    projectIds: (user.project_ids ?? []).map(projectIdToRef),
    isActive: user.is_approved,
    lastActive: user.last_login_at ?? null,
  };
}

export function mapApiProjectToRefProject(project: ApiProject): RefProject {
  const config = project.config_json ?? {};
  const teamIds = Array.isArray((config as { user_ids?: number[] }).user_ids)
    ? (config as { user_ids?: number[] }).user_ids ?? []
    : [];
  return {
    id: projectIdToRef(project.id),
    name: project.name,
    description:
      typeof (config as { description?: string }).description === "string"
        ? ((config as { description?: string }).description as string)
        : "",
    activeEpicsCount: 0,
    openQuestionsCount: 0,
    teamMemberIds: teamIds.map(userIdToRef),
    status: "Активен",
  };
}

export function mapApiTicketToRefQuestion(ticket: ApiTicket): RefQuestion {
  const data = ticket.data_json ?? {};
  const description = ticket.description ?? (typeof data.content === "string" ? data.content : "");
  const priority = (ticket.priority ?? "medium") as TicketPriority;

  const thread: RefThreadMessage[] = (ticket.messages ?? []).map((m) => ({
    id: `M-${m.id}`,
    authorId: m.author_id ? userIdToRef(m.author_id) : "U-000",
    text: m.body,
    createdAt: m.created_at,
  }));

  const attachments: RefAttachment[] = (ticket.attachments ?? []).map((a) => {
    const mime = (a.mime_type ?? "application/octet-stream").trim();
    const subtype = mime.includes("/") ? (mime.split("/")[1] ?? "").split(";")[0].trim().toLowerCase() : mime.toLowerCase();
    return {
      id: `A-${a.id}`,
      name: a.name,
      size: humanFileSize(a.size_bytes),
      type: subtype || mime.toLowerCase(),
      url: a.url,
      mimeType: mime,
    };
  });

  return {
    id: ticketIdToRef(ticket.id),
    title: ticket.title ?? (typeof data.title === "string" ? data.title : "(без заголовка)"),
    description,
    authorId: ticket.author_id ? userIdToRef(ticket.author_id) : "U-000",
    projectId: projectIdToRef(ticket.project_id),
    epicId: ticket.epic_id ? epicIdToRef(ticket.epic_id) : undefined,
    status: STATUS_MAP[ticket.status] ?? "На проверке",
    priority: PRIORITY_MAP[priority] ?? "Средний",
    assigneeId: ticket.assignee_id ? userIdToRef(ticket.assignee_id) : ticket.author_id ? userIdToRef(ticket.author_id) : "U-000",
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    slaHours: ticket.sla_hours ?? 0,
    thread,
    attachments,
  };
}

const QA_STATUS_MAP: Record<string, RefQAStatus> = {
  draft: "Подготовка тест-плана",
  in_testing: "В тестировании",
  blocked: "Заблокировано",
  test_complete: "TEST complete",
  stage_complete: "STAGE complete",
  prod_complete: "PROD complete",
  closed: "Закрыто",
};

export const QA_STATUS_FROM_REF: Record<RefQAStatus, "draft" | "in_testing" | "blocked" | "test_complete" | "stage_complete" | "prod_complete" | "closed"> = {
  "Подготовка тест-плана": "draft",
  "В тестировании": "in_testing",
  Заблокировано: "blocked",
  "TEST complete": "test_complete",
  "STAGE complete": "stage_complete",
  "PROD complete": "prod_complete",
  Закрыто: "closed",
};

const EPIC_STATUS_MAP: Record<string, RefEpicStatus> = {
  new: "Новый",
  "in-progress": "В работе",
  released: "Выпущен",
};

export function mapApiEpicToRefEpic(epic: ApiEpic): RefEpic {
  const totalItems = epic.qa_block?.test_plan_items.length ?? 0;
  const checked = epic.qa_block?.test_plan_items.filter((i) => i.is_checked).length ?? 0;
  return {
    id: epicIdToRef(epic.id),
    name: epic.title,
    description: epic.notes ?? "",
    projectId: projectIdToRef(epic.project_id),
    epicStatus: EPIC_STATUS_MAP[epic.status] ?? "Новый",
    qaStatus: QA_STATUS_MAP[epic.qa_block?.status ?? "draft"] ?? "Подготовка тест-плана",
    activeEnvironment: (epic.qa_block?.active_test_stage?.toUpperCase() as RefEnvironment | undefined) ?? null,
    testCasesTotal: totalItems,
    testCasesCompleted: checked,
    blockers: (epic.blockers ?? []).map((b) => ({
      id: `B-${b.id}`,
      text: b.body,
      reportedBy: b.reporter_id ? userIdToRef(b.reporter_id) : "U-000",
    })),
    leadAnalystId: epic.lead_analyst_id ? userIdToRef(epic.lead_analyst_id) : "U-000",
    leadDesignerId: epic.lead_designer_id ? userIdToRef(epic.lead_designer_id) : "U-000",
    jiraLink: epic.jira_url,
    kanbanLink: epic.kanban_url ?? "#",
    designLink: epic.design_url ?? "#",
    startDate:
      epic.start_date != null && epic.start_date !== ""
        ? epic.start_date.slice(0, 10)
        : (epic.created_at ?? "").slice(0, 10),
    targetDate:
      epic.target_date != null && epic.target_date !== ""
        ? epic.target_date.slice(0, 10)
        : (epic.updated_at ?? "").slice(0, 10),
    qaTimeEstimate: epic.qa_estimate_hours ?? 0,
    qaTimeSpent: epic.spent_qa_hours ?? 0,
    openQuestionsCount: epic.open_questions_count,
    testRuns: (epic.test_runs ?? []).map((r) => ({
      id: `TR-${r.id}`,
      env: r.environment.toUpperCase(),
      status: r.status,
      date: (r.created_at ?? "").slice(0, 10),
      link: r.url ?? "#",
    })),
    checklist: epic.qa_block?.test_plan_items?.length
      ? [
          {
            area: "Тест-план",
            items: epic.qa_block.test_plan_items.map((item) => ({
              id: item.id,
              text: item.title,
              checked: item.is_checked,
            })),
          },
        ]
      : [],
    comments: (epic.comments ?? []).map((c) => ({
      id: `CM-${c.id}`,
      authorId: c.user_id ? userIdToRef(c.user_id) : "U-000",
      text: c.body,
      createdAt: c.created_at,
    })),
    history: (epic.history ?? []).map((h) => ({
      id: `H-${h.id}`,
      userId: h.user_id ? userIdToRef(h.user_id) : "U-000",
      action: humaniseAuditAction(h.action, h.new_status),
      date: h.created_at,
    })),
  };
}

export function mapApiNotificationToRef(notification: ApiNotification): RefNotification {
  if (notification.target_type === "kanban_task") {
    return {
      id: `N-${notification.id}`,
      type: "Kanban: новая задача",
      title: notification.title,
      body: notification.body || notification.title,
      isRead: notification.is_read,
      createdAt: notification.created_at,
      targetType: "kanban",
      targetId: String(notification.target_id),
      targetUrl: notification.target_url || null,
      severity: notification.severity,
      urgency: notification.urgency,
      lifecycleStatus: notification.lifecycle_status,
    };
  }

  const targetType = notification.target_type === "epic" ? "epic" : "question";
  const targetId = notification.target_type === "epic"
    ? epicIdToRef(notification.target_id)
    : ticketIdToRef(notification.target_id);
  const refType: RefNotification["type"] =
    notification.type === "ticket_created"
      ? "новый вопрос"
      : notification.type === "ticket_forwarded"
        ? "передан эксперту"
        : notification.type === "ticket_answered"
          ? "получен ответ"
          : notification.type === "ticket_returned"
            ? "на уточнение"
            : notification.type === "ticket_mentioned"
              ? "упоминание"
              : notification.type === "ticket_watch_message"
                ? "вопрос: сообщение"
                : notification.type === "ticket_watch_status"
                  ? "вопрос: статус"
                  : notification.type === "ticket_sla_stagnation"
                    ? "Вопрос долго без движения"
                    : notification.type === "reminder_unread"
                      ? "напоминание"
                      : notification.type.includes("blocker")
                        ? "блокер добавлен"
                        : "статус изменён";
  return {
    id: `N-${notification.id}`,
    type: refType,
    title: notification.title,
    body: notification.body || notification.title,
    isRead: notification.is_read,
    createdAt: notification.created_at,
    targetType,
    targetId,
    targetUrl: notification.target_url || null,
    severity: notification.severity,
    urgency: notification.urgency,
    lifecycleStatus: notification.lifecycle_status,
  };
}

export function mapActivity(event: ApiActivityEvent): RefActivityEvent {
  const refTargetId = event.target_type === "epic"
    ? epicIdToRef(event.target_id)
    : ticketIdToRef(event.target_id);
  const refType: RefActivityEvent["type"] =
    event.type === "question"
      ? "question"
      : event.type === "epic"
        ? "epic"
        : event.type === "status"
          ? "status"
          : event.type === "comment"
            ? "comment"
            : "blocker";
  return {
    id: event.id,
    type: refType,
    userId: event.user_id ? userIdToRef(event.user_id) : "U-000",
    action: event.action,
    targetTitle: event.target_title,
    targetId: refTargetId,
    targetType: event.target_type === "epic" ? "epic" : "question",
    date: event.date,
  };
}

function humanFileSize(bytes: number): string {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function humaniseAuditAction(action: string, newStatus: string | null): string {
  const human: Record<string, string> = {
    created: "Создал эпик",
    epic_updated: "Обновил эпик",
    qa_status_changed: `Перевёл QA в ${newStatus ?? ""}`.trim(),
    qa_updated: "Обновил QA-блок",
    comment_added: "Добавил комментарий",
    blocker_added: "Добавил блокер",
    blocker_resolved: "Снял блокер",
    blocker_updated: "Обновил блокер",
    test_run_added: "Добавил тест-ран",
    test_run_updated: "Обновил тест-ран",
    spent_time_synced: "Синхронизировал часы",
  };
  return human[action] ?? action;
}
