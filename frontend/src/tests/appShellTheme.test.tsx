import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY, ThemePreferenceProvider } from "@/contexts/ThemeContext";
import { AppShell } from "@/components/layout/AppShell";

vi.mock("sonner", () => ({
  Toaster: ({ theme }: { theme: string }) => <div data-testid="toaster-theme">{theme}</div>,
}));

vi.mock("@/data/_bridge", () => ({
  useDataBridgeVersion: () => 0,
}));

vi.mock("@/lib/useEventStream", () => ({
  useEventStream: () => "offline",
}));

vi.mock("@/components/layout/Header", () => ({
  Header: () => <header data-testid="mock-header" />,
}));

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <aside data-testid="mock-sidebar" />,
}));

describe("AppShell theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("passes the active light theme to the toaster", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    render(
      <ThemePreferenceProvider>
        <AppShell>
          <div>content</div>
        </AppShell>
      </ThemePreferenceProvider>,
    );

    expect(screen.getByTestId("toaster-theme")).toHaveTextContent("light");
  });
});
