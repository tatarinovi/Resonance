/**
 * React Query hooks talking directly to the FastAPI backend.
 * These return the backend DTO shapes; mappers in `mappers.ts` adapt them
 * to the reference UI's `Question` / `Epic` shapes.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { bumpDataVersion } from "@/data/_bridge";
import { api } from "./api";
import type {
  ApiActivityEvent,
  ApiActivityPage,
  ApiAttachment,
  ApiDashboardSummary,
  ApiDashboardAggregate,
  ApiEpic,
  ApiEpicBlocker,
  ApiEpicPage,
  ApiEpicTestRun,
  ApiMe,
  ApiMentionUser,
  ApiMessage,
  ApiDeliveryHealth,
  ApiNotification,
  ApiNotificationPage,
  ApiPage,
  ApiProfileStats,
  ApiProject,
  ApiReferenceData,
  ApiRoleSummary,
  ApiStatisticsSummary,
  ApiTicket,
  ApiTicketPage,
  ApiUser,
  BackendUserRole,
  EpicQAStatus,
  EpicTestStage,
  TestRunStatus,
  TicketPriority,
  TicketStatus,
} from "./types";

export const queryKeys = {
  me: ["me"] as const,
  users: ["users"] as const,
  projects: ["projects"] as const,
  mentionUsers: (projectId: number) => ["mention-users", projectId] as const,
  experts: (projectId?: number) => ["experts", projectId ?? null] as const,
  directoryUsers: ["directory-users"] as const,
  tickets: (params?: Record<string, unknown>) => ["tickets", params ?? {}] as const,
  ticket: (id: number) => ["ticket", id] as const,
  ticketReassignCandidates: (id: number) => ["ticket-reassign-candidates", id] as const,
  ticketSummary: (params?: Record<string, unknown>) => ["ticket-summary", params ?? {}] as const,
  epics: (params?: Record<string, unknown>) => ["epics", params ?? {}] as const,
  epic: (id: number) => ["epic", id] as const,
  epicHistory: (id: number) => ["epic-history", id] as const,
  epicBlockers: (id: number) => ["epic-blockers", id] as const,
  epicTestRuns: (id: number) => ["epic-test-runs", id] as const,
  notifications: ["notifications"] as const,
  activity: (params?: Record<string, unknown>) => ["activity", params ?? {}] as const,
  roleSummary: ["role-summary"] as const,
  reference: ["reference"] as const,
  dashboardAggregate: (persona?: string | null) => ["dashboard-summary", persona ?? null] as const,
  profileStats: ["profile-stats"] as const,
  statisticsSummary: (params?: Record<string, unknown>) => ["statistics-summary", params ?? {}] as const,
};

/** Refetch list queries backing `DataBridge` → `@/data/*`, then nudge `useDataBridgeVersion` subscribers. */
async function refetchDataBridgeRoots(qc: QueryClient, roots: readonly string[]): Promise<void> {
  await Promise.all(
    roots.flatMap((root) =>
      root === "users"
        ? [
            qc.refetchQueries({ queryKey: queryKeys.users }),
            qc.refetchQueries({ queryKey: queryKeys.directoryUsers }),
          ]
        : [qc.refetchQueries({ queryKey: [root] })]),
  );
  bumpDataVersion();
}

// --- Auth & me ---

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<ApiMe>("/auth/me"),
    retry: false,
    staleTime: 30_000,
  });
}

export function useReferenceData() {
  return useQuery({
    queryKey: queryKeys.reference,
    queryFn: () => api.get<ApiReferenceData>("/reference"),
    staleTime: 5 * 60_000,
  });
}

/** Fields accepted by PUT /auth/me (includes password change, not part of ApiMe). */
export type UpdateMeRequest = Partial<
  Pick<ApiMe, "telegram_notifications" | "matrix_dm_enabled" | "personal_channel_mode">
> & {
  telegram_id?: string | null;
  matrix_id?: string | null;
  matrix_dm_room_id?: string | null;
  kanban_token?: string | null;
  current_password?: string;
  new_password?: string;
};

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) => api.put<ApiMe>("/auth/me", body),
    onSuccess: (data) => qc.setQueryData(queryKeys.me, data),
  });
}

export function useKanbanConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<ApiMe>("/auth/kanban-connect", body),
    onSuccess: (data) => qc.setQueryData(queryKeys.me, data),
  });
}

export function useKanbanProjects(enabled = true) {
  return useQuery({
    queryKey: ["kanban-projects"] as const,
    queryFn: () => api.get<{ id: number | null; slug: string; name: string }[]>("/kanban/projects"),
    staleTime: 60_000,
    enabled,
  });
}

export type KanbanAnalyticsBootstrap = {
  current_user: { id: number | null; name: string | null } | null;
  projects: { id: number | null; slug: string; name: string }[];
  stages: { id: number; name: string }[];
  kanban_web_base_url: string;
  snapshot_ready: boolean;
  snapshot_updated_at: string | null;
  refresh_state?: {
    status: "idle" | "running" | "success" | "failed";
    started_at: string | null;
    finished_at: string | null;
    started_by?: { source?: string; id?: number; username?: string } | null;
    error?: string | null;
    updated_at?: string | null;
  };
};

export function useKanbanAnalyticsBootstrap(enabled = true, pollRefreshState = false) {
  return useQuery({
    queryKey: ["kanban-analytics", "bootstrap"] as const,
    queryFn: () => api.get<KanbanAnalyticsBootstrap>("/analytics/kanban/bootstrap"),
    staleTime: 30_000,
    refetchInterval: pollRefreshState ? 5_000 : false,
    enabled,
  });
}

export function useKanbanAnalyticsRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ updated_at: string; projects: number; epics: number; tasks: number }>("/analytics/kanban/refresh"),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["kanban-analytics"] });
    },
  });
}

export type KanbanAnalyticsListSummary = { total: number; projects: number; mine?: boolean; over_estimate?: number };

export type KanbanAnalyticsEpicListItem = {
  id: number;
  name: string;
  project: { id: number | null; slug: string; name: string };
  stage: { id: number; name: string };
  deadline?: string | null;
  url?: string;
  local_meta?: {
    resonance_epic_id?: number;
    resonance_epic_title?: string;
    resonance_project_id?: number;
    qa_estimate_hours?: number | null;
    spent_total_hours?: number | null;
    spent_qa_hours?: number | null;
    qa_member_ids?: number[];
    qa_status?: string | null;
    qa_fact_hours?: number | null;
    tracked_hours?: number | null;
    /** Этап из блока QA локального эпика Resonance (`EpicQA.active_test_stage`). */
    active_test_stage?: string | null;
  };
  /** Сводка по задачам эпика в Kanban (из снимка, те же правила, что на странице детализации). */
  task_summary?: { total: number; in_progress: number; completed: number };
};

export function useKanbanAnalyticsEpics(params: { project_slugs?: string; status_ids?: string; search?: string; page?: number; page_size?: number }, enabled = true) {
  return useQuery({
    queryKey: ["kanban-analytics", "epics", params] as const,
    queryFn: () => api.get<ApiPage<KanbanAnalyticsEpicListItem> & { summary: KanbanAnalyticsListSummary }>("/analytics/kanban/epics", { query: params }),
    staleTime: 30_000,
    enabled,
    placeholderData: (previous) => previous,
  });
}

export type KanbanAnalyticsTaskListItem = {
  id: number;
  name: string;
  project: { id: number | null; slug: string; name: string };
  stage: { id: number; name: string };
  deadline?: string | null;
  assignees?: string[];
  tracked_hours?: number;
  url?: string;
  member_ids?: number[];
  responsible_id?: number | null;
  created_by?: number | null;
  user_id?: number | null;
};

export function useKanbanAnalyticsTasks(
  params: { project_slugs?: string; status_ids?: string; search?: string; only_mine?: boolean; page?: number; page_size?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ["kanban-analytics", "tasks", params] as const,
    queryFn: () => api.get<ApiPage<KanbanAnalyticsTaskListItem> & { summary: KanbanAnalyticsListSummary }>("/analytics/kanban/tasks", { query: params }),
    staleTime: 30_000,
    enabled,
    placeholderData: (previous) => previous,
  });
}

export type KanbanDailySummaryWorklog = {
  task_id: number;
  task_name: string;
  task_url?: string;
  task_type_id?: number | null;
  task_type_name?: string;
  member_role?: KanbanMemberProjectRole;
  user_name: string;
  kanban_user_id?: number | null;
  minutes: number;
  hours: number;
  comment: string;
  begin: string;
};

export type KanbanDailySummaryTaskRef = {
  id: number;
  name: string;
  project?: { id: number | null; slug: string; name: string };
  stage?: { id: number; name: string };
  deadline?: string | null;
  url?: string;
};

export type KanbanDailySummaryTaskNode = {
  task: KanbanDailySummaryTaskRef;
  worklogs: KanbanDailySummaryWorklog[];
  total_minutes: number;
  total_hours: number;
};

export type KanbanDailySummaryEpicRef = {
  id: number;
  name: string;
  project: { id: number | null; slug: string; name: string };
  stage?: { id: number; name: string };
  deadline?: string | null;
  url?: string;
};

export type KanbanDailySummaryEpicNode = {
  epic: KanbanDailySummaryEpicRef;
  tasks: KanbanDailySummaryTaskNode[];
  total_minutes: number;
  total_hours: number;
};

export type KanbanDailySummaryProjectNode = {
  project: { id: number | null; slug: string; name: string };
  epics: KanbanDailySummaryEpicNode[];
  without_epic: {
    name: string;
    tasks: KanbanDailySummaryTaskNode[];
    total_minutes: number;
    total_hours: number;
  };
  total_minutes: number;
  total_hours: number;
};

export type KanbanDailySummary = {
  day: string;
  kanban_user: { id: number; name: string };
  users: { id: number; name: string }[];
  projects: KanbanDailySummaryProjectNode[];
  summary: {
    projects: number;
    epics: number;
    tasks: number;
    worklogs: number;
    total_minutes: number;
    total_hours: number;
  };
};

export function useKanbanDailySummary(
  params: { day: string; kanban_user_id?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ["kanban-analytics", "daily-summary", params] as const,
    queryFn: () => api.get<KanbanDailySummary>("/analytics/kanban/summary/day", { query: params }),
    staleTime: 30_000,
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(params.day),
  });
}

export type KanbanMemberProjectRole = "QA" | "Manager" | "Frontend" | "Backend" | "Java" | "Other";

export const KANBAN_MEMBER_PROJECT_ROLE_ORDER: KanbanMemberProjectRole[] = [
  "QA",
  "Manager",
  "Frontend",
  "Backend",
  "Java",
  "Other",
];

export type KanbanAnalyticsEpicDetail = {
  epic: {
    id: number;
    name: string;
    project: { id: number | null; slug: string; name: string };
    stage: { id: number; name: string };
    deadline?: string | null;
    created_at?: string | null;
    url?: string;
    local_meta?: KanbanAnalyticsEpicListItem["local_meta"];
  };
  summary: {
    task_count: number;
    in_progress_count: number;
    done_count: number;
    tracked_hours: number;
    /** Часы worklog по ролям участников проекта (настройки Resonance). */
    hours_by_role?: Partial<Record<KanbanMemberProjectRole, number>>;
    /** Устаревшее поле старого снимка; не использовать для новых данных. */
    qa_tracked_hours?: number;
  };
  charts_ready?: boolean;
  tasks: KanbanAnalyticsTaskListItem[];
  worklogs: {
    task_id: number;
    task_name: string;
    task_url: string;
    task_type_id?: number | null;
    task_type_name?: string;
    /** Роль автора списания в Resonance (kanban_project_member_roles), как в hours_by_role графиков. */
    member_role?: KanbanMemberProjectRole;
    user_name: string;
    kanban_user_id?: number | null;
    minutes: number;
    hours: number;
    comment: string;
    begin: string;
  }[];
  workload: { user_name: string; hours: number }[];
};

export type KanbanAnalyticsEpicCharts = KanbanAnalyticsEpicDetail & { charts_ready: boolean };

export function useKanbanAnalyticsEpicDetail(epicId: number | null, projectSlug: string | null, enabled = true) {
  return useQuery({
    queryKey: ["kanban-analytics", "epic-detail", epicId, projectSlug] as const,
    queryFn: () =>
      api.get<KanbanAnalyticsEpicDetail>(`/analytics/kanban/epics/${epicId}`, { query: { project_slug: projectSlug } }),
    staleTime: 30_000,
    enabled: enabled && epicId != null && projectSlug != null && projectSlug !== "",
  });
}

export function useKanbanEpicCharts(epicId: number | null, projectSlug: string | null, enabled = true) {
  return useQuery({
    queryKey: ["kanban-analytics", "epic-charts", epicId, projectSlug] as const,
    queryFn: () =>
      api.get<KanbanAnalyticsEpicCharts>(`/analytics/kanban/epics/${epicId}/charts`, {
        query: { project_slug: projectSlug },
      }),
    staleTime: 60_000,
    enabled: enabled && epicId != null && projectSlug != null && projectSlug !== "",
  });
}

export type KanbanMemberRoleRow = {
  kanban_user_id: number;
  display_name: string;
  role: KanbanMemberProjectRole;
  role_explicit: boolean;
};

export function useKanbanProjectMemberRoles(slug: string | null, enabled = true) {
  return useQuery({
    queryKey: ["kanban-project-member-roles", slug] as const,
    queryFn: () =>
      api.get<{ project_slug: string; members: KanbanMemberRoleRow[] }>(
        `/kanban/projects/${encodeURIComponent(slug!)}/member-roles`,
      ),
    staleTime: 30_000,
    enabled: enabled && slug != null && slug !== "",
  });
}

export function usePutKanbanProjectMemberRoles(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roles: { kanban_user_id: number; role: KanbanMemberProjectRole }[]) =>
      api.put(`/kanban/projects/${encodeURIComponent(slug)}/member-roles`, { roles }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["kanban-project-member-roles"] });
      await qc.invalidateQueries({ queryKey: ["kanban-analytics"] });
    },
  });
}

// --- Users / Projects ---

export type UsersQueryParams = {
  page?: number;
  page_size?: number;
  search?: string;
  role?: string;
};

export function useUsers(paramsOrEnabled: UsersQueryParams | boolean = {}, enabledMaybe = true) {
  const params = typeof paramsOrEnabled === "boolean" ? {} : paramsOrEnabled;
  const enabled = typeof paramsOrEnabled === "boolean" ? paramsOrEnabled : enabledMaybe;
  return useQuery({
    queryKey: [...queryKeys.users, params] as const,
    queryFn: () => api.get<ApiPage<ApiUser>>("/admin/users", { query: params }),
    staleTime: 60_000,
    enabled,
  });
}

/** Коллеги по общим проектам (поля совместимы с `mapApiUserToRefUser`, без `/admin/users`). */
export function useDirectoryUsers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.directoryUsers,
    queryFn: () => api.get<ApiUser[]>("/directory/users"),
    staleTime: 60_000,
    enabled,
  });
}

/** Approved users on a project (for @mentions autocomplete). */
export function useProjectMentionUsers(projectId: number | null) {
  return useQuery({
    queryKey: projectId != null ? queryKeys.mentionUsers(projectId) : ["mention-users", "none"],
    queryFn: () => api.get<ApiMentionUser[]>(`/projects/${projectId}/mention-users`),
    staleTime: 60_000,
    enabled: projectId != null && projectId > 0,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      username: string;
      password: string;
      role: BackendUserRole;
      workspace?: string;
      project_ids?: number[];
      is_approved?: boolean;
      telegram_notifications?: boolean;
      direction?: string;
    }) => api.post<ApiUser>("/admin/users", body),
    onSuccess: async () => {
      await refetchDataBridgeRoots(qc, ["users"]);
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: {
        username?: string;
        password?: string;
        role?: BackendUserRole;
        workspace?: string;
        project_ids?: number[];
        is_approved?: boolean;
        telegram_notifications?: boolean;
        direction?: string;
      };
    }) => api.put<ApiUser>(`/admin/users/${id}`, body),
    onSuccess: async () => {
      await refetchDataBridgeRoots(qc, ["users"]);
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/admin/users/${id}`),
    onSuccess: async () => {
      await refetchDataBridgeRoots(qc, ["users"]);
    },
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => api.get<ApiProject[]>("/projects"),
    staleTime: 60_000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; config_json?: Record<string, unknown> }) =>
      api.post<ApiProject>("/admin/projects", body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.me });
      await refetchDataBridgeRoots(qc, ["projects", "users"]);
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name?: string; config_json?: Record<string, unknown> } }) =>
      api.put<ApiProject>(`/admin/projects/${id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.me });
      await refetchDataBridgeRoots(qc, ["projects", "users"]);
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/admin/projects/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.me });
      await refetchDataBridgeRoots(qc, ["projects", "users", "epics", "tickets", "activity"]);
      await qc.refetchQueries({ queryKey: ["ticket-summary"] });
    },
  });
}

export function useExperts(projectId?: number, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.experts(projectId),
    queryFn: () =>
      api.get<{ id: number; username: string; direction: string | null }[]>("/data/experts", {
        query: projectId != null && projectId > 0 ? { project_id: projectId } : {},
      }),
    enabled: options?.enabled ?? true,
  });
}

export function useTicketReassignCandidates(ticketId: number, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.ticketReassignCandidates(ticketId),
    queryFn: () =>
      api.get<{ id: number; username: string; direction: string | null }[]>(
        `/tickets/${ticketId}/reassign-candidates`,
      ),
    enabled: (options?.enabled ?? true) && ticketId > 0,
  });
}

// --- Tickets ---

export interface TicketsQueryParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  search?: string;
  project_id?: number;
  epic_id?: number;
  assignee_id?: number;
  author_id?: number;
  sort?: string;
  page?: number;
  page_size?: number;
}

/** Stable references for DataBridge — inline `{}` / `{ limit: 100 }` each render can churn query observers in some setups. */
export const dataBridgeTicketsParams: TicketsQueryParams = { page: 1, page_size: 100 };
export const dataBridgeEpicsParams: { project_id?: number; status?: string; page?: number; page_size?: number } = { page: 1, page_size: 100 };
export const dataBridgeActivityParams: {
  since?: string;
  limit?: number;
  page?: number;
  page_size?: number;
  target_type?: string;
  project_id?: number;
} = { page: 1, page_size: 100 };

export function useTickets(params: TicketsQueryParams = {}) {
  return useQuery({
    queryKey: queryKeys.tickets(params as unknown as Record<string, unknown>),
    queryFn: () => api.get<ApiTicketPage>("/tickets", { query: params as unknown as Record<string, unknown> }),
    placeholderData: (previous) => previous,
  });
}

export function useTicket(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.ticket(id ?? -1),
    queryFn: () => api.get<ApiTicket>(`/tickets/${id}`),
    enabled: typeof id === "number" && id > 0,
  });
}

export function useTicketSummary(params: { project_id?: number; epic_name?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.ticketSummary(params),
    queryFn: () => api.get<ApiDashboardSummary>("/tickets/summary", { query: params }),
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      project_id: number;
      title: string;
      description?: string;
      priority?: TicketPriority;
      sla_hours?: number;
      due_at?: string;
      epic_id?: number;
      data_json?: Record<string, unknown>;
    }) => api.post<ApiTicket>("/tickets", body),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["tickets"] });
      await qc.refetchQueries({ queryKey: ["ticket-summary"] });
      await qc.refetchQueries({ queryKey: ["activity"] });
      bumpDataVersion();
    },
  });
}

export function useUpdateTicket(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ApiTicket>(`/tickets/${id}`, body),
    onSuccess: async (ticket) => {
      qc.setQueryData(queryKeys.ticket(id), ticket);
      await qc.refetchQueries({ queryKey: ["tickets"] });
      await qc.refetchQueries({ queryKey: ["ticket-summary"] });
      bumpDataVersion();
    },
  });
}

export function useTicketMessages(ticketId: number | null) {
  return useQuery({
    queryKey: ["ticket-messages", ticketId ?? -1],
    queryFn: () => api.get<ApiMessage[]>(`/tickets/${ticketId}/messages`),
    enabled: typeof ticketId === "number" && ticketId > 0,
  });
}

export function useCreateTicketMessage(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; kind?: string; attachment_ids?: number[] }) =>
      api.post<ApiMessage>(`/tickets/${ticketId}/messages`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.ticket(ticketId) });
      await qc.invalidateQueries({ queryKey: ["ticket-messages", ticketId] });
      await qc.refetchQueries({ queryKey: ["tickets"] });
      await qc.refetchQueries({ queryKey: ["ticket-summary"] });
    },
  });
}

export function useCreateTicketAttachment(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      url: string;
      name: string;
      mime_type?: string;
      size_bytes?: number;
      message_id?: number;
    }) => api.post<ApiAttachment>(`/tickets/${ticketId}/attachments`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ticket(ticketId) }),
  });
}

export function useSubscribeTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ApiTicket>(`/tickets/${ticketId}/subscribe`),
    onSuccess: async (ticket) => {
      qc.setQueryData(queryKeys.ticket(ticketId), ticket);
      await qc.refetchQueries({ queryKey: ["tickets"] });
      bumpDataVersion();
    },
  });
}

export function useUnsubscribeTicket(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<ApiTicket>(`/tickets/${ticketId}/subscribe`),
    onSuccess: async (ticket) => {
      qc.setQueryData(queryKeys.ticket(ticketId), ticket);
      await qc.refetchQueries({ queryKey: ["tickets"] });
      bumpDataVersion();
    },
  });
}

export function useReassignTicketExpert(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { assignee_id: number }) =>
      api.post<ApiTicket>(`/tickets/${ticketId}/reassign-expert`, body),
    onSuccess: async (ticket) => {
      qc.setQueryData(queryKeys.ticket(ticketId), ticket);
      await qc.refetchQueries({ queryKey: ["tickets"] });
      await qc.invalidateQueries({ queryKey: queryKeys.ticketReassignCandidates(ticketId) });
      bumpDataVersion();
    },
  });
}

export function useClaimTicketAssignee(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ApiTicket>(`/tickets/${ticketId}/claim-assignee`),
    onSuccess: async (ticket) => {
      qc.setQueryData(queryKeys.ticket(ticketId), ticket);
      await qc.refetchQueries({ queryKey: ["tickets"] });
      await qc.invalidateQueries({ queryKey: queryKeys.ticketReassignCandidates(ticketId) });
      bumpDataVersion();
    },
  });
}

// --- Epics ---

export function useEpics(
  params: { project_id?: number; status?: string; page?: number; page_size?: number } = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.epics(params),
    queryFn: () => api.get<ApiEpicPage>("/epics", { query: params }),
    enabled: options?.enabled ?? true,
    placeholderData: (previous) => previous,
  });
}

export function useCreateEpic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      project_id: number;
      title: string;
      jira_url: string;
      confluence_url?: string;
      kanban_url?: string | null;
      design_url?: string | null;
      notes?: string | null;
      qa_estimate_hours?: number | null;
      lead_analyst_id?: number | null;
      lead_designer_id?: number | null;
      expert_id?: number | null;
      start_date?: string | null;
      target_date?: string | null;
    }) => api.post<ApiEpic>("/epics", body),
    onSuccess: async () => {
      await refetchDataBridgeRoots(qc, ["epics", "activity"]);
    },
  });
}

export function useEpic(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.epic(id ?? -1),
    queryFn: () => api.get<ApiEpic>(`/epics/${id}`),
    enabled: typeof id === "number" && id > 0,
  });
}

export function useUpdateEpic(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ApiEpic>(`/epics/${epicId}`, body),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: queryKeys.epic(epicId) });
      await refetchDataBridgeRoots(qc, ["epics"]);
    },
  });
}

export function useDeleteEpic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (epicId: number) => api.delete<void>(`/epics/${epicId}`),
    onSuccess: async (_, epicId) => {
      qc.removeQueries({ queryKey: queryKeys.epic(epicId) });
      await qc.refetchQueries({ queryKey: ["tickets"] });
      await qc.refetchQueries({ queryKey: ["ticket-summary"] });
      await refetchDataBridgeRoots(qc, ["epics", "activity"]);
    },
  });
}

export function useEpicHistory(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.epicHistory(id ?? -1),
    queryFn: () => api.get(`/epics/${id}/history`),
    enabled: typeof id === "number" && id > 0,
  });
}

export function useEpicBlockers(id: number | null | undefined, includeResolved = false) {
  return useQuery({
    queryKey: [...queryKeys.epicBlockers(id ?? -1), includeResolved],
    queryFn: () =>
      api.get<ApiEpicBlocker[]>(`/epics/${id}/blockers`, { query: { include_resolved: includeResolved } }),
    enabled: typeof id === "number" && id > 0,
  });
}

export function useEpicTestRuns(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.epicTestRuns(id ?? -1),
    queryFn: () => api.get<ApiEpicTestRun[]>(`/epics/${id}/test-runs`),
    enabled: typeof id === "number" && id > 0,
  });
}

export function useCreateEpicBlocker(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string }) => api.post<ApiEpicBlocker>(`/epics/${epicId}/blockers`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) });
      qc.invalidateQueries({ queryKey: queryKeys.epicBlockers(epicId) });
    },
  });
}

export function useUpdateEpicBlocker(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ blockerId, body }: { blockerId: number; body: { resolved?: boolean; body?: string } }) =>
      api.patch<ApiEpicBlocker>(`/epics/${epicId}/blockers/${blockerId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) });
      qc.invalidateQueries({ queryKey: queryKeys.epicBlockers(epicId) });
    },
  });
}

export function useCreateTestRun(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { environment: EpicTestStage; status?: TestRunStatus; url: string }) =>
      api.post<ApiEpicTestRun>(`/epics/${epicId}/test-runs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) });
      qc.invalidateQueries({ queryKey: queryKeys.epicTestRuns(epicId) });
    },
  });
}

export function useUpdateTestRun(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, body }: { runId: number; body: Partial<ApiEpicTestRun> }) =>
      api.patch<ApiEpicTestRun>(`/epics/${epicId}/test-runs/${runId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) }),
  });
}

export function useUpdateEpicQA(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/epics/${epicId}/qa`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) }),
  });
}

export function useTransitionEpicQA(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target_status: EpicQAStatus; comment?: string }) =>
      api.post(`/epics/${epicId}/qa/transition`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) }),
  });
}

export function useToggleEpicQAItem(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { item_id: string; is_checked: boolean; comment?: string }) =>
      api.post(`/epics/${epicId}/qa/check-item`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) }),
  });
}

export function useAddEpicComment(epicId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string }) => api.post(`/epics/${epicId}/comments`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.epic(epicId) }),
  });
}

// --- Notifications ---

export function useNotificationsQuery(includeRead = true, params: { page?: number; page_size?: number } = {}) {
  return useQuery({
    queryKey: [...queryKeys.notifications, includeRead, params],
    queryFn: () => api.get<ApiNotificationPage>("/notifications", { query: { include_read: includeRead, ...params } }),
    staleTime: 5_000,
    refetchInterval: 45_000,
    placeholderData: (previous) => previous,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

export function useDeliveryHealthQuery(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.notifications, "delivery-health"],
    queryFn: () => api.get<ApiDeliveryHealth>("/notifications/delivery-health"),
    staleTime: 60_000,
    enabled,
  });
}

// --- Activity / role summary / data version ---

export function useActivity(
  params: { since?: string; limit?: number; page?: number; page_size?: number; target_type?: string; activity_type?: string; project_id?: number; user_id?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.activity(params),
    queryFn: () => api.get<ApiActivityPage>("/activity", { query: params }),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useRoleSummary() {
  return useQuery({
    queryKey: queryKeys.roleSummary,
    queryFn: () => api.get<ApiRoleSummary>("/dashboard/role-summary"),
    staleTime: 15_000,
  });
}

export function useDashboardAggregate(persona?: string | null) {
  return useQuery({
    queryKey: queryKeys.dashboardAggregate(persona),
    queryFn: () => api.get<ApiDashboardAggregate>("/dashboard/summary", { query: persona ? { persona } : {} }),
    staleTime: 15_000,
  });
}

export function useProfileStats() {
  return useQuery({
    queryKey: queryKeys.profileStats,
    queryFn: () => api.get<ApiProfileStats>("/profile/stats"),
    staleTime: 15_000,
  });
}

export function useStatisticsSummary(params: { project_id?: number; epic_id?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.statisticsSummary(params),
    queryFn: () => api.get<ApiStatisticsSummary>("/statistics/summary", { query: params }),
    staleTime: 15_000,
  });
}

// --- Feedback ---

export type FeedbackType = "bug" | "improvement";
export type FeedbackStatus = "new" | "in_review" | "planned" | "in_progress" | "resolved" | "declined";

export interface ApiFeedback {
  id: number;
  type: FeedbackType;
  status: FeedbackStatus;
  title: string;
  description: string;
  context_url: string | null;
  expected_result: string | null;
  steps_to_reproduce: string | null;
  admin_response: string | null;
  author_id: number;
  author_username: string;
  responder_id: number | null;
  responder_username: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useMyFeedback(params: { page?: number; page_size?: number } = {}) {
  return useQuery({
    queryKey: ["feedback", "mine", params],
    queryFn: () => api.get<ApiPage<ApiFeedback>>("/feedback/mine", { query: params }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: FeedbackType;
      title: string;
      description: string;
      context_url?: string;
      expected_result?: string;
      steps_to_reproduce?: string;
    }) => api.post<ApiFeedback>("/feedback", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback", "mine"] }),
  });
}

export type AdminFeedbackListFilters = {
  status?: FeedbackStatus | null;
  type?: FeedbackType | null;
  search?: string;
  page?: number;
  page_size?: number;
};

export function useAdminFeedback(filters: AdminFeedbackListFilters) {
  const status = filters.status ?? undefined;
  const type = filters.type ?? undefined;
  const searchRaw = filters.search?.trim();
  const search = searchRaw ? searchRaw : undefined;
  const page = filters.page ?? 1;
  const page_size = filters.page_size ?? 25;

  return useQuery({
    queryKey: ["feedback", "admin", { status: status ?? null, type: type ?? null, search: search ?? "", page, page_size }],
    queryFn: () =>
      api.get<ApiPage<ApiFeedback>>("/feedback/admin", {
        query: {
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          ...(search ? { search } : {}),
          page,
          page_size,
        },
      }),
    placeholderData: (previous) => previous,
  });
}

export function useUpdateAdminFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: { status?: FeedbackStatus; admin_response?: string | null };
    }) => api.put<ApiFeedback>(`/feedback/admin/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback", "admin"] }),
  });
}

// --- File upload ---

export interface UploadResponse {
  url: string;
  name: string;
  mime_type: string;
  size_bytes: number;
}

export function useUploadFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.post<UploadResponse>("/files/upload", form);
    },
  });
}
