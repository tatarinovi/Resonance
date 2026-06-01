import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "resonance:kanban-favorite-project-slugs";

function readSlugs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export function orderKanbanProjectsByFavorites<T extends { slug: string; name: string }>(items: T[], favoriteSlugs: string[]): T[] {
  const bySlug = new Map(items.map((p) => [p.slug, p] as const));
  const favorites: T[] = [];
  for (const s of favoriteSlugs) {
    const row = bySlug.get(s);
    if (row) favorites.push(row);
  }
  const favSet = new Set(favorites.map((p) => p.slug));
  const rest = items.filter((p) => !favSet.has(p.slug));
  rest.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return [...favorites, ...rest];
}

export function useKanbanFavoriteProjectSlugs() {
  const [slugs, setSlugs] = useState<string[]>(() => readSlugs());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setSlugs(readSlugs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleFavorite = useCallback((slug: string) => {
    setSlugs((prev) => {
      const idx = prev.indexOf(slug);
      const next = idx >= 0 ? prev.filter((s) => s !== slug) : [slug, ...prev];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }, []);

  const favoriteSet = useMemo(() => new Set(slugs), [slugs]);

  const isFavorite = useCallback((slug: string) => favoriteSet.has(slug), [favoriteSet]);

  const orderProjects = useCallback(
    <T extends { slug: string; name: string }>(items: T[]) => orderKanbanProjectsByFavorites(items, slugs),
    [slugs],
  );

  return { favoriteSlugs: slugs, toggleFavorite, isFavorite, orderProjects };
}
