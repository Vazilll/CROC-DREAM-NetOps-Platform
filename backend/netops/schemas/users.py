from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from netops.enums import UserRole
from netops.schemas.common import PartialUpdate

Username = Annotated[
    str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.@-]+$")
]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: Username = Field(examples=["duty-engineer"])
    role: UserRole = UserRole.VIEWER


class UserUpdate(PartialUpdate):
    role: UserRole | None = None
    is_active: bool | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserWithToken(UserRead):
    token: str = Field(description="Токен показывается один раз, сохраните его")
