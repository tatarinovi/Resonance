import type { CSSProperties } from "react";

/** CSS variables for the task detail «operational state» select (dark enterprise UI). */
export type DetailStageThemeVars = CSSProperties & Record<`--detail-stage-${string}`, string>;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function fallbackFromColumnColor(fallbackHex: string): DetailStageThemeVars {
  const rgb = hexToRgb(fallbackHex) ?? { r: 139, g: 148, b: 158 };
  const { r, g, b } = rgb;
  return {
    "--detail-stage-bg": `rgba(${r},${g},${b},0.1)`,
    "--detail-stage-bg-hover": `rgba(${r},${g},${b},0.16)`,
    "--detail-stage-border": `rgba(${Math.min(255, r + 28)},${Math.min(255, g + 28)},${Math.min(255, b + 28)},0.42)`,
    "--detail-stage-border-hover": `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},0.55)`,
    "--detail-stage-fg": "var(--kanban-text)",
    "--detail-stage-accent": fallbackHex,
    "--detail-stage-chevron": "rgba(230,238,244,0.45)",
  };
}

/**
 * Maps board column title to muted enterprise tones (Linear / Jira-style).
 * Falls back to column color from the board when no keyword matches.
 */
export function resolveDetailStageThemeVars(stageTitle: string, columnColorFallback: string): DetailStageThemeVars {
  const t = stageTitle.trim().toLowerCase();

  if (/блок|block|imped|заблок/i.test(t)) {
    return {
      "--detail-stage-bg": "rgba(248, 81, 73, 0.08)",
      "--detail-stage-bg-hover": "rgba(248, 81, 73, 0.12)",
      "--detail-stage-border": "rgba(248, 81, 73, 0.32)",
      "--detail-stage-border-hover": "rgba(248, 81, 73, 0.45)",
      "--detail-stage-fg": "#f0b4b0",
      "--detail-stage-accent": "#da6363",
      "--detail-stage-chevron": "rgba(240,180,176,0.55)",
    };
  }
  if (/\bqa\b|тест|testing|к\s*тестированию|в\s*тестировании/i.test(t)) {
    return {
      "--detail-stage-bg": "rgba(57, 197, 207, 0.09)",
      "--detail-stage-bg-hover": "rgba(57, 197, 207, 0.14)",
      "--detail-stage-border": "rgba(57, 197, 207, 0.34)",
      "--detail-stage-border-hover": "rgba(57, 197, 207, 0.48)",
      "--detail-stage-fg": "#a5dde4",
      "--detail-stage-accent": "#39c5cf",
      "--detail-stage-chevron": "rgba(165,221,228,0.55)",
    };
  }
  if (/ревью|review|проверк|code\s*review|на\s*проверк/i.test(t)) {
    return {
      "--detail-stage-bg": "rgba(210, 153, 34, 0.1)",
      "--detail-stage-bg-hover": "rgba(210, 153, 34, 0.15)",
      "--detail-stage-border": "rgba(210, 153, 34, 0.38)",
      "--detail-stage-border-hover": "rgba(210, 153, 34, 0.52)",
      "--detail-stage-fg": "#e3c08a",
      "--detail-stage-accent": "#c9982f",
      "--detail-stage-chevron": "rgba(227,192,138,0.55)",
    };
  }
  if (/в\s*работе|in\s*progress|\bwip\b|\bdoing\b|разработ/i.test(t)) {
    return {
      "--detail-stage-bg": "rgba(163, 113, 247, 0.1)",
      "--detail-stage-bg-hover": "rgba(163, 113, 247, 0.16)",
      "--detail-stage-border": "rgba(163, 113, 247, 0.36)",
      "--detail-stage-border-hover": "rgba(163, 113, 247, 0.5)",
      "--detail-stage-fg": "#d4c4f5",
      "--detail-stage-accent": "var(--kanban-accent-emphasis)",
      "--detail-stage-chevron": "rgba(212,196,245,0.55)",
    };
  }
  if (
    /выполнен|выполнено|закрыт|released|resolved|(^|\s)done(\s|$)|\bclosed\b|^готово$|готовы?\s*к\s*выклад/i.test(
      t,
    )
  ) {
    return {
      "--detail-stage-bg": "rgba(63, 185, 80, 0.09)",
      "--detail-stage-bg-hover": "rgba(63, 185, 80, 0.14)",
      "--detail-stage-border": "rgba(63, 185, 80, 0.36)",
      "--detail-stage-border-hover": "rgba(63, 185, 80, 0.5)",
      "--detail-stage-fg": "#8ddb9a",
      "--detail-stage-accent": "#3fb950",
      "--detail-stage-chevron": "rgba(141,219,154,0.55)",
    };
  }
  if (/нов(ая|ые|ых)?|backlog|очеред|to\s*do|\btodo\b/i.test(t)) {
    return {
      "--detail-stage-bg": "rgba(88, 166, 255, 0.08)",
      "--detail-stage-bg-hover": "rgba(88, 166, 255, 0.12)",
      "--detail-stage-border": "rgba(88, 166, 255, 0.3)",
      "--detail-stage-border-hover": "rgba(88, 166, 255, 0.44)",
      "--detail-stage-fg": "#b6d6ff",
      "--detail-stage-accent": "#58a6ff",
      "--detail-stage-chevron": "rgba(182,214,255,0.5)",
    };
  }

  return fallbackFromColumnColor(columnColorFallback);
}

export type PriorityPillTone = {
  label: string;
  className: string;
};

/** Compact priority copy + Tailwind utility bundle for the detail header pill. */
export function detailPriorityPill(priority: string): PriorityPillTone {
  const p = priority.trim();
  if (p === "Низкий") {
    return {
      label: "Низкий",
      className:
        "border border-solid border-slate-300 bg-slate-100 text-slate-600 dark:border-[var(--kanban-border)] dark:bg-[var(--kanban-hover)] dark:text-slate-300",
    };
  }
  if (p === "Средний") {
    return {
      label: "Средний",
      className:
        "border border-solid border-amber-300 bg-amber-50 text-amber-700 dark:border-[#6b5420]/80 dark:bg-[#2a2312] dark:text-[#d4a85c]",
    };
  }
  if (p === "Высокий") {
    return {
      label: "Высокий",
      className:
        "border border-solid border-orange-300 bg-orange-50 text-orange-700 dark:border-[#8b4a1a]/85 dark:bg-[#2a1a0f] dark:text-[#e8a06a]",
    };
  }
  if (/критич/i.test(p)) {
    return {
      label: p.length > 14 ? `${p.slice(0, 12)}...` : p,
      className:
        "border border-solid border-red-300 bg-red-50 text-red-700 dark:border-[#8b3a3a]/90 dark:bg-[#2a1414] dark:text-[#f0a8a8]",
    };
  }
  return {
    label: p || "—",
    className: "border border-solid border-slate-300 bg-slate-100 text-slate-600 dark:border-[var(--kanban-border)] dark:bg-[var(--kanban-hover)] dark:text-slate-300",
  };
}
