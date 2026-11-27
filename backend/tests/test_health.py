"""The container health check."""

from sqlalchemy import text

from app import main
from app.core import database


async def test_health_reports_a_ready_database(anon_client):
    resp = await anon_client.get("/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "database": "ok"}


async def test_health_fails_while_the_database_is_down(anon_client, monkeypatch):
    class Unreachable:
        def connect(self):
            raise OSError("connection refused")

    monkeypatch.setattr(database, "engine", Unreachable())

    resp = await anon_client.get("/health")

    assert resp.status_code == 503
    assert resp.json() == {"status": "error", "database": "unavailable"}


async def test_health_fails_until_the_migrations_have_run(anon_client, monkeypatch):
    # The plans table is missing.
    monkeypatch.setattr(main, "text", lambda sql: text("SELECT false"))

    resp = await anon_client.get("/health")

    assert resp.status_code == 503
    assert resp.json() == {"status": "error", "database": "schema missing"}
