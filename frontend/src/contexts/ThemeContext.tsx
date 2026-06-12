import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "resonance.theme";
const DEFAULT_THEME: ThemeMode = "dark";

interface ThemePreferenceContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  isDark: boolean;
  setDarkMode: (enabled: boolean) => void;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

export function readStoredThemePreference(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyThemePreference(theme: ThemeMode, root: HTMLElement = document.documentElement) {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function persistThemePreference(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
}

export function initializeThemePreference(): ThemeMode {
  const theme = readStoredThemePreference();
  if (typeof document !== "undefined") {
    applyThemePreference(theme);
  }
  return theme;
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const initial = readStoredThemePreference();
    if (typeof document !== "undefined") applyThemePreference(initial);
    return initial;
  });

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
    applyThemePreference(nextTheme);
    persistThemePreference(nextTheme);
  }, []);

  const setDarkMode = useCallback(
    (enabled: boolean) => {
      setTheme(enabled ? "dark" : "light");
    },
    [setTheme],
  );

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      theme,
      setTheme,
      isDark: theme === "dark",
      setDarkMode,
    }),
    [setDarkMode, setTheme, theme],
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error("useThemePreference must be used within ThemePreferenceProvider");
  }
  return ctx;
}
