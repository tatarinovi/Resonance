import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  THEME_STORAGE_KEY,
  ThemePreferenceProvider,
  useThemePreference,
} from "@/contexts/ThemeContext";

function ThemeProbe() {
  const { theme, isDark, setDarkMode } = useThemePreference();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button type="button" data-testid="theme-toggle" onClick={() => setDarkMode(!isDark)}>
        toggle
      </button>
    </div>
  );
}

describe("ThemePreferenceProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("uses dark mode by default", () => {
    render(
      <ThemePreferenceProvider>
        <ThemeProbe />
      </ThemePreferenceProvider>,
    );

    expect(screen.getByTestId("theme-value")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("persists light mode and removes the dark class", () => {
    render(
      <ThemePreferenceProvider>
        <ThemeProbe />
      </ThemePreferenceProvider>,
    );

    fireEvent.click(screen.getByTestId("theme-toggle"));

    expect(screen.getByTestId("theme-value")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
