import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { AuthProvider } from "@/contexts/AuthContext";
import { THEME_STORAGE_KEY, ThemePreferenceProvider } from "@/contexts/ThemeContext";
import SettingsPage from "@/pages/SettingsPage";

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={qc}>
      <ThemePreferenceProvider>
        <AuthProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </AuthProvider>
      </ThemePreferenceProvider>
    </QueryClientProvider>
  );
}

describe("SettingsPage theme switch", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("toggles dark mode from the appearance settings", () => {
    render(
      <Wrapper>
        <SettingsPage />
      </Wrapper>,
    );

    fireEvent.click(screen.getAllByTestId("settings-tab-appearance")[0]);
    const themeSwitch = screen.getByTestId("switch-dark-mode");

    expect(themeSwitch).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement).toHaveClass("dark");

    fireEvent.click(themeSwitch);

    expect(themeSwitch).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
