import { describe, expect, it } from "vitest";

import {
  buildSavedViewTicketParams,
  normalizeQuestionView,
  questionSortToApi,
} from "@/lib/questionViews";

describe("question saved views", () => {
  it("falls back to the full questions view for unknown query values", () => {
    expect(normalizeQuestionView("missing").id).toBe("all");
    expect(normalizeQuestionView(null).id).toBe("all");
  });

  it("maps the mine view to the current assignee without changing routes or APIs", () => {
    const view = normalizeQuestionView("mine");
    const params = buildSavedViewTicketParams(view, {
      meId: 42,
      sort: view.sort,
      page: 2,
      pageSize: 25,
    });

    expect(params.assignee_id).toBe(42);
    expect(params.page).toBe(2);
    expect(params.page_size).toBe(25);
  });

  it("keeps stale sorting as oldest updated first", () => {
    expect(questionSortToApi("stagnation")).toBe("updated_at");
    expect(questionSortToApi("date")).toBe("-updated_at");
  });

  it("uses a local first page for the blocked view", () => {
    const view = normalizeQuestionView("blocked");
    const params = buildSavedViewTicketParams(view, {
      meId: 42,
      sort: view.sort,
      page: 3,
      pageSize: 25,
    });

    expect(params.page).toBe(1);
    expect(params.page_size).toBe(100);
  });
});
