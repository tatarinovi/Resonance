const DEFAULT_LOCALE = "ru-RU";

function toDate(value: string | Date): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** Instant formatted in the user's local timezone (browser default). */
export function formatDateTime(
  value: string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

export function formatDayMonth(value: string | Date): string {
  const d = toDate(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(DEFAULT_LOCALE, { day: "2-digit", month: "short" });
}

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  });
}

export function formatCalendarDay(value: string | Date): string {
  const d = toDate(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatDateLong(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

export function formatTime(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString(DEFAULT_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}
