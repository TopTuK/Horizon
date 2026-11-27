"""Sessions through the real middleware: the test login, sign-out, and what a session cookie looks like."""

import httpx2
from sqlalchemy import delete

from app.api.routes.auth import TEST_USER_SUB
from app.core.config import settings
from app.main import create_app
from app.models.user import User

ME = "/api/auth/me"


def enable_test_login(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENABLE_TEST_LOGIN", True)


def set_cookie_header(resp) -> str:
    [header] = resp.headers.get_list("set-cookie")
    return header.lower()


async def test_me_is_anonymous_without_a_session(anon_client):
    resp = await anon_client.get(ME)

    assert resp.status_code == 401


async def test_the_test_login_is_off_by_default(anon_client):
    assert (await anon_client.post("/api/dev/test-login")).status_code == 404
    assert "test" not in (await anon_client.get("/api/auth/providers")).json()["providers"]


async def test_the_test_login_offers_a_button_and_starts_a_session(anon_client, monkeypatch):
    enable_test_login(monkeypatch)

    assert "test" in (await anon_client.get("/api/auth/providers")).json()["providers"]
    resp = await anon_client.post("/api/dev/test-login")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test user"

    me = await anon_client.get(ME)
    assert me.status_code == 200
    assert me.json() == resp.json()
    # Signing in twice keeps the one test user.
    await anon_client.post("/api/dev/test-login")
    assert (await anon_client.get(ME)).json() == resp.json()


async def test_sign_out_ends_the_session(anon_client, monkeypatch):
    enable_test_login(monkeypatch)
    await anon_client.post("/api/dev/test-login")

    assert (await anon_client.post("/api/auth/logout")).status_code == 200

    assert (await anon_client.get(ME)).status_code == 401


async def test_the_cookie_is_httponly_and_lax(anon_client, monkeypatch):
    enable_test_login(monkeypatch)

    header = set_cookie_header(await anon_client.post("/api/dev/test-login"))

    assert "httponly" in header
    assert "samesite=lax" in header
    assert "secure" not in header
    assert f"max-age={settings.SESSION_MAX_AGE}" in header


async def test_the_cookie_is_secure_when_asked(monkeypatch):
    enable_test_login(monkeypatch)
    monkeypatch.setattr(settings, "SESSION_COOKIE_SECURE", True)

    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=create_app()), base_url="http://testserver") as client:
        header = set_cookie_header(await client.post("/api/dev/test-login"))

    assert "secure" in header


async def test_a_forged_session_cookie_is_refused(anon_client):
    anon_client.cookies.set(settings.SESSION_COOKIE_NAME, "not-a-signed-session")

    resp = await anon_client.get(ME)

    assert resp.status_code == 401


async def test_the_session_of_a_deleted_user_is_refused(anon_client, db_session, monkeypatch):
    enable_test_login(monkeypatch)
    await anon_client.post("/api/dev/test-login")
    assert (await anon_client.get(ME)).status_code == 200

    await db_session.execute(delete(User).where(User.sub == TEST_USER_SUB))
    await db_session.commit()

    assert (await anon_client.get(ME)).status_code == 401
