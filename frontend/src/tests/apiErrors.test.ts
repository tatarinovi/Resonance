import { describe, expect, it } from "vitest";
import { messageFromApiPayload } from "@/lib/api";

describe("API error messages", () => {
  it("shows the release membership conflict instead of generic HTTP status text", () => {
    expect(messageFromApiPayload({ detail: {
      message: "Epic already belongs to another active release",
      epic_ids: [42],
    } }, "Conflict")).toBe("Epic already belongs to another active release");
  });

  it("preserves validation messages and safely falls back on unknown payloads", () => {
    expect(messageFromApiPayload({ detail: [{ msg: "Field required" }] }, "Error")).toBe("Field required");
    expect(messageFromApiPayload({ detail: { message: ["invalid"] } }, "Error")).toBe("Error");
    expect(messageFromApiPayload({ detail: { message: "  " } }, "Error")).toBe("Error");
  });
});
