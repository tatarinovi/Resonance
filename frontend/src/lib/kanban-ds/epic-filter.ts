/** Подпись опции эпика в фильтрах: имя + id в конце для сопоставления с `task.epicId`. */
export function formatEpicFilterOption(epicId: number, name: string): string {
  return `${name} (#${epicId})`;
}

export function parseEpicIdFromFilterOption(opt: string): number | null {
  const m = /\(#(\d+)\)\s*$/.exec(opt);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}
