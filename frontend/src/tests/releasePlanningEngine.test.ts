import { describe, expect, it } from "vitest";

import { distributeHoursFromWeights } from "@/lib/release-planning/distribute";
import { addBusinessDaysInclusive, businessDaysInclusiveBetween, isWeekendUtc, planRelease } from "@/lib/release-planning/engine";
import type { ReleasePlannerInput } from "@/lib/release-planning/types";

function baseInput(over: Partial<ReleasePlannerInput> = {}): ReleasePlannerInput {
  return {
    specDraft: "x".repeat(50),
    atrText: "y".repeat(50),
    qaEstimateHours: 90,
    qaCount: 2,
    effectiveHoursPerQaPerDay: 5.5,
    testStartDate: "2026-05-12",
    demoDate: "2026-06-01",
    freezeDate: null,
    releaseType: "minor",
    legacy: false,
    newIntegration: false,
    parallelReleasesHigh: false,
    externalDependency: false,
    extraRisksText: "",
    stageHours: distributeHoursFromWeights(90),
    ...over,
  };
}

describe("release-planning engine", () => {
  it("addBusinessDaysInclusive counts weekdays", () => {
    const mon = new Date(Date.UTC(2026, 4, 11, 12, 0, 0)); // 2026-05-11 Monday
    const end = addBusinessDaysInclusive(mon, 5);
    expect(end.getUTCDay()).not.toBe(0);
    expect(end.getUTCDay()).not.toBe(6);
    expect(end.toISOString().slice(0, 10)).toBe("2026-05-15");
  });

  it("isWeekendUtc", () => {
    expect(isWeekendUtc(new Date(Date.UTC(2026, 4, 16, 12)))).toBe(true); // Sat
    expect(isWeekendUtc(new Date(Date.UTC(2026, 4, 11, 12)))).toBe(false); // Mon
  });

  it("businessDaysInclusiveBetween", () => {
    const a = new Date(Date.UTC(2026, 4, 11, 12));
    const b = new Date(Date.UTC(2026, 4, 15, 12));
    expect(businessDaysInclusiveBetween(a, b)).toBe(5);
  });

  it("realistic = minimal + additive risk buffers", () => {
    const input = baseInput({ legacy: true, newIntegration: true, parallelReleasesHigh: true });
    const p = planRelease(input);
    expect(p.riskBufferTotal).toBe(1 + 2 + 1);
    expect(p.realisticWorkDays).toBe(p.minimalWorkDays + p.riskBufferTotal);
  });

  it("distributeHoursFromWeights sums to total", () => {
    const h = distributeHoursFromWeights(90);
    const s = Object.values(h).reduce((a, b) => a + b, 0);
    expect(s).toBe(90);
  });

  it("documentation hours do not add calendar workdays from test start", () => {
    const stageHours = { docs: 30, test: 10, stage: 0, prod: 0, demo: 0, leadership: 0 };
    const p = planRelease(baseInput({ qaEstimateHours: 40, stageHours }));
    const docsRow = p.stageRows.find((r) => r.id === "docs");
    expect(docsRow?.hours).toBe(30);
    expect(docsRow?.workDays).toBe(0);
    expect(p.timelineSegments.some((s) => s.stageId === "docs")).toBe(false);
  });

  it("each environment stage with hours gets at least one workday (even if capacity is zero)", () => {
    const stageHours = {
      docs: 0,
      test: 0,
      stage: 0,
      prod: 1,
      demo: 0,
      leadership: 0,
    };
    const p = planRelease(
      baseInput({
        qaCount: 0,
        qaEstimateHours: 1,
        stageHours,
      }),
    );
    const prod = p.stageRows.find((r) => r.id === "prod");
    expect(prod?.workDays).toBe(1);
  });

  it("warns when stage hours mismatch total", () => {
    const hours = distributeHoursFromWeights(90);
    hours.test += 10;
    const p = planRelease(baseInput({ stageHours: hours }));
    expect(p.warnings.some((w) => w.code === "hours_mismatch")).toBe(true);
  });
});
