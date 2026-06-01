import { epics } from "@/data/epics";
import { questions } from "@/data/questions";
import { users } from "@/data/users";

const STORAGE_PREFIX = "resonance.inbox.readIds";

export type InboxRow = {
  id: string;
  type: "q" | "e";
  title: string;
  projectId: string;
  status: string;
  date: string;
  authorId: string;
};

/** Вопросы и эпики, назначенные на пользователя (как на странице «Входящие»). */
export function collectInboxRows(assigneeId: string): InboxRow[] {
  const currentUser = users.find((u) => u.id === assigneeId);
  const isCoordinator = currentUser?.role === "Координатор";
  const myProjectIds = new Set(currentUser?.projectIds ?? []);
  const myQ = questions.filter((q) => {
    if (q.status === "Закрыт" || q.status === "Отменён") return false;
    if (q.assigneeId === assigneeId) return true;
    return isCoordinator && q.status === "На проверке" && myProjectIds.has(q.projectId);
  });
  const myE = epics.filter(
    (e) => e.leadAnalystId === assigneeId || e.leadDesignerId === assigneeId,
  );
  const rows: InboxRow[] = [
    ...myQ.map((q) => ({
      id: q.id,
      type: "q" as const,
      title: q.title,
      projectId: q.projectId,
      status: q.status,
      date: q.updatedAt,
      authorId: q.authorId,
    })),
    ...myE.map((e) => ({
      id: e.id,
      type: "e" as const,
      title: e.name,
      projectId: e.projectId,
      status: e.qaStatus,
      date: `${e.startDate}T00:00:00Z`,
      authorId: e.leadAnalystId,
    })),
  ];
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return rows;
}

export function loadInboxReadIds(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${userId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function persistInboxReadIds(userId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}:${userId}`, JSON.stringify([...ids]));
  } catch {
    // quota / private mode
  }
}
