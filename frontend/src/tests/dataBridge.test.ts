import { describe, expect, it } from "vitest";

import { getDataVersion } from "@/data/_bridge";
import { getQuestions, setQuestions } from "@/data/questions";
import { getUsers, setUsers } from "@/data/users";
import type { ApiTicket, ApiUser } from "@/lib/types";

describe("data bridge stores", () => {
  it("setUsers populates the proxied users array and bumps the version", () => {
    const before = getDataVersion();
    const users: ApiUser[] = [
      {
        id: 1,
        username: "alice",
        role: "admin",
        is_approved: true,
        project_ids: [1],
        created_at: "2025-01-01T10:00:00Z",
      },
    ];

    setUsers(users);

    const stored = getUsers();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("U-001");
    expect(stored[0].role).toBe("Админ");
    expect(getDataVersion()).toBeGreaterThan(before);
  });

  it("setQuestions remaps tickets via mapApiTicketToRefQuestion", () => {
    const tickets: ApiTicket[] = [
      {
        id: 1,
        project_id: 1,
        epic_id: null,
        status: "answered",
        title: "Q1",
        description: null,
        priority: "low",
        sla_hours: 0,
        due_at: null,
        author_id: 1,
        author_username: "alice",
        assignee_id: 1,
        assignee_username: "alice",
        origin_event_id: "ev",
        expert_event_id: null,
        data_json: {},
        messages: [],
        attachments: [],
        events: [],
        created_at: "2025-01-01T10:00:00Z",
        updated_at: "2025-01-01T10:00:00Z",
      },
    ];

    setQuestions(tickets);

    const stored = getQuestions();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("Q-001");
    expect(stored[0].status).toBe("Ожидает автора");
    expect(stored[0].priority).toBe("Низкий");
  });
});
