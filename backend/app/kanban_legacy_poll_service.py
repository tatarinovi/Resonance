"""Legacy per-user Kanban polling is intentionally disabled.

Kanban credentials are now global and administrator-managed. The former poll
was intrinsically user-scoped, so it must not send requests or notifications.
"""

from __future__ import annotations


def kanban_legacy_poll_once() -> None:
    """Compatibility no-op retained for callers during the transition."""
    return None
