from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class IntentIssueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source: str = Field(description="File in the intent repository, or <fabric>")
    location: str = Field(description="Dotted path of the offending field")
    message: str
    hostname: str | None = None
    code: str


class IntentLintReport(BaseModel):
    valid: bool
    issues: list[IntentIssueRead]
