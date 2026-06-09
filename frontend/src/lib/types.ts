/**
 * DTOs returned by the FastAPI backend.
 *
 * Kept loose-typed where the backend uses Python enums whose string values
 * may evolve; the frontend defensively copies fields and falls back to
 * sensible defaults in the mappers.
 */

export type BackendUserRole = "admin" | "coordinator" | "manager" | "expert" | "employee";

export interface ApiUser {
  id: number;
  username: string;
  role: BackendUserRole;
  workspace?: string;
  telegram_id?: string | null;
  telegram_notifications?: boolean;
  is_approved: boolean;
  matrix_id?: string | null;
  matrix_dm_enabled?: boolean;
  matrix_dm_room_id?: string | null;
  direction?: string | null;
  project_ids?: number[];
  created_at?: string;
  last_login_at?: string | null;
}

export type PersonalChannelMode = "in_app_only" | "matrix_preferred" | "telegram_preferred" | "both";

export interface ApiMe extends ApiUser {
  kanban_connected: boolean;
  personal_channel_mode?: PersonalChannelMode;
}

export interface ApiProject {
  id: number;
  name: string;
  config_json: Record<string, unknown>;
}

export type TicketStatus =
  | "pending_approval"
  | "forwarded"
  | "cancelled"
  | "returned"
  | "answered"
  | "closed";

export type TicketPriority = "critical" | "high" | "medium" | "low";

export interface ApiAttachment {
  id: number;
  name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
}

export interface ApiMentionUser {
  id: number;
  username: string;
}

export interface ApiMessage {
  id: number;
  ticket_id: number;
  author_id: number | null;
  author_username: string | null;
  body: string;
  kind: "message" | "response" | "clarification" | string;
  created_at: string;
  edited_at: string | null;
}

export interface ApiTicketEvent {
  id: number;
  ticket_id: number;
  actor_id: number | null;
  actor_username: string | null;
  kind: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_at: string;
}

export interface ApiTicket {
  id: number;
  project_id: number;
  epic_id: number | null;
  status: TicketStatus;
  title: string | null;
  description: string | null;
  priority: TicketPriority | null;
  sla_hours: number | null;
  due_at: string | null;
  author_id: number | null;
  author_username: string | null;
  assignee_id: number | null;
  assignee_username: string | null;
  origin_event_id: string;
  expert_event_id: string | null;
  data_json: Record<string, unknown>;
  messages: ApiMessage[];
  attachments: ApiAttachment[];
  events: ApiTicketEvent[];
  created_at: string;
  updated_at: string;
  /** Целевые статусы, доступные текущему пользователю (из GET /tickets/:id). */
  allowed_target_statuses?: TicketStatus[] | null;
  is_subscribed?: boolean;
  /** Можно ли взять вопрос на себя (POST /tickets/:id/claim-assignee). */
  can_claim_assignee?: boolean;
}

export interface ApiTicketPage {
  items: ApiTicket[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApiPage<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApiDashboardSummary {
  total_count: number;
  status_counts: Record<string, number>;
  priority_counts: Record<string, number>;
  direction_counts: Record<string, number>;
  project_counts: Record<string, number>;
  source_counts: Record<string, number>;
  overdue_count: number;
}

export interface ApiNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  target_type: string;
  target_id: number;
  target_url: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  lifecycle_status?: string;
  severity?: string;
  urgency?: string;
  correlation_id?: string | null;
  project_id?: number | null;
  muted?: boolean;
  snooze_until?: string | null;
}

export type ApiNotificationPage = ApiPage<ApiNotification>;

export interface ApiDeliveryHealth {
  matrix_dm_enabled: boolean;
  matrix_id_configured: boolean;
  telegram_notifications_enabled: boolean;
  telegram_configured: boolean;
  issues: string[];
}

export type EpicStatus = "new" | "in-progress" | "released";
export type EpicQAStatus =
  | "draft"
  | "in_testing"
  | "blocked"
  | "test_complete"
  | "stage_complete"
  | "prod_complete"
  | "closed";
export type EpicTestStage = "test" | "stage" | "prod";
export type TestRunStatus = "planned" | "running" | "passed" | "failed" | "skipped";

export interface ApiEpicTestPlanItem {
  id: string;
  title: string;
  description_markdown: string;
  is_checked: boolean;
  comment: string;
}

export interface ApiEpicQA {
  id: number;
  epic_id: number;
  status: EpicQAStatus;
  active_test_stage: EpicTestStage;
  test_plan_items: ApiEpicTestPlanItem[];
  test_run_test_url: string | null;
  test_run_stage_url: string | null;
  test_run_prod_url: string | null;
  risks: string | null;
  blockers: string | null;
  known_limitations: string | null;
  verdict: string | null;
  reviewer_comments: string | null;
  last_reviewer_id: number | null;
  updated_at: string;
}

export interface ApiEpicAudit {
  id: number;
  epic_id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  old_status: string | null;
  new_status: string | null;
  comment: string | null;
  details_json: Record<string, unknown> | null;
  created_at: string;
}

export interface ApiEpicComment {
  id: number;
  epic_id: number | null;
  project_slug: string | null;
  kanban_epic_id: number | null;
  user_id: number | null;
  username: string | null;
  body: string;
  created_at: string;
}

export interface ApiEpicBlocker {
  id: number;
  epic_id: number;
  reporter_id: number | null;
  reporter_username: string | null;
  body: string;
  resolved_at: string | null;
  created_at: string;
}

export interface ApiEpicTestRun {
  id: number;
  epic_id: number;
  environment: EpicTestStage;
  status: TestRunStatus;
  url: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ApiEpic {
  id: number;
  project_id: number;
  project_name: string | null;
  title: string;
  status: EpicStatus;
  jira_url: string;
  confluence_url: string;
  kanban_url: string | null;
  design_url: string | null;
  notes: string | null;
  qa_estimate_hours: number | null;
  qa_member_ids: number[];
  spent_total_hours: number | null;
  spent_qa_hours: number | null;
  spent_synced_at: string | null;
  spent_sync_error: string | null;
  lead_analyst_id: number | null;
  lead_designer_id: number | null;
  expert_id: number | null;
  start_date: string | null;
  target_date: string | null;
  open_questions_count: number;
  created_at: string;
  updated_at: string;
  qa_block: ApiEpicQA | null;
  comments: ApiEpicComment[];
  history: ApiEpicAudit[];
  blockers: ApiEpicBlocker[];
  test_runs: ApiEpicTestRun[];
}

export type ApiEpicPage = ApiPage<ApiEpic>;

export interface ApiActivityEvent {
  id: string;
  type: string;
  user_id: number | null;
  username: string | null;
  action: string;
  target_id: number;
  target_type: "question" | "epic" | string;
  target_title: string;
  project_id: number | null;
  date: string;
}

export type ApiActivityPage = ApiPage<ApiActivityEvent>;

export interface ApiRoleSummaryWidget {
  id: string;
  title: string;
  value: number;
  description?: string | null;
  metric?: string | null;
}

export interface ApiRoleSummary {
  role: BackendUserRole;
  widgets: ApiRoleSummaryWidget[];
  overdue_questions: ApiTicket[];
  blocked_epics: ApiEpic[];
  my_questions: ApiTicket[];
  my_epics: ApiEpic[];
}

export interface ApiReferenceOption {
  value: string;
  label: string;
}

export interface ApiReferenceData {
  roles: ApiReferenceOption[];
  role_directions: Record<string, ApiReferenceOption[]>;
  question_statuses: ApiReferenceOption[];
  question_priorities: ApiReferenceOption[];
  epic_statuses: ApiReferenceOption[];
  qa_statuses: ApiReferenceOption[];
  qa_status_transitions: Record<string, ApiReferenceOption[]>;
  test_run_environments: ApiReferenceOption[];
  test_run_statuses: ApiReferenceOption[];
  matrix_directions: ApiReferenceOption[];
  digest_statuses: ApiReferenceOption[];
}

export interface ApiDashboardAggregate {
  role: BackendUserRole;
  persona: string;
  totals: {
    questions_total: number;
    questions_open: number;
    active_epics: number;
    blocked_epics: number;
    users_total: number;
  };
  status_counts: Record<string, number>;
  role_counts: Record<string, number>;
  stale_questions: { id: number; title: string; updated_at: string; hours_stale: number }[];
}

export interface ApiProfileStats {
  authored_total: number;
  authored_closed: number;
  assigned_open: number;
  question_heatmap?: { date: string; count: number }[];
}

export interface ApiStatisticsSummary {
  questions_total: number;
  questions_open: number;
  questions_closed: number;
  long_stagnant_open: number;
  active_epics: number;
  blocked_epics: number;
  avg_response_hours: number | null;
  median_response_hours: number | null;
  avg_thread_messages: number | null;
  with_team_reply: number;
  priority_counts: Record<string, number>;
  question_status_counts: Record<string, number>;
  epic_qa_status_counts: Record<string, number>;
  epic_status_counts: Record<string, number>;
  test_coverage: { total: number; done: number; pct: number | null };
}
