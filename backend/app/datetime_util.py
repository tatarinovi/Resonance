"""Helpers for JSON timestamps: DB stores naive UTC; clients need explicit offset."""

from __future__ import annotations

from datetime import datetime, timezone


def utc_iso_z(dt: datetime | None) -> str | None:
    """Serialize an instant as RFC 3339 UTC ending with Z (JS parses as UTC, UI shows local)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")
