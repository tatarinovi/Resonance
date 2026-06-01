from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator


def _serialize_utc_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


ApiDatetime = Annotated[
    datetime,
    PlainSerializer(_serialize_utc_z, when_used="json"),
]

from .models import (
    FeedbackStatus,
    FeedbackType,
    TestRunEnvironment,
    TestRunStatus,
    TicketPriority,
    TicketStatus,
    UserRole,
    UserWorkspace,
)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str
    password: str


class UserBase(BaseModel):
    username: str
    role: UserRole
    workspace: UserWorkspace = UserWorkspace.DS
    telegram_id: str | None = None
    telegram_notifications: bool = True
    is_approved: bool = True
    matrix_id: str | None = None
    matrix_dm_enabled: bool = False
    matrix_dm_room_id: str | None = None
    kanban_token: str | None = None
    direction: str | None = None
    project_ids: list[int] = Field(default_factory=list)


class UserCreate(UserBase):
    password: str

    @model_validator(mode="after")
    def direction_required_for_non_admin(self) -> "UserCreate":
        if self.role != UserRole.ADMIN and not (self.direction or "").strip():
            raise ValueError("Direction is required for every non-admin role")
        return self


class RegistrationRequest(BaseModel):
    username: str
    password: str
    workspace: UserWorkspace = UserWorkspace.DS
    matrix_id: str | None = None
    direction: str

    @field_validator("direction", mode="before")
    @classmethod
    def direction_required_stripped(cls, v: object) -> str:
        if v is None:
            raise ValueError("Направление обязательно")
        s = str(v).strip()
        if not s:
            raise ValueError("Направление обязательно")
        if len(s) > 50:
            raise ValueError("Направление не длиннее 50 символов")
        return s


class RegistrationResponse(BaseModel):
    status: str = "pending_approval"
    message: str


class UserUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    role: UserRole | None = None
    workspace: UserWorkspace | None = None
    telegram_id: str | None = None
    telegram_notifications: bool | None = None
    is_approved: bool | None = None
    matrix_id: str | None = None
    matrix_dm_enabled: bool | None = None
    matrix_dm_room_id: str | None = None
    kanban_token: str | None = None
    direction: str | None = None
    project_ids: list[int] | None = None

    @model_validator(mode="after")
    def direction_required_when_role_is_non_admin(self) -> "UserUpdate":
        if self.role is not None and self.role != UserRole.ADMIN and not (self.direction or "").strip():
            raise ValueError("Direction is required for every non-admin role")
        return self


class UserRead(UserBase):
    id: int
    created_at: ApiDatetime
    last_login_at: ApiDatetime | None = None

    model_config = ConfigDict(from_attributes=True)


class UserDirectoryEntry(BaseModel):
    """Минимальные поля пользователя для коллег по общим проектам (UI без /admin/users)."""

    id: int
    username: str
    role: UserRole
    workspace: UserWorkspace = UserWorkspace.DS
    is_approved: bool
    direction: str | None = None
    project_ids: list[int]
    last_login_at: ApiDatetime | None = None


class ProjectConfig(BaseModel):
    description: str = ""
    user_ids: list[int] = Field(default_factory=list)
    main_project_room: str = ""
    expert_rooms: dict[str, str] = Field(default_factory=dict)
    leads: dict[str, str] = Field(default_factory=dict)
    epics: list[dict[str, Any]] = Field(default_factory=list)
    morning_digest_enabled: bool = False
    evening_digest_enabled: bool = False
    notify_new_questions_to_expert_rooms: bool = False


class ProjectCreate(BaseModel):
    name: str
    config_json: ProjectConfig = Field(default_factory=ProjectConfig)


class ProjectUpdate(BaseModel):
    name: str | None = None
    config_json: ProjectConfig | None = None


class ProjectRead(BaseModel):
    id: int
    name: str
    config_json: dict[str, Any]

    model_config = ConfigDict(from_attributes=True)


class MentionUserRead(BaseModel):
    id: int
    username: str

    model_config = ConfigDict(from_attributes=True)


class GlobalSettingsUpdate(BaseModel):
    expert_room_ids: dict[str, str] = Field(default_factory=dict)
    lead_matrix_ids: dict[str, str] = Field(default_factory=dict)


# --- TICKET SCHEMAS ---

class AttachmentRead(BaseModel):
    id: int
    name: str
    mime_type: str
    size_bytes: int
    url: str
    created_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class AttachmentCreate(BaseModel):
    url: str
    name: str
    mime_type: str = "application/octet-stream"
    size_bytes: int = 0
    message_id: int | None = None


class MessageRead(BaseModel):
    id: int
    ticket_id: int
    author_id: int | None = None
    author_username: str | None = None
    body: str
    kind: str
    created_at: ApiDatetime
    edited_at: ApiDatetime | None = None

    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    body: str
    kind: str = "message"
    attachment_ids: list[int] = Field(default_factory=list)


class TicketEventRead(BaseModel):
    id: int
    ticket_id: int
    actor_id: int | None = None
    actor_username: str | None = None
    kind: str
    old_value: str | None = None
    new_value: str | None = None
    comment: str | None = None
    created_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class TicketRead(BaseModel):
    id: int
    project_id: int
    epic_id: int | None = None
    status: TicketStatus
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    sla_hours: int | None = None
    due_at: ApiDatetime | None = None
    author_id: int | None = None
    author_username: str | None = None
    assignee_id: int | None = None
    assignee_username: str | None = None
    origin_event_id: str
    expert_event_id: str | None = None
    data_json: dict[str, Any] = Field(default_factory=dict)
    messages: list[MessageRead] = Field(default_factory=list)
    attachments: list[AttachmentRead] = Field(default_factory=list)
    events: list[TicketEventRead] = Field(default_factory=list)
    created_at: ApiDatetime
    updated_at: ApiDatetime
    allowed_target_statuses: list[TicketStatus] | None = None
    is_subscribed: bool = False
    can_claim_assignee: bool = False

    model_config = ConfigDict(from_attributes=True)


class TicketCreate(BaseModel):
    project_id: int
    title: str | None = None
    description: str | None = None
    priority: TicketPriority | None = None
    sla_hours: int | None = None
    due_at: ApiDatetime | None = None
    assignee_id: int | None = None
    epic_id: int | None = None
    status: TicketStatus | None = None
    data_json: dict[str, Any] = Field(default_factory=dict)


class TicketUpdate(BaseModel):
    status: TicketStatus | None = None
    title: str | None = None
    description: str | None = None
    priority: TicketPriority | None = None
    sla_hours: int | None = None
    due_at: ApiDatetime | None = None
    assignee_id: int | None = None
    epic_id: int | None = None
    data_json: dict[str, Any] | None = None


class ExpertReassignBody(BaseModel):
    assignee_id: int


class MeResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    workspace: UserWorkspace = UserWorkspace.DS
    telegram_id: str | None
    telegram_notifications: bool
    is_approved: bool
    matrix_id: str | None
    matrix_dm_enabled: bool
    matrix_dm_room_id: str | None
    kanban_connected: bool = False
    direction: str | None = None
    project_ids: list[int]
    personal_channel_mode: str = "both"


class KanbanProjectRead(BaseModel):
    id: int | None = None
    slug: str
    name: str


class TicketPaginationResponse(BaseModel):
    items: list[TicketRead]
    total: int
    page: int
    page_size: int


class UserPaginationResponse(BaseModel):
    items: list[UserRead]
    total: int
    page: int
    page_size: int


class DashboardSummary(BaseModel):
    total_count: int
    status_counts: dict[str, int]
    priority_counts: dict[str, int] = Field(default_factory=dict)
    direction_counts: dict[str, int]
    project_counts: dict[int, int]
    source_counts: dict[str, int]
    overdue_count: int = 0


# --- EPIC SCHEMAS ---

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


class EpicStatus(str, Enum):
    NEW = "new"
    IN_PROGRESS = "in-progress"
    RELEASED = "released"


class EpicTestPlanItem(BaseModel):
    id: str
    title: str
    description_markdown: str = ""
    is_checked: bool = False
    comment: str = ""


class EpicQARead(BaseModel):
    id: int
    epic_id: int
    status: EpicQAStatus
    active_test_stage: EpicTestStage
    test_plan_items: list[EpicTestPlanItem] = Field(default_factory=list)
    test_run_test_url: str | None = None
    test_run_stage_url: str | None = None
    test_run_prod_url: str | None = None
    risks: str | None = None
    blockers: str | None = None
    known_limitations: str | None = None
    verdict: str | None = None
    reviewer_comments: str | None = None
    last_reviewer_id: int | None = None
    updated_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class EpicQAUpdate(BaseModel):
    test_plan_items: list[EpicTestPlanItem] | None = None
    test_run_test_url: str | None = None
    test_run_stage_url: str | None = None
    test_run_prod_url: str | None = None
    risks: str | None = None
    blockers: str | None = None
    known_limitations: str | None = None


class EpicQACheckStateUpdate(BaseModel):
    item_id: str
    is_checked: bool
    comment: str | None = None


class EpicQAStatusTransitionRequest(BaseModel):
    target_status: EpicQAStatus
    comment: str | None = None


class EpicAuditRead(BaseModel):
    id: int
    epic_id: int
    user_id: int | None
    username: str | None = None
    action: str
    old_status: str | None
    new_status: str | None
    comment: str | None
    details_json: dict[str, Any] | None = None
    created_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class EpicCommentRead(BaseModel):
    id: int
    epic_id: int | None = None
    project_slug: str | None = None
    kanban_epic_id: int | None = None
    user_id: int | None
    username: str | None = None
    body: str
    created_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class EpicCommentCreate(BaseModel):
    body: str


class EpicBlockerRead(BaseModel):
    id: int
    epic_id: int
    reporter_id: int | None
    reporter_username: str | None = None
    body: str
    resolved_at: ApiDatetime | None
    created_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class EpicBlockerCreate(BaseModel):
    body: str


class EpicBlockerUpdate(BaseModel):
    body: str | None = None
    resolved: bool | None = None


class EpicTestRunRead(BaseModel):
    id: int
    epic_id: int
    environment: TestRunEnvironment
    status: TestRunStatus
    url: str | None
    started_at: ApiDatetime | None
    finished_at: ApiDatetime | None
    created_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class EpicTestRunCreate(BaseModel):
    environment: TestRunEnvironment
    status: TestRunStatus = TestRunStatus.PLANNED
    url: str

    @field_validator("url", mode="before")
    @classmethod
    def test_run_url_required(cls, v: object) -> str:
        if v is None:
            raise ValueError("Test run URL is required")
        s = str(v).strip()
        if not s:
            raise ValueError("Test run URL is required")
        return s


class EpicTestRunUpdate(BaseModel):
    status: TestRunStatus | None = None
    url: str | None = None
    started_at: ApiDatetime | None = None
    finished_at: ApiDatetime | None = None


class EpicRead(BaseModel):
    id: int
    project_id: int
    project_name: str | None = None
    title: str
    status: EpicStatus
    jira_url: str
    confluence_url: str
    kanban_url: str | None = None
    design_url: str | None = None
    notes: str | None = None
    qa_estimate_hours: float | None = None
    qa_member_ids: list[int] = Field(default_factory=list)
    spent_total_hours: float | None = None
    spent_qa_hours: float | None = None
    spent_synced_at: ApiDatetime | None = None
    spent_sync_error: str | None = None
    lead_analyst_id: int | None
    lead_designer_id: int | None
    expert_id: int | None
    start_date: date | None = None
    target_date: date | None = None
    open_questions_count: int = 0
    created_at: ApiDatetime
    updated_at: ApiDatetime

    qa_block: EpicQARead | None = None
    comments: list[EpicCommentRead] = Field(default_factory=list)
    history: list[EpicAuditRead] = Field(default_factory=list)
    blockers: list[EpicBlockerRead] = Field(default_factory=list)
    test_runs: list[EpicTestRunRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class EpicPaginationResponse(BaseModel):
    items: list[EpicRead]
    total: int
    page: int
    page_size: int


class EpicCreate(BaseModel):
    project_id: int
    title: str
    jira_url: str
    confluence_url: str = ""
    kanban_url: str | None = None
    design_url: str | None = None
    notes: str | None = None
    qa_estimate_hours: float | None = None
    qa_member_ids: list[int] = Field(default_factory=list)
    lead_analyst_id: int | None = None
    lead_designer_id: int | None = None
    expert_id: int | None = None
    status: EpicStatus = EpicStatus.NEW
    start_date: date | None = None
    target_date: date | None = None


class EpicUpdate(BaseModel):
    title: str | None = None
    jira_url: str | None = None
    confluence_url: str | None = None
    kanban_url: str | None = None
    design_url: str | None = None
    notes: str | None = None
    qa_estimate_hours: float | None = None
    qa_member_ids: list[int] | None = None
    lead_analyst_id: int | None = None
    lead_designer_id: int | None = None
    expert_id: int | None = None
    status: EpicStatus | None = None
    start_date: date | None = None
    target_date: date | None = None


class FeedbackCreate(BaseModel):
    type: FeedbackType
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=10)
    context_url: str | None = Field(default=None, max_length=512)
    expected_result: str | None = None
    steps_to_reproduce: str | None = None


class FeedbackAdminUpdate(BaseModel):
    status: FeedbackStatus | None = None
    admin_response: str | None = None


class FeedbackRead(BaseModel):
    id: int
    author_id: int | None
    author_username: str
    type: FeedbackType
    status: FeedbackStatus
    title: str
    description: str
    context_url: str | None = None
    expected_result: str | None = None
    steps_to_reproduce: str | None = None
    admin_response: str | None = None
    responder_id: int | None = None
    responder_username: str | None = None
    responded_at: ApiDatetime | None = None
    created_at: ApiDatetime
    updated_at: ApiDatetime

    model_config = ConfigDict(from_attributes=True)


class FeedbackPaginationResponse(BaseModel):
    items: list[FeedbackRead]
    total: int
    page: int
    page_size: int


# --- ACTIVITY / DASHBOARD ---


class ActivityEventRead(BaseModel):
    id: str
    type: str  # question | epic | status | comment | blocker
    user_id: int | None = None
    username: str | None = None
    action: str
    target_id: int
    target_type: str  # question | epic
    target_title: str
    project_id: int | None = None
    date: ApiDatetime


class ActivityPaginationResponse(BaseModel):
    items: list[ActivityEventRead]
    total: int
    page: int
    page_size: int


class RoleSummaryWidget(BaseModel):
    id: str
    title: str
    value: int = 0
    description: str | None = None
    metric: str | None = None


class RoleSummaryResponse(BaseModel):
    role: UserRole
    widgets: list[RoleSummaryWidget] = Field(default_factory=list)
    overdue_questions: list[TicketRead] = Field(default_factory=list)
    blocked_epics: list[EpicRead] = Field(default_factory=list)
    my_questions: list[TicketRead] = Field(default_factory=list)
    my_epics: list[EpicRead] = Field(default_factory=list)
