import type { RefPriority } from "@/lib/mappers";
import { isQuestionAudienceSlug } from "@/lib/validationTeam";

export const QUESTION_DRAFT_IDLE_MS = 2000;
export const QUESTION_DRAFT_VERSION = 1 as const;

export const QUESTION_DRAFT_UPDATED_EVENT = "questionDraftUpdated";

const PRIORITY_SET = new Set<RefPriority>(["Критический", "Высокий", "Средний", "Низкий"]);

export type QuestionDraftFormFields = {
  title: string;
  description: string;
  projectId: string;
  priority: RefPriority;
  /** Slug «кому адресован» (target_direction). */
  validationTeam: string;
  epicId?: number | null;
};

export type QuestionDraftStored = QuestionDraftFormFields & {
  version: typeof QUESTION_DRAFT_VERSION;
  updatedAt: string;
};

export function questionDraftStorageKey(userId: number): string {
  return `resonance.questionDraft.v1:${userId}`;
}

export function shouldPersistQuestionDraft(f: QuestionDraftFormFields): boolean {
  if (f.title.trim().length > 3) return true;
  if (f.description.trim().length > 10) return true;
  if (f.projectId.trim() !== "") return true;
  if (typeof f.epicId === "number" && f.epicId > 0) return true;
  return false;
}

function normalizeParsed(o: Record<string, unknown>): QuestionDraftStored | null {
  if (o.version !== QUESTION_DRAFT_VERSION) return null;
  if (typeof o.title !== "string") return null;
  if (typeof o.description !== "string") return null;
  if (typeof o.projectId !== "string") return null;
  if (typeof o.priority !== "string" || !PRIORITY_SET.has(o.priority as RefPriority)) return null;
  const vtRaw = typeof o.validationTeam === "string" ? o.validationTeam : "";
  const validationTeam = isQuestionAudienceSlug(vtRaw) ? vtRaw : "";
  if (typeof o.updatedAt !== "string") return null;

  let epicId: number | null | undefined;
  if ("epicId" in o && o.epicId !== undefined) {
    if (o.epicId === null) epicId = null;
    else if (typeof o.epicId === "number" && o.epicId > 0) epicId = o.epicId;
  }

  const base: QuestionDraftStored = {
    version: QUESTION_DRAFT_VERSION,
    updatedAt: o.updatedAt,
    title: o.title,
    description: o.description,
    projectId: o.projectId,
    priority: o.priority as RefPriority,
    validationTeam,
  };
  if (epicId !== undefined) return { ...base, epicId };
  return base;
}

export function parseQuestionDraftJson(raw: string): QuestionDraftStored | null {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    return normalizeParsed(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function readQuestionDraft(userId: number | null): QuestionDraftStored | null {
  if (userId == null || !Number.isFinite(userId)) return null;
  try {
    const key = questionDraftStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = parseQuestionDraftJson(raw);
    if (!parsed) localStorage.removeItem(key);
    return parsed;
  } catch {
    return null;
  }
}

export function writeQuestionDraft(userId: number | null, fields: QuestionDraftFormFields): void {
  if (userId == null || !Number.isFinite(userId)) return;
  if (!shouldPersistQuestionDraft(fields)) return;
  const payload: QuestionDraftStored = {
    version: QUESTION_DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
    title: fields.title,
    description: fields.description,
    projectId: fields.projectId,
    priority: fields.priority,
    validationTeam: fields.validationTeam,
    ...(typeof fields.epicId === "number" && fields.epicId > 0 ? { epicId: fields.epicId } : {}),
  };
  try {
    localStorage.setItem(questionDraftStorageKey(userId), JSON.stringify(payload));
    notifyQuestionDraftUpdated();
  } catch {
    // quota or private mode
  }
}

export function clearQuestionDraft(userId: number | null): void {
  if (userId == null || !Number.isFinite(userId)) return;
  try {
    localStorage.removeItem(questionDraftStorageKey(userId));
    notifyQuestionDraftUpdated();
  } catch {
    // ignore
  }
}

export function hasQuestionDraft(userId: number | null): boolean {
  return readQuestionDraft(userId) != null;
}

export function notifyQuestionDraftUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(QUESTION_DRAFT_UPDATED_EVENT));
}

export function draftToFormFields(d: QuestionDraftStored): QuestionDraftFormFields {
  return {
    title: d.title,
    description: d.description,
    projectId: d.projectId,
    priority: d.priority,
    validationTeam: d.validationTeam,
    epicId: d.epicId ?? null,
  };
}
