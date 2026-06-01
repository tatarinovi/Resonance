import { describe, expect, it } from "vitest";

import {
  parseQuestionDraftJson,
  questionDraftStorageKey,
  readQuestionDraft,
  shouldPersistQuestionDraft,
  writeQuestionDraft,
} from "@/lib/questionDraftStorage";

describe("shouldPersistQuestionDraft", () => {
  const base = {
    title: "",
    description: "",
    projectId: "",
    priority: "Средний" as const,
    validationTeam: "" as const,
    epicId: null as number | null,
  };

  it("returns false for empty form", () => {
    expect(shouldPersistQuestionDraft(base)).toBe(false);
  });

  it("returns true when title trimmed length > 3", () => {
    expect(shouldPersistQuestionDraft({ ...base, title: "  abcd " })).toBe(true);
  });

  it("returns false when title trimmed length is 3", () => {
    expect(shouldPersistQuestionDraft({ ...base, title: "abc" })).toBe(false);
  });

  it("returns true when description trimmed length > 10", () => {
    expect(shouldPersistQuestionDraft({ ...base, description: `${"x".repeat(9)} y` })).toBe(true);
  });

  it("returns false when description trimmed length is 10", () => {
    expect(shouldPersistQuestionDraft({ ...base, description: "x".repeat(10) })).toBe(false);
  });

  it("returns true when project is selected", () => {
    expect(shouldPersistQuestionDraft({ ...base, projectId: "project-1" })).toBe(true);
  });

  it("returns true when epicId is a positive number", () => {
    expect(shouldPersistQuestionDraft({ ...base, epicId: 5 })).toBe(true);
  });

  it("returns false when epicId is 0", () => {
    expect(shouldPersistQuestionDraft({ ...base, epicId: 0 })).toBe(false);
  });
});

describe("parseQuestionDraftJson", () => {
  it("parses valid v1 payload", () => {
    const json = JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T12:00:00.000Z",
      title: "Hello",
      description: "",
      projectId: "",
      priority: "Средний",
      validationTeam: "qa",
    });
    const d = parseQuestionDraftJson(json);
    expect(d).not.toBeNull();
    expect(d?.title).toBe("Hello");
    expect(d?.validationTeam).toBe("qa");
  });

  it("returns null for invalid priority", () => {
    const json = JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T12:00:00.000Z",
      title: "x",
      description: "",
      projectId: "",
      priority: "Unknown",
      validationTeam: "",
    });
    expect(parseQuestionDraftJson(json)).toBeNull();
  });

  it("returns null for wrong version", () => {
    expect(parseQuestionDraftJson(JSON.stringify({ version: 2, updatedAt: "", title: "", description: "", projectId: "", priority: "Средний", validationTeam: "" }))).toBeNull();
  });
});

describe("questionDraftStorageKey", () => {
  it("includes user id", () => {
    expect(questionDraftStorageKey(42)).toContain("42");
  });
});

describe("readQuestionDraft / writeQuestionDraft", () => {
  it("round-trips through localStorage", () => {
    const uid = 999001;
    const key = questionDraftStorageKey(uid);
    localStorage.removeItem(key);

    writeQuestionDraft(uid, {
      title: "Draft title",
      description: "",
      projectId: "",
      priority: "Низкий",
      validationTeam: "front",
      epicId: null,
    });

    const read = readQuestionDraft(uid);
    expect(read?.title).toBe("Draft title");
    expect(read?.priority).toBe("Низкий");
    expect(read?.validationTeam).toBe("front");

    localStorage.removeItem(key);
  });
});
