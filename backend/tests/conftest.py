"""Shared pytest fixtures (≈ a JUnit base test class / Spring test config).

Settings are forced to test values here, so tests never use your real secrets.
Database tests use TEST_DATABASE_URL (Neon dev) and are skipped if it is not set —
they never fall back to DATABASE_URL.
"""

import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import bcrypt
import pytest
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class _TestEnv(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")
    test_database_url: str | None = None


TEST_DATABASE_URL = _TestEnv().test_database_url
TEST_USERNAME = "tester"
TEST_PASSWORD = "correct horse battery staple"
TEST_JWT_SECRET = "test-secret-not-for-production-0123456789abcdef"

# Must run before anything imports app.* (settings are cached on first use).
os.environ.update(
    {
        "DATABASE_URL": TEST_DATABASE_URL or "postgresql+psycopg://test:test@localhost/unused",
        "JWT_SECRET": TEST_JWT_SECRET,
        "APP_USERNAME": TEST_USERNAME,
        # rounds=4: fast for tests; production hashes use 12.
        "APP_PASSWORD_HASH": bcrypt.hashpw(TEST_PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode(),
        "FRONTEND_ORIGIN": "http://localhost:5173",
    }
)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.api.deps import get_logo_fetcher  # noqa: E402
from app.core.db import get_db  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import BankAccount, BankLogo, CreditCard, ExpenseShare, ImportMapping, Person, Transaction  # noqa: E402


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """Client without auth and without a database (for health/auth tests)."""
    return TestClient(app)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    token, _ = create_access_token(TEST_USERNAME, now=datetime.now(UTC), secret=TEST_JWT_SECRET, expire_days=7)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session inside a transaction that is ALWAYS rolled back.

    Inside it we first delete all rows, so each test starts from an empty database —
    but because of the rollback, your real dev data is untouched afterwards.
    App code may call session.commit(); with create_savepoint that only releases a
    SAVEPOINT, never the outer transaction (≈ Spring's @Transactional test rollback).
    """
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set — skipping database test")

    from app.core.db import engine

    with engine.connect() as connection:
        outer = connection.begin()
        session = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
        for model in (ExpenseShare, Transaction, ImportMapping, BankAccount, CreditCard, BankLogo, Person):
            session.execute(delete(model))
        try:
            yield session
        finally:
            session.close()
            outer.rollback()


FAKE_LOGO = b"\x89PNG-fake"


class FakeFetcher:
    """Stands in for the real logo download so API tests never touch the network."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.result: tuple[str, bytes] | None = ("image/png", FAKE_LOGO)

    def __call__(self, domain: str) -> tuple[str, bytes] | None:
        self.calls.append(domain)
        return self.result


@pytest.fixture
def fetcher() -> FakeFetcher:
    return FakeFetcher()


def db_override(session: Session) -> Callable[[], Iterator[Session]]:
    """Like the real get_db, but every request shares the test session. A failed request rolls
    back to the last commit (a SAVEPOINT here), exactly as a fresh session would discard it."""

    def override() -> Iterator[Session]:
        try:
            yield session
        except Exception:
            session.rollback()
            raise

    return override


@pytest.fixture
def api(app: FastAPI, db_session: Session, auth_headers: dict[str, str], fetcher: FakeFetcher) -> Iterator[TestClient]:
    """Authenticated, offline client whose requests use the rolled-back test session."""
    app.dependency_overrides[get_db] = db_override(db_session)
    app.dependency_overrides[get_logo_fetcher] = lambda: fetcher
    with TestClient(app, headers=auth_headers) as test_client:
        yield test_client
    app.dependency_overrides.clear()
