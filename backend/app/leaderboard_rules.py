"""Season-versioned QA contribution rules; business months use Moscow like digests."""
from copy import deepcopy
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .models import UserRole

BUSINESS_TZ = ZoneInfo("Europe/Moscow")
RULES = {
    "version": 1,
    "timezone": "Europe/Moscow",
    "events": {
        "QA_ACTUAL_MATCH": {"points": 10, "label": "QA-время совпало с оценкой эпика"},
        "QA_LEAD_MATCH": {"points": 5, "label": "Оценка совпала с Lead QA"},
        "BUG_DEV_CONFIRMED": {"points": 4, "label": "Подтверждённый DEV bug"},
        "BUG_STAGE_CONFIRMED": {"points": 2, "label": "Подтверждённый STAGE bug"},
        "TEST_CASE_CREATED": {"points": 1, "label": "Создан активный тест-кейс"},
    },
    "execution_tiers": [{"minimum": low, "maximum": high, "points": points}
                        for low, high, points in [(1, 25, 1), (26, 75, 2), (76, 150, 3), (151, 250, 4), (251, None, 5)]],
    "execution_statuses": ["passed", "failed", "blocked"],
}


def eligible(user) -> bool:
    return user.role == UserRole.EMPLOYEE and user.direction == "qa" and user.workspace == "ds"


def season_key(value: datetime | None = None) -> str:
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(BUSINESS_TZ).strftime("%Y-%m")


def season_rules() -> dict:
    return deepcopy(RULES)


def execution_points(count: int, rules: dict) -> int:
    return next((tier["points"] for tier in rules["execution_tiers"]
                 if count >= tier["minimum"] and (tier["maximum"] is None or count <= tier["maximum"])), 0)
