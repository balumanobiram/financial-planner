"""Typed application settings, loaded from environment variables / backend/.env.

Spring analogy: this is a @ConfigurationProperties class. Missing required
values fail fast at startup instead of blowing up later at first use.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SecretStr hides the value in logs/reprs; call .get_secret_value() to use it.
    database_url: SecretStr
    jwt_secret: SecretStr
    jwt_expire_days: int = 7
    app_username: str
    app_password_hash: SecretStr
    # Comma-separated if more than one, e.g. "http://localhost:5173,https://my-app.vercel.app"
    frontend_origin: str = "http://localhost:5173"
    app_timezone: str = "Asia/Kolkata"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.frontend_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Singleton accessor (≈ a Spring singleton bean)."""
    return Settings()  # type: ignore[call-arg]  # values come from env
