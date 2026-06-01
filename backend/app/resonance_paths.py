"""Canonical in-app paths for links in notifications, Matrix, Telegram (no hash-router)."""


def question_public_path(ticket_id: int, *, reply: bool = False) -> str:
    """SPA path to a ticket / question detail (matches frontend `ticketIdToRef`)."""
    suffix = "?reply=1" if reply else ""
    return f"/questions/Q-{int(ticket_id):03d}{suffix}"


def question_absolute_url(frontend_base: str, ticket_id: int, *, reply: bool = False) -> str:
    base = (frontend_base or "").rstrip("/")
    return f"{base}{question_public_path(ticket_id, reply=reply)}"
