"""Request and response shapes of a plan. `data` stays an untyped dict on purpose: it is the planner's
document and is validated by app.services.plans, not field by field."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

NAME_MAX_LENGTH = 255


def _clean_name(value: object) -> object:
    if isinstance(value, str):
        return value.strip()
    return value


class PlanSummary(BaseModel):
    """Plan metadata, as listed and as returned after a change."""

    id: uuid.UUID
    name: str
    revision: int
    activity_count: int
    member_count: int
    selected_year: int | None
    created_at: datetime
    updated_at: datetime


class PlanOut(PlanSummary):
    """A plan with its document."""

    data: dict


class PlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    data: dict

    _trim_name = field_validator("name", mode="before")(_clean_name)


class PlanContentUpdate(BaseModel):
    """Replaces the document. `revision` is the revision the client last saw."""

    data: dict
    revision: int = Field(ge=1)


class PlanRename(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)

    _trim_name = field_validator("name", mode="before")(_clean_name)
