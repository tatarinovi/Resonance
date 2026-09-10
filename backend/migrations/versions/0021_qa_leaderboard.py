"""Persist monthly QA leaderboard, source evidence, identities and audit."""
from alembic import op
import sqlalchemy as sa

revision = "0021_qa_leaderboard"
down_revision = "0020_release_insights"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('leaderboard_audit',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('season', sa.String(length=7), nullable=True),
    sa.Column('admin_id', sa.Integer(), nullable=False),
    sa.Column('action', sa.String(length=40), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('details', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('leaderboard_seasons',
    sa.Column('key', sa.String(length=7), nullable=False),
    sa.Column('rules', sa.JSON(), nullable=False),
    sa.Column('roster', sa.JSON(), nullable=False),
    sa.Column('closed_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('leaderboard_bugs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('season', sa.String(length=7), nullable=False),
    sa.Column('source_key', sa.String(length=255), nullable=False),
    sa.Column('issue_key', sa.String(length=128), nullable=False),
    sa.Column('participant_id', sa.Integer(), nullable=True),
    sa.Column('source_at', sa.DateTime(), nullable=False),
    sa.Column('environment', sa.String(length=10), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('problem', sa.String(length=500), nullable=True),
    sa.Column('evidence', sa.JSON(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['season'], ['leaderboard_seasons.key'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('season', 'source_key', name='uq_leaderboard_bug')
    )
    op.create_table('leaderboard_contributions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('season', sa.String(length=7), nullable=False),
    sa.Column('participant_id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('source_key', sa.String(length=255), nullable=False),
    sa.Column('event_type', sa.String(length=40), nullable=False),
    sa.Column('source_at', sa.DateTime(), nullable=False),
    sa.Column('points', sa.Integer(), nullable=False),
    sa.Column('eligible', sa.Boolean(), nullable=False),
    sa.Column('explanation', sa.Text(), nullable=False),
    sa.Column('evidence', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['season'], ['leaderboard_seasons.key'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('season', 'source', 'source_key', 'participant_id', 'event_type', name='uq_leaderboard_contribution')
    )
    op.create_table('leaderboard_identities',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('external_id', sa.String(length=255), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('source', 'external_id', name='uq_leaderboard_identity')
    )
    op.create_index(op.f('ix_leaderboard_audit_season'), 'leaderboard_audit', ['season'], unique=False)
    op.create_index('ix_leaderboard_activity', 'leaderboard_contributions', ['season', 'participant_id', 'source_at'], unique=False)

def downgrade():
    op.drop_table('leaderboard_identities')
    op.drop_table('leaderboard_contributions')
    op.drop_table('leaderboard_bugs')
    op.drop_table('leaderboard_seasons')
    op.drop_table('leaderboard_audit')
