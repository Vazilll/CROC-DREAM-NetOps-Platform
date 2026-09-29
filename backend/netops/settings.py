"""Application settings, read from ``NETOPS_*`` environment variables or ``.env``."""

from __future__ import annotations

import hmac
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from netops.enums import UserRole


class ApiPrincipal(BaseModel):
    """An API user resolved from a bearer token."""

    username: str = Field(min_length=1, max_length=64)
    role: UserRole


class AuthProfile(BaseModel):
    """SSH credentials referenced by ``Device.auth_profile``."""

    username: str = Field(min_length=1)
    password: SecretStr


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NETOPS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "CROC DREAM NetOps Platform"
    database_url: str = "postgresql+psycopg://netops:netops@localhost:5432/netops"
    redis_url: str = "redis://localhost:6379/0"

    # Source of Truth: a checkout of the intent Git repository and Jinja2 templates.
    intent_repo_path: Path = Path("intent")
    templates_path: Path = Path("templates")
    normalization_rules_path: Path | None = None

    # "offline" emulates the lab with running-configs stored as files; the
    # Scrapli/Nornir driver will be registered here once it is ready.
    network_driver: Literal["offline"] = "offline"
    offline_lab_path: Path = Path("lab/running")

    commit_confirm_timeout_seconds: int = Field(default=180, ge=30, le=3600)
    max_ping_loss_percent: float = Field(default=20.0, ge=0, le=100)
    # BGP needs time to converge after a change: the post-check is retried
    # until it passes or the attempts run out, then the change is rolled back.
    post_check_attempts: int = Field(default=6, ge=1, le=60)
    post_check_interval_seconds: float = Field(default=10.0, ge=0)

    drift_scan_interval_seconds: int = Field(default=900, ge=60)
    job_timeout_seconds: int = Field(default=3600, ge=60)

    # {"<token>": {"username": "alice", "role": "admin"}}
    api_tokens: dict[str, ApiPrincipal] = Field(default_factory=dict)
    # {"lab": {"username": "admin", "password": "admin"}}
    auth_profiles: dict[str, AuthProfile] = Field(default_factory=dict)

    # Browser origins allowed to call the API (the Vite dev server by default).
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    @model_validator(mode="after")
    def _post_check_fits_confirm_timer(self) -> Self:
        # Leave at least half of the timer for the probes themselves and the confirm.
        window = (self.post_check_attempts - 1) * self.post_check_interval_seconds
        if window > self.commit_confirm_timeout_seconds / 2:
            raise ValueError(
                f"Post-check retries take {window:g}s, more than half of the "
                f"{self.commit_confirm_timeout_seconds}s commit-confirm timer"
            )
        return self

    def authenticate(self, token: str) -> ApiPrincipal | None:
        """Resolve a bearer token, comparing in constant time."""
        candidate = token.encode()
        for known, principal in self.api_tokens.items():
            if hmac.compare_digest(known.encode(), candidate):
                return principal
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
