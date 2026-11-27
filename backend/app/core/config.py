"""Application settings.

Values come from environment variables, with the repository-root ``.env`` as the fallback, so one file
serves Docker Compose, a local uvicorn and Alembic.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# backend/app/core/config.py -> backend -> repository root. The file does not exist inside the image.
REPO_ROOT = Path(__file__).resolve().parents[3]

# Signs sessions outside production when SESSION_SECRET_KEY is empty, so a local stack starts without setup.
DEV_SESSION_SECRET_KEY = "horizon-development-session-key"
PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    # "production" turns on the strict start-up checks in check_startup().
    APP_ENV: str = "development"

    DATABASE_URL: str = "postgresql+asyncpg://horizon:horizon@localhost:5432/horizon"

    # Public origin of the site. The sign-in providers redirect back to it.
    BASE_URL: str = "http://localhost:8080"

    SESSION_SECRET_KEY: str = ""
    SESSION_COOKIE_NAME: str = "horizon_session"
    SESSION_COOKIE_SECURE: bool = False
    SESSION_MAX_AGE: int = 14 * 24 * 3600

    # Sign-in providers. Each is offered only while its client id is set.
    OIDC_CLIENT_ID: str = ""
    OIDC_CLIENT_SECRET: str = ""
    # OpenID Connect authority; discovery runs against <authority>/.well-known/openid-configuration.
    OIDC_AUTHORITY: str = ""
    OIDC_CALLBACK_PATH: str = "/auth/signin-oidc"

    YANDEX_CLIENT_ID: str = ""
    YANDEX_CLIENT_SECRET: str = ""
    YANDEX_CALLBACK_PATH: str = "/auth/signin-yandex"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_CALLBACK_PATH: str = "/auth/signin-google"

    # Only for automated tests and local checks: enables POST /api/dev/test-login.
    ENABLE_TEST_LOGIN: bool = False

    # Largest plan document accepted, in bytes. It stays below the reverse proxy's body limit (1 MiB).
    PLAN_MAX_BYTES: int = 1_000_000

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.strip().lower() == PRODUCTION

    @property
    def session_secret_key(self) -> str:
        return self.SESSION_SECRET_KEY or DEV_SESSION_SECRET_KEY

    def callback_url(self, path: str) -> str:
        """Absolute URL of `path` on this site."""
        return f"{self.BASE_URL.rstrip('/')}{path}"

    def enabled_providers(self) -> list[str]:
        """Sign-in providers that have credentials, in display order."""
        providers = []
        if self.OIDC_CLIENT_ID and self.OIDC_AUTHORITY:
            providers.append("oidc")
        if self.YANDEX_CLIENT_ID:
            providers.append("yandex")
        if self.GOOGLE_CLIENT_ID:
            providers.append("google")
        return providers

    def production_problems(self) -> list[str]:
        """Settings that make a production deployment unsafe, as messages."""
        problems = []
        if len(self.SESSION_SECRET_KEY) < 32 or self.SESSION_SECRET_KEY == DEV_SESSION_SECRET_KEY:
            problems.append("SESSION_SECRET_KEY must be a random value of at least 32 characters.")
        if not self.BASE_URL.startswith("https://"):
            problems.append("BASE_URL must be an https:// origin.")
        if not self.SESSION_COOKIE_SECURE:
            problems.append("SESSION_COOKIE_SECURE must be true.")
        if self.ENABLE_TEST_LOGIN:
            problems.append("ENABLE_TEST_LOGIN must be false.")
        if self.DATABASE_URL == Settings.model_fields["DATABASE_URL"].default:
            problems.append("DATABASE_URL must not use the development default.")
        if not self.enabled_providers():
            problems.append("No sign-in provider is configured (set the OIDC, Yandex or Google credentials).")
        return problems

    def check_startup(self) -> None:
        """Refuses to start a misconfigured production deployment; development only gets warnings."""
        if self.is_production:
            problems = self.production_problems()
            if problems:
                raise RuntimeError("Refusing to start in production:\n- " + "\n- ".join(problems))
        elif not self.SESSION_SECRET_KEY:
            logger.warning("SESSION_SECRET_KEY is not set; sessions use the built-in development key.")


settings = Settings()
