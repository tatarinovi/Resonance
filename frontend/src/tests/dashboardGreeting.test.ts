import { describe, expect, it } from "vitest";

import {
  dashboardHourBucket,
  getDashboardGreeting,
} from "@/lib/dashboardGreeting";

describe("dashboardHourBucket", () => {
  it("maps hours to plan buckets", () => {
    expect(dashboardHourBucket(4)).toBe("night");
    expect(dashboardHourBucket(5)).toBe("morning");
    expect(dashboardHourBucket(11)).toBe("morning");
    expect(dashboardHourBucket(12)).toBe("day");
    expect(dashboardHourBucket(16)).toBe("day");
    expect(dashboardHourBucket(17)).toBe("evening");
    expect(dashboardHourBucket(22)).toBe("evening");
    expect(dashboardHourBucket(23)).toBe("night");
    expect(dashboardHourBucket(0)).toBe("night");
  });
});

describe("getDashboardGreeting", () => {
  it("is stable for the same inputs", () => {
    const now = new Date("2026-03-10T14:30:00");
    const a = getDashboardGreeting("alice", now);
    const b = getDashboardGreeting("alice", now);
    expect(a).toBe(b);
  });

  it("includes display name for latin username", () => {
    const now = new Date("2026-03-10T14:30:00");
    expect(getDashboardGreeting("admin", now)).toContain("admin");
  });

  it("maps Guest to Гость in the greeting", () => {
    const now = new Date("2026-03-10T09:00:00");
    expect(getDashboardGreeting("Guest", now)).toContain("Гость");
    expect(getDashboardGreeting("Guest", now)).not.toContain("Guest");
  });

  it("uses night or general pool at 03:00 local", () => {
    const now = new Date("2026-06-01T03:00:00");
    const text = getDashboardGreeting("nightuser", now);
    expect(text).toContain("nightuser");
    expect(text.length).toBeGreaterThan(8);
  });
});
