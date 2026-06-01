from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SqlEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class UserRole(str, Enum):
    ADMIN = "admin"
    COORDINATOR = "coordinator"
    MANAGER = "manager"
    EMPLOYEE = "employee"
    EXPERT = "expert"


class UserWorkspace(str, Enum):
    DS = "ds"
    NOTA = "nota"


class TicketStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    FORWARDED = "forwarded"
    CANCELLED = "cancelled"
    RETURNED = "returned"
    ANSWERED = "answered"
    CLOSED = "closed"


class TicketPriority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TicketMessageKind(str, Enum):
    MESSAGE = "message"
    RESPONSE = "response"
    CLARIFICATION = "clarification"


class TicketEventKind(str, Enum):
    CREATED = "created"
    STATUS_CHANGED = "status_changed"
    ASSIGNEE_CHANGED = "assignee_changed"
    PRIORITY_CHANGED = "priority_changed"
    DESCRIPTION_CHANGED = "description_changed"
    MESSAGE_ADDED = "message_added"
    ATTACHMENT_ADDED = "attachment_added"


class TestRunEnvironment(str, Enum):
    TEST = "test"
    STAGE = "stage"
    PROD = "prod"


class TestRunStatus(str, Enum):
    PLANNED = "planned"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class NotificationType(str, Enum):
    TICKET_CREATED = "ticket_created"
    TICKET_FORWARDED = "ticket_forwarded"
    TICKET_ANSWERED = "ticket_answered"
    TICKET_RETURNED = "ticket_returned"
    TICKET_MENTIONED = "ticket_mentioned"
    TICKET_WATCH_MESSAGE = "ticket_watch_message"
    TICKET_WATCH_STATUS = "ticket_watch_status"
    TICKET_SLA_STAGNATION = "ticket_sla_stagnation"
    EPIC_QA_IN_TESTING = "epic_qa_in_testing"
    EPIC_QA_BLOCKED = "epic_qa_blocked"
    REMINDER_UNREAD = "reminder_unread"
    KANBAN_TASK_NEW = "kanban_task_new"


class FeedbackType(str, Enum):
    BUG = "bug"
    IMPROVEMENT = "improvement"


class FeedbackStatus(str, Enum):
    NEW = "new"
    IN_REVIEW = "in_review"
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    DECLINED = "declined"


user_projects = Table(
    "user_projects",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("project_id", ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[UserRole] = mapped_column(SqlEnum(UserRole), default=UserRole.EMPLOYEE, nullable=False)
    telegram_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    telegram_notifications: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_approved: Mapped[bool] = mapped_column(default=True, nullable=False)
    matrix_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    matrix_dm_enabled: Mapped[bool] = mapped_column(default=False, nullable=False)
    matrix_dm_room_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kanban_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    workspace: Mapped[str] = mapped_column(String(20), default=UserWorkspace.DS.value, nullable=False)
    direction: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    projects: Mapped[list["Project"]] = relationship("Project", secondary=user_projects, back_populates="users")
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="recipient", cascade="all, delete-orphan"
    )


class KanbanLegacyTaskSeen(Base):
    """Снимок id задач из GET /user/{id}/task/legacy для дедупа и baseline без спама при первом запуске."""

    __tablename__ = "kanban_legacy_task_seen"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kanban_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    seen_task_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    initialized_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    users: Mapped[list[User]] = relationship("User", secondary=user_projects, back_populates="projects")
    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="project", cascade="all, delete-orphan")


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("origin_event_id", name="uq_tickets_origin_event_id"),
        UniqueConstraint("expert_event_id", name="uq_tickets_expert_event_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    epic_id: Mapped[int | None] = mapped_column(ForeignKey("epics.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[TicketStatus] = mapped_column(SqlEnum(TicketStatus), default=TicketStatus.PENDING_APPROVAL, nullable=False)
    origin_event_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    expert_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    sla_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    data_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project: Mapped[Project] = relationship("Project", back_populates="tickets")
    epic: Mapped["Epic | None"] = relationship("Epic", back_populates="tickets")
    author: Mapped["User | None"] = relationship("User", foreign_keys=[author_id])
    assignee: Mapped["User | None"] = relationship("User", foreign_keys=[assignee_id])
    messages: Mapped[list["TicketMessage"]] = relationship(
        "TicketMessage",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="TicketMessage.created_at.asc()",
    )
    attachments: Mapped[list["TicketAttachment"]] = relationship(
        "TicketAttachment",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="TicketAttachment.created_at.asc()",
    )
    events: Mapped[list["TicketEvent"]] = relationship(
        "TicketEvent",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="TicketEvent.created_at.asc()",
    )
    subscribers: Mapped[list["TicketSubscriber"]] = relationship(
        "TicketSubscriber",
        back_populates="ticket",
        cascade="all, delete-orphan",
    )


class TicketSubscriber(Base):
    __tablename__ = "ticket_subscribers"

    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    ticket: Mapped["Ticket"] = relationship("Ticket", back_populates="subscribers")
    user: Mapped["User"] = relationship("User")


class TicketMessage(Base):
    __tablename__ = "ticket_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default=TicketMessageKind.MESSAGE.value, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    ticket: Mapped[Ticket] = relationship("Ticket", back_populates="messages")
    author: Mapped["User | None"] = relationship("User")


class TicketAttachment(Base):
    __tablename__ = "ticket_attachments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("ticket_messages.id", ondelete="SET NULL"), nullable=True
    )
    uploader_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), default="application/octet-stream", nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    ticket: Mapped[Ticket] = relationship("Ticket", back_populates="attachments")


class TicketEvent(Base):
    __tablename__ = "ticket_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    ticket: Mapped[Ticket] = relationship("Ticket", back_populates="events")
    actor: Mapped["User | None"] = relationship("User")


class OperationContext(Base):
    """One row per HTTP/API command trace (`correlation_id`)."""

    __tablename__ = "operation_contexts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    correlation_id: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    command_type: Mapped[str] = mapped_column(String(120), nullable=False, default="unknown")
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    http_request_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class DomainEventLog(Base):
    __tablename__ = "domain_event_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    causation_event_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    operation_context_id: Mapped[int | None] = mapped_column(
        ForeignKey("operation_contexts.id", ondelete="SET NULL"), nullable=True
    )
    taxonomy_class: Mapped[str] = mapped_column(String(40), nullable=False)
    notification_relevance: Mapped[str] = mapped_column(String(40), nullable=False)
    primary_classification: Mapped[str] = mapped_column(String(20), nullable=False, default="primary")
    aggregate_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    aggregate_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class NotificationFanoutPending(Base):
    __tablename__ = "notification_fanout_pending"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    group_key: Mapped[str] = mapped_column(String(255), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(80), nullable=False)
    payload_stub: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class ProjectNotificationPolicy(Base):
    __tablename__ = "project_notification_policies"

    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    realtime_matrix_room_enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    digest_matrix_room_enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    realtime_dm_default_for_roles: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    room_delivery_mode: Mapped[str] = mapped_column(String(40), default="realtime_and_digest", nullable=False)
    matrix_project_room_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quiet_hours_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    escalation_reminder_hours: Mapped[int] = mapped_column(Integer, default=24, nullable=False)
    escalation_lead_hours: Mapped[int] = mapped_column(Integer, default=48, nullable=False)
    prefer_dm_over_room: Mapped[bool] = mapped_column(default=False, nullable=False)
    matrix_room_encryption_blocked: Mapped[bool] = mapped_column(default=False, nullable=False)
    matrix_room_last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    matrix_bot_joined_room: Mapped[bool] = mapped_column(default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class UserNotificationPreferences(Base):
    __tablename__ = "user_notification_preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    quiet_hours_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    project_channel_overrides_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    personal_channel_mode: Mapped[str] = mapped_column(String(30), default="both", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class NotificationOutboundJob(Base):
    __tablename__ = "notification_outbound_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    notification_id: Mapped[int | None] = mapped_column(ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True)
    recipient_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    channel: Mapped[str] = mapped_column(String(40), nullable=False)
    destination_ref: Mapped[str] = mapped_column(String(512), nullable=False)
    payload_html: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    operation_context_id: Mapped[int | None] = mapped_column(
        ForeignKey("operation_contexts.id", ondelete="SET NULL"), nullable=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    suppressed_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    delivery_target_type: Mapped[str] = mapped_column(String(20), default="personal", nullable=False)
    delivery_intent: Mapped[str] = mapped_column(String(40), default="personal_info", nullable=False)
    routing_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class NotificationDeliveryAttempt(Base):
    __tablename__ = "notification_delivery_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("notification_outbound_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class DigestRun(Base):
    __tablename__ = "digest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    matrix_room_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    matrix_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("recipient_id", "dedupe_key", name="uq_notifications_recipient_dedupe_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    target_url: Mapped[str] = mapped_column(String(512), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    is_read: Mapped[bool] = mapped_column(default=False, nullable=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(40), default="unread", nullable=False, index=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    snooze_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    muted: Mapped[bool] = mapped_column(default=False, nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    escalation_parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True
    )
    escalation_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_escalation_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    urgency: Mapped[str] = mapped_column(String(20), default="passive", nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    operation_context_id: Mapped[int | None] = mapped_column(
        ForeignKey("operation_contexts.id", ondelete="SET NULL"), nullable=True
    )
    source_event_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    group_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    delivery_intent: Mapped[str | None] = mapped_column(String(40), nullable=True)

    recipient: Mapped[User] = relationship("User", back_populates="notifications")


class FeedbackRequest(Base):
    __tablename__ = "feedback_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    author_username: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[FeedbackType] = mapped_column(SqlEnum(FeedbackType), default=FeedbackType.IMPROVEMENT, nullable=False)
    status: Mapped[FeedbackStatus] = mapped_column(SqlEnum(FeedbackStatus), default=FeedbackStatus.NEW, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    context_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    expected_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    steps_to_reproduce: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    responder_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    responder_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class EpicStatus(str, Enum):
    NEW = "new"
    IN_PROGRESS = "in-progress"
    RELEASED = "released"


class EpicQAStatus(str, Enum):
    DRAFT = "draft"
    IN_TESTING = "in_testing"
    BLOCKED = "blocked"
    TEST_COMPLETE = "test_complete"
    STAGE_COMPLETE = "stage_complete"
    PROD_COMPLETE = "prod_complete"
    CLOSED = "closed"


class EpicTestStage(str, Enum):
    TEST = "test"
    STAGE = "stage"
    PROD = "prod"


class Epic(Base):
    __tablename__ = "epics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[EpicStatus] = mapped_column(SqlEnum(EpicStatus), default=EpicStatus.NEW, nullable=False)
    jira_url: Mapped[str] = mapped_column(String(512), nullable=False)
    confluence_url: Mapped[str] = mapped_column(String(512), nullable=False)
    kanban_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    design_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    qa_estimate_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    qa_member_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    spent_total_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    spent_qa_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    spent_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    spent_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_analyst_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    lead_designer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expert_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    project: Mapped[Project] = relationship("Project")
    tickets: Mapped[list[Ticket]] = relationship("Ticket", back_populates="epic")
    qa_block: Mapped["EpicQA"] = relationship("EpicQA", back_populates="epic", cascade="all, delete-orphan", uselist=False)
    history: Mapped[list["EpicAuditLog"]] = relationship(
        "EpicAuditLog", cascade="all, delete-orphan", order_by="EpicAuditLog.created_at.desc()"
    )
    comments: Mapped[list["EpicComment"]] = relationship(
        "EpicComment", cascade="all, delete-orphan", order_by="EpicComment.created_at.desc()"
    )
    blockers: Mapped[list["EpicBlocker"]] = relationship(
        "EpicBlocker", cascade="all, delete-orphan", order_by="EpicBlocker.created_at.desc()"
    )
    test_runs: Mapped[list["EpicTestRun"]] = relationship(
        "EpicTestRun", cascade="all, delete-orphan", order_by="EpicTestRun.created_at.desc()"
    )


class EpicQA(Base):
    __tablename__ = "epic_qa"

    STATUS_DB_ENUM = SqlEnum(
        "DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "IN_TESTING", "BLOCKED", "TEST_COMPLETE", "STAGE_COMPLETE", "PROD_COMPLETE", "CLOSED",
        "draft", "in_review", "changes_requested", "approved", "in_testing", "blocked", "test_complete", "stage_complete", "prod_complete", "closed",
        name="epicqastatus", validate_strings=False,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    epic_id: Mapped[int] = mapped_column(ForeignKey("epics.id", ondelete="CASCADE"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(STATUS_DB_ENUM, default=EpicQAStatus.DRAFT.value.upper(), nullable=False)
    active_test_stage: Mapped[str] = mapped_column(String(20), default=EpicTestStage.TEST.value, nullable=False)
    legacy_test_plan: Mapped[str | None] = mapped_column("test_plan", Text, nullable=True)
    legacy_test_ops_url: Mapped[str | None] = mapped_column("test_ops_url", String(512), nullable=True)
    legacy_test_runs_pending: Mapped[bool] = mapped_column("test_runs_pending", default=False, nullable=False)
    legacy_platform_coverage: Mapped[dict] = mapped_column("platform_coverage", JSON, default=dict, nullable=False)
    test_plan_items: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    test_run_test_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    test_run_stage_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    test_run_prod_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    risks: Mapped[str | None] = mapped_column(Text, nullable=True)
    blockers: Mapped[str | None] = mapped_column(Text, nullable=True)
    known_limitations: Mapped[str | None] = mapped_column(Text, nullable=True)
    verdict: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    epic: Mapped[Epic] = relationship("Epic", back_populates="qa_block")


class EpicAuditLog(Base):
    __tablename__ = "epic_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    epic_id: Mapped[int] = mapped_column(ForeignKey("epics.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    new_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    details_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class EpicComment(Base):
    __tablename__ = "epic_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    epic_id: Mapped[int] = mapped_column(ForeignKey("epics.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    epic: Mapped[Epic] = relationship("Epic", back_populates="comments")


class EpicBlocker(Base):
    __tablename__ = "epic_blockers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    epic_id: Mapped[int] = mapped_column(ForeignKey("epics.id", ondelete="CASCADE"), nullable=False, index=True)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    epic: Mapped[Epic] = relationship("Epic", back_populates="blockers")
    reporter: Mapped["User | None"] = relationship("User")


class EpicTestRun(Base):
    __tablename__ = "epic_test_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    epic_id: Mapped[int] = mapped_column(ForeignKey("epics.id", ondelete="CASCADE"), nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=TestRunStatus.PLANNED.value, nullable=False)
    url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    epic: Mapped[Epic] = relationship("Epic", back_populates="test_runs")


class KanbanEpicComment(Base):
    __tablename__ = "kanban_epic_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    kanban_epic_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TelegramLinkingToken(Base):
    __tablename__ = "telegram_linking_tokens"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
