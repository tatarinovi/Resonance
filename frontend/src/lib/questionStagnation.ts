/** Часы с момента последнего обновления тикета (`updated_at`) — прокси «без движения». */
export function hoursSinceUpdated(updatedAtIso: string, nowMs = Date.now()): number {
  const t = new Date(updatedAtIso).getTime();
  if (!Number.isFinite(t)) return Number.NaN;
  return Math.max(0, (nowMs - t) / 3_600_000);
}

export function formatStagnationBadgeLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1 / 60) return "<1м";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}м`;
  if (hours < 24) return `${Math.floor(hours)}ч`;
  const d = Math.floor(hours / 24);
  const rh = Math.floor(hours % 24);
  return rh === 0 ? `${d}д` : `${d}д ${rh}ч`;
}

export function stagnationBadgeColorClass(hours: number): string {
  if (!Number.isFinite(hours)) return "bg-muted/40 text-muted-foreground border-border";
  if (hours > 48) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (hours > 24) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
}
