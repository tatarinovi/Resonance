import { describe, expect, it } from "vitest";

import {
  findQaTaskDuplicate,
  QA_BULK_TASK_CHECKLISTS,
  qaTaskBaseTitle,
  qaTestingTaskTitle,
} from "@/lib/kanban-ds/qaTaskBulkCreate";
import {
  pickComponentIdByName,
  pickRequiredPriorityIdByLabel,
  pickTaskTypeIdByName,
} from "@/lib/kanban-ds/refs";

describe("QA task bulk create helpers", () => {
  it("resolves required Kanban refs by name", () => {
    expect(pickTaskTypeIdByName([{ id: 2, name: "Задача" }], "Задача")).toBe(2);
    expect(pickComponentIdByName([{ id: 7, name: "Тестирование" }], "Тестирование")).toBe(7);
    expect(pickRequiredPriorityIdByLabel([{ id: 3, name: "Средний" }], "Средний")).toBe(3);
  });

  it("keeps testing titles stable for different executors", () => {
    const members = new Map([
      [10, "Анна QA"],
      [11, "Иван QA"],
    ]);

    expect(qaTestingTaskTitle("Оплата заказа", [10], members, 1, 2)).toBe(
      "[QA] Тестирование | Оплата заказа",
    );
    expect(qaTestingTaskTitle("Оплата заказа", [11], members, 2, 2)).toBe(
      "[QA] Тестирование | Оплата заказа",
    );
  });

  it("detects exact duplicate QA task titles", () => {
    const title = qaTaskBaseTitle("test_cases", "Оплата заказа");
    const duplicate = findQaTaskDuplicate([{ id: 100, title }], title);

    expect(duplicate?.id).toBe(100);
    expect(findQaTaskDuplicate([{ id: 101, title: "[QA] Тестирование | Оплата заказа" }], title)).toBeNull();
  });

  it("defines checklists for test cases and demo tasks", () => {
    expect(QA_BULK_TASK_CHECKLISTS.test_cases).toEqual([
      "Написание тест-плана",
      "Написание тест-кейсов",
      "Сбор кейсов в тест-ран (ссылку прикрепить в комментарии)",
    ]);
    expect(QA_BULK_TASK_CHECKLISTS.demo).toEqual([
      "Подготовка контента",
      "Написание сценария в Confluence (ссылку прикрепить в комментарии)",
      "Проведение демо",
    ]);
  });
});
