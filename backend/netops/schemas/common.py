from __future__ import annotations

from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator


class PartialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _reject_nulls(self) -> Self:
        nulls = sorted(name for name in self.model_fields_set if getattr(self, name) is None)
        if nulls:
            raise ValueError(f"Fields cannot be null: {', '.join(nulls)}")
        return self
