"""Tests for mention_util.parse_mentioned_usernames."""

from __future__ import annotations

from app.mention_util import parse_mentioned_usernames


def test_simple_mentions_dedup_and_order() -> None:
    assert parse_mentioned_usernames("hi @alice and @bob @alice") == ["alice", "bob"]


def test_ignores_fenced_code() -> None:
    text = """Please see @carol

```
@decorator
def foo():
    pass
```

Also @dave"""
    assert parse_mentioned_usernames(text) == ["carol", "dave"]


def test_ignores_inline_code() -> None:
    text = "Use `@eve` but ping @frank"
    assert parse_mentioned_usernames(text) == ["frank"]


def test_empty_and_no_mentions() -> None:
    assert parse_mentioned_usernames("") == []
    assert parse_mentioned_usernames("   ") == []
    assert parse_mentioned_usernames("no mentions here") == []


def test_username_with_dot_and_hyphen() -> None:
    assert parse_mentioned_usernames("@user.name-test ok") == ["user.name-test"]
