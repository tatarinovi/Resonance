export type ResolvedNotificationTarget =
  | { kind: "in_app"; path: string }
  | { kind: "external"; url: string };

/** Ищет legacy `#/ticket/id` в строке (в т.ч. внутри `https://…/#/ticket/…`). */
function normalizeLegacyTicketAnywhere(raw: string): string | null {
  const m = raw.match(/#\/?ticket\/(\d+)(\?[^#"'>\s]*)?/i);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  const q = m[2] ?? "";
  return `/questions/Q-${String(id).padStart(3, "0")}${q}`;
}

/**
 * Maps `notification.target_url` to SPA in-app path or external URL.
 * Same-origin absolute URLs → pathname + search + hash (legacy `#/ticket/…` → `/questions/…`).
 */
export function resolveNotificationTargetUrl(raw: string | null | undefined): ResolvedNotificationTarget | null {
  const t = (raw ?? "").trim();
  if (!t) return null;

  const legacy = normalizeLegacyTicketAnywhere(t);
  if (legacy) return { kind: "in_app", path: legacy };

  if (t.startsWith("/")) return { kind: "in_app", path: t };

  try {
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    const u = new URL(t, base);
    if (u.hash) {
      const fromHash = normalizeLegacyTicketAnywhere(u.hash);
      if (fromHash) return { kind: "in_app", path: fromHash };
    }
    if (typeof window !== "undefined" && u.origin === window.location.origin) {
      return { kind: "in_app", path: `${u.pathname}${u.search}${u.hash}`.replace(/\?$/, "") };
    }
    return { kind: "external", url: u.href };
  } catch {
    return { kind: "in_app", path: t };
  }
}
