"""Extract @username mentions from plain text, ignoring fenced and inline code."""

from __future__ import annotations

import re

# Fenced code block (non-greedy until closing ```)
_FENCED_BLOCK = re.compile(r"```[\s\S]*?```", re.MULTILINE)
# Inline code: single backticks, no newlines inside (common case)
_INLINE_CODE = re.compile(r"`[^`\n]+`")
# @username — align with login username (letters, digits, underscore, dot, hyphen)
_MENTION = re.compile(r"@([a-zA-Z0-9][a-zA-Z0-9._-]*)\b")


def _mask_code_segments(text: str) -> str:
    """Replace code regions with spaces so @ inside them is not matched."""
    out = _FENCED_BLOCK.sub(lambda m: " " * len(m.group(0)), text)
    out = _INLINE_CODE.sub(lambda m: " " * len(m.group(0)), out)
    return out


def parse_mentioned_usernames(text: str) -> list[str]:
    """
    Return unique usernames (without @), preserving first-seen order.
    Mentions inside ``` fenced ``` and `inline` spans are ignored.
    """
    if not text or not text.strip():
        return []
    masked = _mask_code_segments(text)
    seen: set[str] = set()
    ordered: list[str] = []
    for m in _MENTION.finditer(masked):
        name = m.group(1)
        if name not in seen:
            seen.add(name)
            ordered.append(name)
    return ordered
