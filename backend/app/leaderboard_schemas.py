"""Leaderboard API input contracts, separate from Epic/Release DTOs."""
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class BugDecision(BaseModel):
    status: Literal["confirmed", "rejected"]
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def reason_required(cls, value):
        if not value.strip():
            raise ValueError("Укажите причину")
        return value.strip()


class ManualAdjustment(BugDecision):
    status: Literal["confirmed"] = "confirmed"
    participant_id: int = Field(gt=0)
    points: int = Field(ge=-10000, le=10000)
    historical: bool = False


class IdentityWrite(BaseModel):
    source: Literal["kanban", "jira", "testops"]
    external_id: str = Field(min_length=1, max_length=255)
    user_id: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("external_id", "reason")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Значение обязательно")
        return value.strip()


class BackfillRequest(BaseModel):
    season: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    reason: str = Field(min_length=1, max_length=1000)
    acknowledge_current_source_state: bool

    @field_validator('reason')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Укажите причину')
        return value.strip()


class SourceSettings(BaseModel):
    jira_jql: str = Field(default='', max_length=10000)
    jira_environment_field: str = Field(default='environment', pattern=r'^(environment|customfield_\d+)$')
    testops_project_ids: list[int] = Field(default_factory=list, max_length=100)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator('testops_project_ids')
    @classmethod
    def positive_ids(cls, value):
        if any(v <= 0 for v in value):
            raise ValueError('Project ID должен быть положительным')
        return sorted(set(value))

    @field_validator('reason')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Укажите причину')
        return value.strip()
