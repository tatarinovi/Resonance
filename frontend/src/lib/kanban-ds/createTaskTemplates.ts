/** Локальные шаблоны формы «Создать задачу» (по проекту Kanban). */

const STORAGE_KEY = "resonance.kanban.createTaskTemplates.v1";
const MAX_PER_PROJECT = 40;

export type CreateTaskTemplatePayload = {
  title: string;
  description: string;
  taskTypeId: number | null;
  priorityId: number | null;
  componentId: number | null;
  layoutLink: string;
  markupLink: string;
  devLink: string;
  epicId: number | null;
  executorIds: number[];
  checklistLines: string[];
};

export type CreateTaskTemplate = {
  id: string;
  name: string;
  savedAt: string;
  payload: CreateTaskTemplatePayload;
};

type Store = Record<string, CreateTaskTemplate[]>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function loadCreateTaskTemplates(projectSlug: string): CreateTaskTemplate[] {
  const list = readStore()[projectSlug];
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function appendCreateTaskTemplate(projectSlug: string, template: CreateTaskTemplate): CreateTaskTemplate[] {
  const store = readStore();
  const prev = Array.isArray(store[projectSlug]) ? store[projectSlug] : [];
  const next = [template, ...prev.filter((t) => t.id !== template.id)].slice(0, MAX_PER_PROJECT);
  store[projectSlug] = next;
  writeStore(store);
  return next;
}

export function extractCreatedKanbanTaskId(raw: unknown): number | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const id = Number(r.id);
  if (Number.isFinite(id) && id > 0) return id;
  const d = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;
  if (d) {
    const id2 = Number(d.id);
    if (Number.isFinite(id2) && id2 > 0) return id2;
  }
  return null;
}

/** Имя группы чек-листа в теле `TaskCheckListUpdateRequest` (v1.json). */
export const KANBAN_DEFAULT_CHECKLIST_GROUP_NAME = "Чек-лист";
