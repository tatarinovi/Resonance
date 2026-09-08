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
        "0018_release_center",
        "0019_scoped_release",
    }
    versions_dir = BACKEND_ROOT / "migrations" / "versions"
    actual = {p.stem for p in versions_dir.glob("*.py") if not p.stem.startswith("__")}
    assert expected.issubset(actual), f"Missing migrations: {expected - actual}"


def test_release_insights_upgrade_preserves_legacy_cache():
    import importlib.util
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, text, inspect
    path = BACKEND_ROOT / 'migrations/versions/0020_release_insights.py'
    spec = importlib.util.spec_from_file_location('release_insights_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        for name in ('epic_test_runs','epic_jira_issues','epic_testops_problem_cases'):
            conn.execute(text(f'CREATE TABLE {name} (id INTEGER PRIMARY KEY, legacy TEXT)'))
            conn.execute(text(f"INSERT INTO {name} VALUES (1, 'preserved')"))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            assert conn.execute(text('SELECT legacy,link_kind,external_result_id FROM epic_testops_problem_cases')).one() == ('preserved','launch',None)
            assert 'status_category' in {c['name'] for c in inspect(conn).get_columns('epic_jira_issues')}
            migration.downgrade()
        assert conn.execute(text('SELECT legacy FROM epic_test_runs')).scalar() == 'preserved'
