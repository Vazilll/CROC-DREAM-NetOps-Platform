from __future__ import annotations

import hmac
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from netops.enums import UserRole


class ApiPrincipal(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    role: UserRole
    allowed_system: str | None = Field(default=None, exclude=True)



class AuthProfile(BaseModel):
    username: str = Field(min_length=1)
    password: SecretStr


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NETOPS_",
        env_file=(".env", "backend/.env", str(Path(__file__).resolve().parent.parent / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "CROC DREAM NetOps Platform"
    database_url: str = "postgresql+psycopg://netops:netops@localhost:5432/netops"
    redis_url: str = "redis://localhost:6379/0"

    intent_repo_path: Path = Path("intent")
    inventory_file: str = "inventory.yaml"
    templates_path: Path = Path("templates")
    diff_filters_path: Path | None = None
    normalization_rules_path: Path | None = None

    # "offline" emulates the lab with running-configs stored as files; the
    # Scrapli/Nornir driver will be registered here once it is ready.
    network_driver: Literal["offline", "scrapli"] = "offline"
    offline_lab_path: Path = Path("lab/running")

    commit_confirm_timeout_seconds: int = Field(default=180, ge=30, le=3600)
    max_ping_loss_percent: float = Field(default=20.0, ge=0, le=100)
    post_check_attempts: int = Field(default=6, ge=1, le=60)
    post_check_interval_seconds: float = Field(default=10.0, ge=0)

    drift_scan_interval_seconds: int = Field(default=900, ge=60)
    metrics_interval_seconds: int = Field(default=60, ge=10)
    # Как часто заново проверять протоколы устройств и переписывать цели сборщиков.
    collector_targets_interval_seconds: int = Field(default=3600, ge=300)
    job_timeout_seconds: int = Field(default=3600, ge=60)

    # {"<токен>": {"username": "alice", "role": "admin"}}
    api_tokens: dict[str, ApiPrincipal] = Field(default_factory=dict)
    # {"lab": {"username": "admin", "password": "admin"}}
    auth_profiles: dict[str, AuthProfile] = Field(
        default_factory=lambda: {
            "lab": AuthProfile(username="admin", password=SecretStr("admin")),
            "spine1_auth": AuthProfile(username="admin", password=SecretStr("F5ga6jfkig1")),
            "spine2_auth": AuthProfile(username="admin", password=SecretStr("admin")),
            "leaf1_auth": AuthProfile(username="admin", password=SecretStr("admin")),
            "leaf2_auth": AuthProfile(username="admin", password=SecretStr("admin")),
        }
    )

    # LLM Risk Assistant settings (Multi-provider cascade: Ollama -> Groq -> Gemini -> MiMo -> Heuristic)
    # 0. Local Ollama / vLLM (Empty URL = disabled; no API key required)
    ollama_url: str = ""
    ollama_model: str = "qwen2.5:7b"
    ollama_timeout_seconds: float = 4.0

    # 1. Groq (Ultra-fast Qwen 3.8 27B / GPT-OSS 120B)
    groq_api_key: SecretStr | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "qwen/qwen3.8-27b"
    groq_timeout_seconds: float = 2.0

    # 2. Google Gemini (Cloud Backup with fast 2.0s timeout)
    gemini_api_key: SecretStr | None = None
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 2.0

    # 3. Team / Default provider (Xiaomi MiMo or custom proxy)
    llm_api_key: SecretStr | None = None
    llm_base_url: str = ""
    llm_model: str = "MiMo-V2.6-Flash"
    llm_timeout_seconds: float = 2.0

    # Custom dynamic LLM cascade configs: [{"name": "Groq", "base_url": "...", "model": "...", "api_key": "...", "timeout_seconds": 2.0}]
    llm_cascade: list[dict[str, object]] = Field(default_factory=list)

    # Time-series forecasting (empty URL = built-in statistical linear trend & quantile envelope)
    forecast_url: str = ""
    forecast_timeout_seconds: float = 5.0

    # NetBox as the inventory source (empty URL = inventory.yaml of the intent repository).
    netbox_url: str = ""
    netbox_token: SecretStr | None = None

    # Containerlab remote management (for emergency hard reset)
    clab_host: str | None = None
    clab_port: int = 221
    clab_user: str | None = None
    clab_password: SecretStr | None = None
    clab_key_path: str | None = None
    clab_topology_path: str = ""

    # Prometheus-compatible query API (Prometheus или VictoriaMetrics; empty URL = falls back to
    # the SSH CLI cache; no data is invented)
    prometheus_url: str = ""
    # SNMP v2c community для проверки агента и snmp-exporter. Пусто — v2c не проверяется
    # (значения «public» по умолчанию в коде нет).
    snmp_community: SecretStr | None = None

    # Telegram Incident Alerting & Broadcast
    telegram_bot_token: SecretStr | None = None
    telegram_bot_username: str = ""
    telegram_chat_id: str | None = None
    telegram_chat_ids: list[int] = Field(default_factory=list)

    # GitHub / Git SoT repository metadata
    github_repo_url: str = ""

    # Web panel URLs & fabric defaults (human-configurable or trigger-populated)
    frontend_port: int = Field(default=5173, ge=1, le=65535)
    public_web_url: str = ""
    default_fabric_id: str = "croc-dc1-pod1"
    default_domain: str = "croc.lab"

    # Browser origins allowed to call the API (the Vite dev server by default).
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    # Browser cookie session lifetime (one NOC shift by default).
    session_ttl_seconds: int = Field(default=12 * 3600, ge=60)


    @field_validator("intent_repo_path", "templates_path", "offline_lab_path", mode="after")
    @classmethod
    def _resolve_paths(cls, path: Path) -> Path:
        if path.is_absolute():
            return path
        if not path.exists():
            backend_dir = Path(__file__).resolve().parent.parent
            root_dir = backend_dir.parent
            if (root_dir / path).exists():
                return (root_dir / path).resolve()
            if (root_dir / path.name).exists():
                return (root_dir / path.name).resolve()
        return path

    # Повторы post-check не должны занимать больше половины таймера commit confirmed.
    @model_validator(mode="after")
    def _post_check_fits_confirm_timer(self) -> Self:
        window = (self.post_check_attempts - 1) * self.post_check_interval_seconds
        if window > self.commit_confirm_timeout_seconds / 2:
            raise ValueError(
                f"Post-check retries take {window:g}s, more than half of the "
                f"{self.commit_confirm_timeout_seconds}s commit-confirm timer"
            )
        if self.telegram_chat_id and not self.telegram_chat_ids:
            try:
                self.telegram_chat_ids = [int(self.telegram_chat_id.strip())]
            except ValueError:
                pass
        elif self.telegram_chat_ids and not self.telegram_chat_id:
            self.telegram_chat_id = str(self.telegram_chat_ids[0])
        import os
        import sys

        in_pytest = "PYTEST_CURRENT_TEST" in os.environ or "pytest" in sys.modules
        if not in_pytest or "offline_lab_path" in self.model_fields_set:
            self.apply_runtime_overlay(respect_explicit=True)
        return self

    def apply_runtime_overlay(self, *, respect_explicit: bool = False) -> dict[str, object]:
        from netops.services.state import get_state_manager

        state = get_state_manager(self)
        explicit = self.model_fields_set if respect_explicit else set()
        if "auth_profiles" not in explicit:
            try:
                raw_profiles = state.get_db_state(
                    "custom_auth_profiles", {}, database_url=self.database_url
                )
                if isinstance(raw_profiles, dict):
                    for prof_name, creds in raw_profiles.items():
                        if isinstance(creds, dict) and creds.get("username") and creds.get("password"):
                            self.auth_profiles[prof_name] = AuthProfile(
                                username=str(creds["username"]),
                                password=SecretStr(str(creds["password"])),
                            )
            except Exception:
                pass

        try:
            data = state.get_db_state("runtime_settings", {}, database_url=self.database_url)
            if not isinstance(data, dict) or not data:
                return {}
            if data.get("github_repo_url") and "github_repo_url" not in explicit:
                self.github_repo_url = str(data["github_repo_url"])
            if data.get("network_driver") in ("offline", "scrapli") and "network_driver" not in explicit:
                self.network_driver = data["network_driver"]
            if data.get("telegram_bot_token") and "telegram_bot_token" not in explicit:
                self.telegram_bot_token = SecretStr(str(data["telegram_bot_token"]))
            if data.get("telegram_bot_username") and "telegram_bot_username" not in explicit:
                self.telegram_bot_username = str(data["telegram_bot_username"]).lstrip("@")
            if data.get("telegram_chat_id") and "telegram_chat_id" not in explicit:
                self.telegram_chat_id = str(data["telegram_chat_id"])
                try:
                    cid = int(self.telegram_chat_id.strip())
                    if cid not in self.telegram_chat_ids:
                        self.telegram_chat_ids.append(cid)
                except ValueError:
                    pass
            if isinstance(data.get("telegram_chat_ids"), list) and "telegram_chat_ids" not in explicit:
                for raw_cid in data["telegram_chat_ids"]:
                    try:
                        cid = int(str(raw_cid).strip())
                        if cid not in self.telegram_chat_ids:
                            self.telegram_chat_ids.append(cid)
                    except ValueError:
                        pass
            if data.get("clab_host") and "clab_host" not in explicit:
                self.clab_host = str(data["clab_host"])
            if data.get("clab_port") and "clab_port" not in explicit:
                try:
                    self.clab_port = int(data["clab_port"])
                except ValueError:
                    pass
            if data.get("clab_user") and "clab_user" not in explicit:
                self.clab_user = str(data["clab_user"])
            if data.get("clab_password") and "clab_password" not in explicit:
                self.clab_password = SecretStr(str(data["clab_password"]))
            if data.get("clab_topology_path") and "clab_topology_path" not in explicit:
                self.clab_topology_path = str(data["clab_topology_path"])
            for str_field in ("public_web_url", "default_fabric_id", "default_domain"):
                if data.get(str_field) and str_field not in explicit:
                    setattr(self, str_field, str(data[str_field]))
            if data.get("groq_api_key") and "groq_api_key" not in explicit:
                self.groq_api_key = SecretStr(str(data["groq_api_key"]))
            if data.get("gemini_api_key") and "gemini_api_key" not in explicit:
                self.gemini_api_key = SecretStr(str(data["gemini_api_key"]))
            if data.get("ollama_url") is not None and "ollama_url" not in explicit:
                self.ollama_url = str(data["ollama_url"])
            if data.get("prometheus_url") is not None and "prometheus_url" not in explicit:
                self.prometheus_url = str(data["prometheus_url"])
            if isinstance(data.get("llm_cascade"), list) and "llm_cascade" not in explicit:
                self.llm_cascade = [
                    item for item in data["llm_cascade"] if isinstance(item, dict)
                ]
            for int_field in (
                "metrics_interval_seconds",
                "drift_scan_interval_seconds",
                "commit_confirm_timeout_seconds",
                "frontend_port",
            ):
                if data.get(int_field) is not None and int_field not in explicit:
                    try:
                        setattr(self, int_field, int(data[int_field]))
                    except (TypeError, ValueError):
                        pass
            if (
                data.get("max_ping_loss_percent") is not None
                and "max_ping_loss_percent" not in explicit
            ):
                try:
                    self.max_ping_loss_percent = float(data["max_ping_loss_percent"])
                except (TypeError, ValueError):
                    pass
            return data
        except Exception:
            return {}

    def save_runtime_overlay(self, updates: dict[str, object]) -> dict[str, object]:
        from netops.services.state import get_state_manager

        state = get_state_manager(self)
        loaded = state.get_db_state("runtime_settings", {}, database_url=self.database_url)
        existing: dict[str, object] = dict(loaded) if isinstance(loaded, dict) else {}
        for k, v in updates.items():
            if v is not None:
                existing[k] = v
        state.set_db_state("runtime_settings", existing, database_url=self.database_url)
        self.apply_runtime_overlay()
        return existing

    def authenticate(self, token: str) -> ApiPrincipal | None:
        candidate = token.encode()
        for known, principal in self.api_tokens.items():
            if hmac.compare_digest(known.encode(), candidate):
                return principal
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
