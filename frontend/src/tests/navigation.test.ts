import { describe, expect, it } from "vitest";

import {
  OVERFLOW_NAVIGATION_SECTIONS,
  VISIBLE_NAVIGATION_SECTIONS,
  shouldShowFocusNavigationItem,
} from "@/lib/navigation";

describe("navigation sections", () => {
  it("keeps daily work sections visible and secondary sections in overflow", () => {
    expect(VISIBLE_NAVIGATION_SECTIONS.map((section) => section.label)).toEqual([
      "Пространство",
      "Работа",
      "Фокус",
    ]);
    expect(OVERFLOW_NAVIGATION_SECTIONS.map((section) => section.label)).toEqual([
      "Наблюдение",
      "Система",
    ]);
  });

  it("shows only default focus links until filtered views have results", () => {
    const empty = { expert: 0, waiting: 0, blocked: 0 };
    expect(shouldShowFocusNavigationItem("/questions?view=mine", empty)).toBe(true);
    expect(shouldShowFocusNavigationItem("/questions?view=stale", empty)).toBe(true);
    expect(shouldShowFocusNavigationItem("/questions?view=expert", empty)).toBe(false);
    expect(shouldShowFocusNavigationItem("/questions?view=waiting", empty)).toBe(false);
    expect(shouldShowFocusNavigationItem("/questions?view=blocked", empty)).toBe(false);

    expect(shouldShowFocusNavigationItem("/questions?view=expert", { ...empty, expert: 1 })).toBe(true);
    expect(shouldShowFocusNavigationItem("/questions?view=waiting", { ...empty, waiting: 1 })).toBe(true);
    expect(shouldShowFocusNavigationItem("/questions?view=blocked", { ...empty, blocked: 1 })).toBe(true);
  });
});
