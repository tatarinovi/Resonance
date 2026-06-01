import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

import { optimisticDsTaskRowSetStage } from "./mappers";
import type { KanbanBoardBundle } from "./types";

/** Бандл доски соответствует DS Kanban OpenAPI: `helps/v1.json`. */

export const kanbanBoardBundleKey = (slug: string, onlyMine = false) => ["kanban-board-bundle", slug, onlyMine] as const;
export const kanbanProjectEpicsKey = (slug: string) => ["kanban-project-epics", slug] as const;
export const kanbanTaskKey = (taskId: number) => ["kanban-task", taskId] as const;
export const kanbanRefKey = (kind: "task-types" | "priorities" | "components") => ["kanban-ref", kind] as const;

export function useKanbanBoardBundle(slug: string | undefined, enabled = true, options?: { onlyMine?: boolean }) {
  const onlyMine = Boolean(options?.onlyMine);
  return useQuery({
    queryKey: slug ? kanbanBoardBundleKey(slug, onlyMine) : ["kanban-board-bundle", "none", onlyMine],
    queryFn: () => {
      const suffix = onlyMine ? "?only_mine=true" : "";
      return api.get<KanbanBoardBundle>(`/kanban/projects/${encodeURIComponent(slug!)}/bundle${suffix}`);
    },
    enabled: Boolean(slug) && enabled,
  });
}

export type KanbanEpicOption = { id: number; name: string };

/** Список эпиков проекта (GET /project/{slug}/list + type_id=5 через бэкенд). */
export function useKanbanProjectEpics(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: slug ? kanbanProjectEpicsKey(slug) : ["kanban-project-epics", "none"],
    queryFn: () => api.get<KanbanEpicOption[]>(`/kanban/projects/${encodeURIComponent(slug!)}/epics`),
    enabled: Boolean(slug) && enabled,
    staleTime: 60_000,
  });
}

export function useKanbanTaskTypes(enabled = true) {
  return useQuery({
    queryKey: kanbanRefKey("task-types"),
    queryFn: () => api.get<unknown[]>("/kanban/reference/task-types"),
    enabled,
  });
}

export function useKanbanPriorities(enabled = true) {
  return useQuery({
    queryKey: kanbanRefKey("priorities"),
    queryFn: () => api.get<unknown[]>("/kanban/reference/priorities"),
    enabled,
  });
}

export function useKanbanComponents(enabled = true) {
  return useQuery({
    queryKey: kanbanRefKey("components"),
    queryFn: () => api.get<unknown[]>("/kanban/reference/components"),
    enabled,
  });
}

export function useKanbanTaskDetail(taskId: number | null, enabled = true) {
  return useQuery({
    queryKey: taskId != null ? kanbanTaskKey(taskId) : ["kanban-task", "none"],
    queryFn: () => api.get<unknown>(`/kanban/tasks/${taskId}`),
    enabled: taskId != null && enabled,
  });
}

/** Отдельная загрузка комментариев; в DS v1 основной источник — поле `comments` в GET /task/{id}. Включайте только если деталка задачи без массива `comments`. */
export function useKanbanTaskComments(taskId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["kanban-task-comments", taskId],
    queryFn: () => api.get<unknown[]>(`/kanban/tasks/${taskId}/comments`),
    enabled: taskId != null && enabled,
  });
}

function unwrapKanbanWorkPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "data" in raw) {
    const d = (raw as { data?: unknown }).data;
    if (Array.isArray(d)) return d;
  }
  return [];
}

export function useKanbanTaskWork(taskId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["kanban-task-work", taskId],
    queryFn: async () => unwrapKanbanWorkPayload(await api.get<unknown>(`/kanban/tasks/${taskId}/work`)),
    enabled: taskId != null && enabled,
  });
}

/** Параллельный GET /task/{id}/work для нескольких задач (worklog эпика по дочерним карточкам). */
export function useKanbanMultiTaskWork(taskIds: number[], enabled: boolean) {
  const ids = [...new Set(taskIds.filter((id) => Number.isFinite(id) && id > 0))];
  return useQueries({
    queries: ids.map((taskId) => ({
      queryKey: ["kanban-task-work", taskId] as const,
      queryFn: async (): Promise<{ taskId: number; rows: unknown[] }> => ({
        taskId,
        rows: unwrapKanbanWorkPayload(await api.get<unknown>(`/kanban/tasks/${taskId}/work`)),
      }),
      enabled: enabled && ids.length > 0,
      staleTime: 25_000,
    })),
  });
}

type PatchTaskVars = { taskId: number; body: Record<string, unknown> };

function parseStageIdFromPatchBody(body: Record<string, unknown>): number | null {
  const raw = body.stage_id;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function useKanbanPatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, body }: PatchTaskVars) => api.patch<unknown>(`/kanban/tasks/${taskId}`, body),
    onMutate: async (vars) => {
      const newStageId = parseStageIdFromPatchBody(vars.body);
      if (newStageId == null) return;

      const bundlePredicate = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === "kanban-board-bundle";
      await qc.cancelQueries({ predicate: bundlePredicate });
      const detailKey = kanbanTaskKey(vars.taskId);
      await qc.cancelQueries({ queryKey: detailKey });

      const previousBundles = qc.getQueriesData({ predicate: bundlePredicate });
      const previousDetail = qc.getQueryData(detailKey);
      const detailWasCached = previousDetail != null && typeof previousDetail === "object";

      qc.setQueriesData({ predicate: bundlePredicate }, (old) => {
        if (!old || typeof old !== "object") return old;
        const bundle = old as KanbanBoardBundle;
        const tasks = bundle.tasks;
        if (!Array.isArray(tasks)) return old;
        let found = false;
        const nextTasks = tasks.map((row) => {
          const o = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
          if (!o) return row;
          const id = Number(o.id);
          if (id !== vars.taskId) return row;
          found = true;
          return optimisticDsTaskRowSetStage(row, newStageId);
        });
        if (!found) return old;
        return { ...bundle, tasks: nextTasks };
      });

      if (detailWasCached) {
        qc.setQueryData(detailKey, optimisticDsTaskRowSetStage(previousDetail, newStageId));
      }

      return { previousBundles, previousDetail, detailKey, detailWasCached };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx || typeof ctx !== "object") return;
      const c = ctx as {
        previousBundles?: [readonly unknown[], unknown][];
        previousDetail?: unknown;
        detailKey?: readonly unknown[];
        detailWasCached?: boolean;
      };
      for (const [key, data] of c.previousBundles ?? []) {
        qc.setQueryData(key, data);
      }
      if (c.detailWasCached && c.detailKey) {
        qc.setQueryData(c.detailKey, c.previousDetail);
      }
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: kanbanTaskKey(vars.taskId) });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "kanban-board-bundle" });
    },
  });
}

export function useKanbanCreateTask(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<unknown>(`/kanban/projects/${encodeURIComponent(slug)}/tasks`, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "kanban-board-bundle" && q.queryKey[1] === slug,
      });
      void qc.invalidateQueries({ queryKey: kanbanProjectEpicsKey(slug) });
    },
  });
}

export function useKanbanPostComment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>(`/kanban/tasks/${taskId}/comments`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
      void qc.invalidateQueries({ queryKey: ["kanban-task-comments", taskId] });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "kanban-board-bundle" });
    },
  });
}

export function useKanbanPostWork(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>(`/kanban/tasks/${taskId}/work`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
      void qc.invalidateQueries({ queryKey: ["kanban-task-work", taskId] });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "kanban-board-bundle" });
    },
  });
}

export function useKanbanPostEstimate(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>(`/kanban/tasks/${taskId}/estimates`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
    },
  });
}

export function useKanbanPatchChecklistPoint(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pointId, body }: { pointId: number; body: Record<string, unknown> }) =>
      api.patch<unknown>(`/kanban/checklist-points/${pointId}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
    },
  });
}

export function useKanbanPostChecklist(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>(`/kanban/tasks/${taskId}/checklist`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kanbanTaskKey(taskId) });
    },
  });
}
