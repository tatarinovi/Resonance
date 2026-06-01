from __future__ import annotations


DIRECTION_ALIASES = {
    "backend": "back",
    "back-end": "back",
    "back_end": "back",
    "front-end": "front",
    "front_end": "front",
    "frontend": "front",
}


def normalize_direction(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    key = value.strip().lower()
    if not key:
        return None
    return DIRECTION_ALIASES.get(key, key)


def direction_alias_values(value: str | None) -> tuple[str, ...]:
    normalized = normalize_direction(value)
    if not normalized:
        return tuple()
    values = {normalized}
    values.update(alias for alias, target in DIRECTION_ALIASES.items() if target == normalized)
    return tuple(sorted(values))
