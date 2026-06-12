import { describe, expect, it } from "vitest";

import {
  PRIORITY_FROM_REF,
  QA_STATUS_FROM_REF,
  STATUS_FROM_REF,
  epicIdToRef,
  mapActivity,
  mapApiTicketToRefQuestion,
  refIdToNumeric,
  ticketIdToRef,
  userIdToRef,
} from "@/lib/mappers";
import type { ApiActivityEvent, ApiTicket } from "@/lib/types";

describe("id helpers", () => {
  it("round-trips numeric IDs", () => {
    expect(refIdToNumeric(userIdToRef(7))).toBe(7);
    expect(refIdToNumeric(ticketIdToRef(123))).toBe(123);
    expect(refIdToNumeric(epicIdToRef(42))).toBe(42);
  });
});

describe("reverse maps", () => {
  it("priority maps cover all four levels", () => {
    expect(PRIORITY_FROM_REF["Критический"]).toBe("critical");
    expect(PRIORITY_FROM_REF["Высокий"]).toBe("high");
    expect(PRIORITY_FROM_REF["Средний"]).toBe("medium");
    expect(PRIORITY_FROM_REF["Низкий"]).toBe("low");
  });

  it("status maps cover all six statuses", () => {
    expect(STATUS_FROM_REF["На проверке"]).toBe("pending_approval");
    expect(STATUS_FROM_REF["Закрыт"]).toBe("closed");
  });

  it("qa-status maps to backend keys", () => {
    expect(QA_STATUS_FROM_REF["Подготовка тест-плана"]).toBe("draft");
    expect(QA_STATUS_FROM_REF["В тестировании"]).toBe("in_testing");
    expect(QA_STATUS_FROM_REF["Закрыто"]).toBe("closed");
  });
});

describe("mapApiTicketToRefQuestion", () => {
  it("translates messages, attachments, and metadata", () => {
    const ticket: ApiTicket = {
      id: 5,
      project_id: 2,
      epic_id: null,
      status: "pending_approval",
      title: "Test",
      description: "Body",
      priority: "high",
      sla_hours: 12,
      due_at: null,
      author_id: 9,
      author_username: "john",
      assignee_id: 11,
      assignee_username: "jane",
      origin_event_id: "ev-1",
      expert_event_id: null,
      data_json: {},
      messages: [
        {
          id: 1,
          ticket_id: 5,
          author_id: 9,
          author_username: "john",
          body: "hi",
          kind: "message",
          created_at: "2025-01-01T10:00:00Z",
          edited_at: null,
        },
      ],
      attachments: [
        {
          id: 1,
          name: "spec.pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          url: "https://example.com/spec.pdf",
          created_at: "2025-01-01T10:00:00Z",
        },
      ],
      events: [],
      created_at: "2025-01-01T10:00:00Z",
      updated_at: "2025-01-01T10:00:00Z",
    };

    const ref = mapApiTicketToRefQuestion(ticket);

    expect(ref.id).toBe("Q-005");
    expect(ref.title).toBe("Test");
    expect(ref.priority).toBe("Высокий");
    expect(ref.status).toBe("На проверке");
    expect(ref.thread).toHaveLength(1);
    expect(ref.thread[0].text).toBe("hi");
    expect(ref.attachments[0].name).toBe("spec.pdf");
    expect(ref.attachments[0].url).toBe("https://example.com/spec.pdf");
    expect(ref.attachments[0].mimeType).toBe("application/pdf");
    expect(ref.attachments[0].type).toBe("pdf");
  });
});

describe("mapActivity", () => {
  it("translates backend question statuses in activity actions", () => {
    const event: ApiActivityEvent = {
      id: "te-1",
      type: "status",
      user_id: 7,
      username: "admin",
      action: "изменил статус → forwarded",
      target_id: 5,
      target_type: "question",
      target_title: "Test question",
      project_id: 1,
      date: "2025-01-01T10:00:00Z",
    };

    expect(mapActivity(event).action).toBe("изменил статус → У эксперта");
  });
});
