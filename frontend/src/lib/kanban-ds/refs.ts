function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function normalizedRefName(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findIdByName(rows: unknown[], predicate: (name: string) => boolean): number | null {
  for (const row of rows) {
    const o = asRecord(row);
    const id = Number(o?.id);
    const name = normalizedRefName(o?.name ?? o?.title);
    if (Number.isFinite(id) && id > 0 && name && predicate(name)) return id;
  }
  return null;
}

export function pickFirstTaskTypeId(types: unknown[]): number {
  for (const t of types) {
    const o = asRecord(t);
    const id = Number(o?.id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return 1;
}

export function pickTaskTypeIdByName(types: unknown[], label: "Задача"): number | null {
  const want = normalizedRefName(label);
  return findIdByName(
    types,
    (name) =>
      name === want ||
      name === "task" ||
      name.includes("задач") ||
      name.includes("новая функциональ") ||
      name.includes("release") ||
      name.includes("backlog"),
  );
}

export function pickPriorityIdByLabel(priorities: unknown[], label: string): number {
  const want = label.toLowerCase();
  for (const p of priorities) {
    const o = asRecord(p);
    const name = String(o?.name ?? "").toLowerCase();
    if (want.includes("высок") && (name.includes("высок") || name.includes("high"))) return Number(o?.id) || 0;
    if (want.includes("низк") && (name.includes("низк") || name.includes("low"))) return Number(o?.id) || 0;
    if (want.includes("сред") && (name.includes("сред") || name.includes("medium") || name.includes("normal")))
      return Number(o?.id) || 0;
  }
  const first = asRecord(priorities[0]);
  return Number(first?.id) || 1;
}

export function pickRequiredPriorityIdByLabel(priorities: unknown[], label: "Средний"): number | null {
  return findIdByName(
    priorities,
    (name) => name.includes("сред") || name.includes("medium") || name.includes("normal"),
  );
}

export function pickFirstComponentId(components: unknown[]): number | null {
  for (const c of components) {
    const o = asRecord(c);
    const id = Number(o?.id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

/** Справочник компонентов Kanban (id → отображаемое имя) для списка задач и маппера. */
export function mapKanbanComponentsToIdNameMap(components: unknown): Map<number, string> {
  const m = new Map<number, string>();
  if (!Array.isArray(components)) return m;
  for (const c of components) {
    const o = asRecord(c);
    if (!o) continue;
    const id = Number(o.id);
    const name = String(o.name ?? o.title ?? "").trim();
    if (Number.isFinite(id) && id > 0 && name) m.set(id, name);
  }
  return m;
}

export function pickProjectComponentId(project: unknown): number | null {
  const p = asRecord(project);
  const flow = asRecord(p?.flow);
  const raw =
    flow?.possibleProjectComponents ??
    flow?.possible_project_components ??
    p?.possibleProjectComponents ??
    p?.components;
  if (!Array.isArray(raw)) return null;
  for (const c of raw) {
    const o = asRecord(c);
    const id = Number(o?.id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

export function pickComponentIdByName(components: unknown[], label: "Тестирование"): number | null {
  const want = normalizedRefName(label);
  return findIdByName(components, (name) => name === want || name.includes("тест") || name.includes("qa"));
}
