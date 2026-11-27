"""Shared fixtures.

The environment is pinned before anything from ``app`` is imported, so the suite needs no identity
provider and is not affected by a developer's .env. Every test gets empty tables; the schema itself
comes from the real Alembic migrations, run once per session.

Point TEST_DATABASE_URL at a scratch database (the default matches docker-compose.yml on port 5432):
the tests erase its tables on every run.
"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

TEST_DATABASE_URL = "postgresql+asyncpg://horizon:horizon@localhost:5432/horizon_test"

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", TEST_DATABASE_URL)
os.environ["APP_ENV"] = "test"
os.environ["BASE_URL"] = "http://testserver"
os.environ["SESSION_SECRET_KEY"] = "test-session-secret"
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ENABLE_TEST_LOGIN"] = "false"
os.environ["PLAN_MAX_BYTES"] = "1000000"
os.environ["OIDC_CLIENT_ID"] = "test-oidc-client"
os.environ["OIDC_CLIENT_SECRET"] = "test-oidc-secret"
os.environ["OIDC_AUTHORITY"] = "https://auth.invalid"
os.environ["YANDEX_CLIENT_ID"] = "test-yandex-client"
os.environ["YANDEX_CLIENT_SECRET"] = "test-yandex-secret"
os.environ["GOOGLE_CLIENT_ID"] = "test-google-client"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-google-secret"

import httpx2  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.auth import get_current_user  # noqa: E402
from app.core.database import AsyncSessionLocal, engine  # noqa: E402
from app.main import app, create_app  # noqa: E402
from app.models.plan import Plan  # noqa: E402
from app.models.user import User  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated_schema():
    """Creates the schema the way a deployment does."""
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")


async def clear_tables() -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(text("TRUNCATE TABLE plans, users RESTART IDENTITY CASCADE"))
        await session.commit()


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def database_engine():
    """Closes the connection pool once the session is over."""
    yield
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session():
    """Empty tables around every test that touches the database."""
    await clear_tables()
    async with AsyncSessionLocal() as session:
        yield session
    await clear_tables()


@pytest_asyncio.fixture
async def user(db_session) -> User:
    row = User(sub="oidc:alice", email="alice@example.com", name="Alice")
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


@pytest_asyncio.fixture
async def other_user(db_session) -> User:
    row = User(sub="yandex:42", email="bob@example.com", name="Bob")
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


@pytest_asyncio.fixture
async def anon_client(db_session):
    """Requests to the app without a session. The app's lifespan does not run."""
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://testserver") as client:
        yield client


def sign_in_as(user: User, application=app) -> None:
    """Makes every request to `application` authenticated as `user`, bypassing the provider flow."""

    async def current_user():
        return user

    application.dependency_overrides[get_current_user] = current_user


@pytest_asyncio.fixture
async def api_client(user, anon_client):
    sign_in_as(user)
    yield anon_client
    app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def other_client(other_user):
    """A second signed-in user, for checks that plans stay private to their owner. It talks to its own
    instance of the app, because the sign-in override is otherwise the same for both."""
    other_app = create_app()
    sign_in_as(other_user, other_app)
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=other_app), base_url="http://testserver") as client:
        yield client


def plan_document(**overrides) -> dict:
    """A small plan in the planner's document format."""
    doc = {
        "version": 4,
        "businessDays": 221,
        "pools": [
            {
                "id": "dev",
                "name": "Developer Pool",
                "role": "Developer",
                "color": "#818cf8",
                "members": [
                    {"id": "m1", "name": "Developer 1", "hoursPerDay": 6},
                    {"id": "m2", "name": "Developer 2", "hoursPerDay": 6},
                ],
            }
        ],
        "dayOverrides": {},
        "selectedYear": 2027,
        "swimlanes": [],
        "activities": [
            {
                "id": "a1",
                "laneId": "l1",
                "name": "Activity",
                "mode": "estimate",
                "start": "2027-01-11",
                "end": "2027-03-12",
                "estimate": {"dev": 480},
                "assignments": [],
            }
        ],
    }
    doc.update(overrides)
    return doc


def activity(n: int) -> dict:
    return {"id": f"a{n}", "laneId": "l1", "name": f"Activity {n}", "mode": "estimate", "assignments": []}


async def insert_plan(
    db_session, owner: User, name: str = "Roadmap", data: dict | None = None, age_hours: float = 0, **values
) -> Plan:
    """Adds a plan row directly, as if it had been saved `age_hours` ago."""
    row = Plan(
        owner_id=owner.id,
        name=name,
        data=data if data is not None else plan_document(),
        **{"updated_at": datetime.now(timezone.utc) - timedelta(hours=age_hours), **values},
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row
