"""Shared Jira vocabulary for release counters, filtering and risk assessment."""
from .config import get_settings


def normalized(value):
    return " ".join(str(value or "").casefold().split())


GROUP_LABELS = {"todo": "К работе", "development": "В разработке", "review": "Проверка", "blocked": "Заблокировано", "done": "Завершено", "unknown": "Не распределено"}
_STATUS_GROUPS = {
    "todo": {"новое", "новый", "аналитика", "готово к разработке", "new", "open", "to do", "todo", "analysis", "ready for development"},
    "development": {"разработка", "в разработке", "development", "in development", "in progress"},
    "review": {"исправлено на dev", "в тестировании", "контроль", "fixed on dev", "testing", "in testing", "review", "in review", "control"},
    "blocked": {"тестирование заблокировано", "заблокировано", "blocked", "testing blocked"},
    "done": {"закрыт", "закрыто", "closed", "done"},
}


def status_group(status, category=None):
    category = normalized(category)
    if category == "done":
        return "done"
    status = normalized(status)
    for group, values in _STATUS_GROUPS.items():
        if status in values:
            # A fresh nonterminal category wins over a legacy terminal label.
            if group == "done" and category in {"new", "indeterminate"}:
                break
            return group
    return {"new": "todo", "indeterminate": "development"}.get(category, "unknown")


def priority_group(value):
    value = normalized(value)
    settings = get_settings()
    for group, configured in (("blocker", settings.jira_blocker_priority_names), ("critical", settings.jira_critical_priority_names)):
        if value in {normalized(item) for item in configured.split(",")}:
            return group
    return {"high": "high", "высокий": "high", "medium": "medium", "средний": "medium", "low": "low", "низкий": "low"}.get(value, "unknown")


def issue_rank(issue):
    return (status_group(issue.status, issue.status_category) == "done", {"blocker": 0, "critical": 1, "high": 2, "medium": 3, "low": 4}.get(priority_group(issue.priority), 5), issue.jira_issue_key)


def latest_issues(rows):
    result = {}
    for row in sorted(rows, key=lambda r: (r.refreshed_at, r.id or 0)):
        result[row.jira_issue_key] = row
    return result
