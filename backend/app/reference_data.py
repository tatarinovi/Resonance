from __future__ import annotations

from .models import EpicQAStatus, EpicStatus, TestRunEnvironment, TestRunStatus, TicketPriority, TicketStatus, UserRole


ROLE_LABELS = {
    UserRole.ADMIN.value: "Админ",
    UserRole.COORDINATOR.value: "Координатор",
    UserRole.EXPERT.value: "Эксперт",
    UserRole.EMPLOYEE.value: "Разработчик",
    UserRole.MANAGER.value: "Координатор",
}

ROLE_DIRECTIONS = {
    UserRole.EXPERT.value: [
        {"value": "analytics", "label": "Аналитик"},
        {"value": "design", "label": "Дизайнер"},
    ],
    UserRole.COORDINATOR.value: [
        {"value": "back", "label": "Backend"},
        {"value": "front", "label": "Frontend"},
        {"value": "qa", "label": "QA"},
    ],
    UserRole.EMPLOYEE.value: [
        {"value": "back", "label": "Backend"},
        {"value": "front", "label": "Frontend"},
        {"value": "qa", "label": "QA"},
    ],
    UserRole.ADMIN.value: [],
    UserRole.MANAGER.value: [
        {"value": "back", "label": "Backend"},
        {"value": "front", "label": "Frontend"},
        {"value": "qa", "label": "QA"},
    ],
}

QUESTION_STATUS_LABELS = {
    TicketStatus.PENDING_APPROVAL.value: "На проверке",
    TicketStatus.FORWARDED.value: "У эксперта",
    TicketStatus.RETURNED.value: "На уточнении",
    TicketStatus.ANSWERED.value: "Ожидает автора",
    TicketStatus.CLOSED.value: "Закрыт",
    TicketStatus.CANCELLED.value: "Отменён",
}

QUESTION_PRIORITY_LABELS = {
    TicketPriority.CRITICAL.value: "Критический",
    TicketPriority.HIGH.value: "Высокий",
    TicketPriority.MEDIUM.value: "Средний",
    TicketPriority.LOW.value: "Низкий",
}

EPIC_STATUS_LABELS = {
    EpicStatus.NEW.value: "Новый",
    EpicStatus.IN_PROGRESS.value: "В работе",
    EpicStatus.RELEASED.value: "Релиз",
}

QA_STATUS_LABELS = {
    EpicQAStatus.DRAFT.value: "Подготовка тест-плана",
    EpicQAStatus.IN_TESTING.value: "В тестировании",
    EpicQAStatus.BLOCKED.value: "Заблокировано",
    EpicQAStatus.TEST_COMPLETE.value: "TEST complete",
    EpicQAStatus.STAGE_COMPLETE.value: "STAGE complete",
    EpicQAStatus.PROD_COMPLETE.value: "PROD complete",
    EpicQAStatus.CLOSED.value: "Закрыто",
}

QA_STATUS_TRANSITIONS = {
    EpicQAStatus.DRAFT.value: [{"value": EpicQAStatus.IN_TESTING.value, "label": "Начать тестирование"}],
    EpicQAStatus.IN_TESTING.value: [
        {"value": EpicQAStatus.BLOCKED.value, "label": "Заблокировать"},
        {"value": EpicQAStatus.TEST_COMPLETE.value, "label": "TEST complete"},
        {"value": EpicQAStatus.STAGE_COMPLETE.value, "label": "STAGE complete"},
        {"value": EpicQAStatus.PROD_COMPLETE.value, "label": "PROD complete"},
    ],
    EpicQAStatus.BLOCKED.value: [{"value": EpicQAStatus.IN_TESTING.value, "label": "Вернуть в тестирование"}],
    EpicQAStatus.TEST_COMPLETE.value: [{"value": EpicQAStatus.IN_TESTING.value, "label": "Начать STAGE"}],
    EpicQAStatus.STAGE_COMPLETE.value: [{"value": EpicQAStatus.IN_TESTING.value, "label": "Начать PROD"}],
    EpicQAStatus.PROD_COMPLETE.value: [{"value": EpicQAStatus.CLOSED.value, "label": "Закрыть QA"}],
    EpicQAStatus.CLOSED.value: [],
}

TEST_RUN_ENVIRONMENT_LABELS = {
    TestRunEnvironment.TEST.value: "TEST",
    TestRunEnvironment.STAGE.value: "STAGE",
    TestRunEnvironment.PROD.value: "PROD",
}

TEST_RUN_STATUS_LABELS = {
    TestRunStatus.PLANNED.value: "Запланирован",
    TestRunStatus.RUNNING.value: "Выполняется",
    TestRunStatus.PASSED.value: "Успешно",
    TestRunStatus.FAILED.value: "Упал",
    TestRunStatus.SKIPPED.value: "Пропущен",
}

MATRIX_DIRECTION_LABELS = {
    "analytics": "Аналитики",
    "design": "Дизайнеры",
    "back": "Backend",
    "front": "Frontend",
    "qa": "QA",
}

DIGEST_STATUS_ORDER = [
    TicketStatus.FORWARDED.value,
    TicketStatus.RETURNED.value,
    TicketStatus.ANSWERED.value,
]


def option_list(labels: dict[str, str], *, values: list[str] | None = None) -> list[dict[str, str]]:
    ordered = values or list(labels.keys())
    return [{"value": value, "label": labels[value]} for value in ordered if value in labels]


def question_status_label(status: TicketStatus | str) -> str:
    value = status.value if isinstance(status, TicketStatus) else str(status)
    return QUESTION_STATUS_LABELS.get(value, value)


def reference_payload() -> dict:
    public_roles = [UserRole.ADMIN.value, UserRole.COORDINATOR.value, UserRole.EXPERT.value, UserRole.EMPLOYEE.value]
    return {
        "roles": option_list(ROLE_LABELS, values=public_roles),
        "role_directions": ROLE_DIRECTIONS,
        "question_statuses": option_list(QUESTION_STATUS_LABELS),
        "question_priorities": option_list(QUESTION_PRIORITY_LABELS),
        "epic_statuses": option_list(EPIC_STATUS_LABELS),
        "qa_statuses": option_list(QA_STATUS_LABELS),
        "qa_status_transitions": QA_STATUS_TRANSITIONS,
        "test_run_environments": option_list(TEST_RUN_ENVIRONMENT_LABELS),
        "test_run_statuses": option_list(TEST_RUN_STATUS_LABELS),
        "matrix_directions": option_list(MATRIX_DIRECTION_LABELS),
        "digest_statuses": option_list(QUESTION_STATUS_LABELS, values=DIGEST_STATUS_ORDER),
    }
