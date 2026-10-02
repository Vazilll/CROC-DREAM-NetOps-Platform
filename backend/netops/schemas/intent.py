from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class IntentIssueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source: str = Field(description="Файл в репозитории intent или <fabric>")
    location: str = Field(description="Путь к полю с ошибкой через точку")
    message: str
    hostname: str | None = None
    code: str


class IntentLintReport(BaseModel):
    valid: bool
    issues: list[IntentIssueRead]
