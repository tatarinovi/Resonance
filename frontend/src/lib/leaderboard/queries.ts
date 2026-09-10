import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Board {
  source_statuses: Record<string, string>;
  season: string;
  closed: boolean;
  updated_at: string;
  current_user_id: number;
  seasons: string[];
  items: { id: number; name: string; points: number; rank: number }[];
  rules: {
    timezone: string;
    execution_statuses: string[];
    events: Record<string, { label: string; points: number }>;
    execution_tiers: {
      minimum: number;
      maximum: number | null;
      points: number;
    }[];
  };
}
export interface Contribution {
  id: number;
  participant_id: number;
  source: string;
  source_key: string;
  date: string;
  points: number;
  eligible: boolean;
  explanation: string;
}
export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}
export interface AdminData {
  settings: {
    jira_jql?: string;
    jira_environment_field?: string;
    testops_project_ids?: number[];
  };
  users: { id: number; name: string }[];
  backfill: { status?: string; season?: string; error?: string };
  bugs: Page<{
    id: number;
    issue_key: string;
    participant_id: number | null;
    environment: string | null;
    status: string;
    problem: string | null;
  }>;
  sync: {
    status?: string;
    last_finished_at?: string;
    sources?: Record<
      string,
      {
        status: string;
        error?: string;
        last_success_at?: string;
        problem_count?: number;
        problems?: { source_key: string; message: string }[];
      }
    >;
  };
  identities: {
    id: number;
    source: string;
    external_id: string;
    user_id: number;
  }[];
  audit: {
    id: number;
    admin_id: number;
    action: string;
    reason: string;
    date: string;
  }[];
}
export function canViewLeaderboard(
  me: { role: string; direction?: string | null; workspace?: string } | null,
) {
  return (
    !!me &&
    (me.role === "admin" ||
      (me.role === "employee" &&
        me.direction === "qa" &&
        me.workspace === "ds"))
  );
}
export function useLeaderboard(season: string, enabled = true) {
  return useQuery({
    queryKey: ["leaderboard", "board", season],
    queryFn: () =>
      api.get<Board>(
        `/leaderboard${season ? `?season=${encodeURIComponent(season)}` : ""}`,
      ),
    enabled,
    refetchInterval: 30_000,
  });
}
export function useLeaderboardActivity(
  season: string,
  participant: number | undefined,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["leaderboard", "activity", season, participant, page],
    queryFn: () =>
      api.get<Page<Contribution>>(
        `/leaderboard/activity?season=${season}&page=${page}${participant ? `&participant_id=${participant}` : ""}`,
      ),
    enabled: enabled && !!season,
  });
}
export function useLeaderboardAdmin(
  season: string,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["leaderboard", "admin", season, page],
    queryFn: () =>
      api.get<AdminData>(`/leaderboard/admin?season=${season}&page=${page}`),
    enabled: enabled && !!season,
    refetchInterval: 5000,
  });
}
export function useLeaderboardMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      body,
      method = "post",
    }: {
      path: string;
      body?: unknown;
      method?: "post" | "put";
    }) => api[method](`/leaderboard${path}`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["leaderboard"] }),
  });
}
