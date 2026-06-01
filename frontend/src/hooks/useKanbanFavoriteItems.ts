import { useCallback, useEffect, useMemo, useState } from "react";

function readFavoriteKeys(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export function useKanbanFavoriteItems(storageKey: string) {
  const [keys, setKeys] = useState<string[]>(() => readFavoriteKeys(storageKey));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey || e.key === null) setKeys(readFavoriteKeys(storageKey));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const toggleFavorite = useCallback(
    (key: string) => {
      setKeys((prev) => {
        const next = prev.includes(key) ? prev.filter((x) => x !== key) : [key, ...prev];
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore quota / private mode */
        }
        return next;
      });
    },
    [storageKey],
  );

  const favoriteSet = useMemo(() => new Set(keys), [keys]);
  const isFavorite = useCallback((key: string) => favoriteSet.has(key), [favoriteSet]);

  const orderItems = useCallback(
    <T,>(items: T[], getKey: (item: T) => string): T[] => {
      const byKey = new Map(items.map((item) => [getKey(item), item] as const));
      const favorites: T[] = [];
      for (const key of keys) {
        const item = byKey.get(key);
        if (item) favorites.push(item);
      }
      const favoriteKeys = new Set(favorites.map(getKey));
      return [...favorites, ...items.filter((item) => !favoriteKeys.has(getKey(item)))];
    },
    [keys],
  );

  return { favoriteKeys: keys, toggleFavorite, isFavorite, orderItems };
}

export const KANBAN_FAVORITE_EPICS_STORAGE_KEY = "resonance:kanban-favorite-epic-keys";
export const KANBAN_FAVORITE_USERS_STORAGE_KEY = "resonance:kanban-favorite-user-ids";
