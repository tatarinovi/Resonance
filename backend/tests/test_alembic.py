"""Sanity tests for Alembic configuration and the migration chain."""
from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    return cfg


def test_alembic_config_loads():
    cfg = _alembic_config()
    assert cfg.get_main_option("script_location")


def test_migration_chain_is_linear_and_terminates_at_head():
    script = ScriptDirectory.from_config(_alembic_config())
    revisions = list(script.walk_revisions())
    assert len(revisions) >= 7, "Expected baseline plus normalization migrations through 0007"

    heads = script.get_heads()
    assert len(heads) == 1, f"Migrations must converge to a single head, got {heads}"

    bases = tuple(script.get_bases())
    assert bases == ("0001_baseline",), f"Baseline should be the only root, got {bases}"


def test_migration_filenames_match_expectations():
    expected = {
        "0001_baseline",
        "0002_ticket_normalize",
        "0003_ticket_messages",
        "0004_ticket_attachments",
        "0005_ticket_events",
        "0006_epic_blockers",
        "0007_epic_test_runs",
    }
    versions_dir = BACKEND_ROOT / "migrations" / "versions"
    actual = {p.stem for p in versions_dir.glob("*.py") if not p.stem.startswith("__")}
    assert expected.issubset(actual), f"Missing migrations: {expected - actual}"
