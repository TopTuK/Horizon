"""Sign-in providers: which are offered, where the buttons lead, and what the callbacks store.
The providers themselves are mocked; no request leaves the test."""

import httpx2
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.oauth import oauth
from app.models.user import User

AUTHORITY = "https://auth.invalid"
GOOGLE = "https://accounts.google.com"
OIDC_METADATA = {
    "issuer": AUTHORITY,
    "authorization_endpoint": f"{AUTHORITY}/authorize",
    "token_endpoint": f"{AUTHORITY}/token",
    "jwks_uri": f"{AUTHORITY}/jwks",
    "userinfo_endpoint": f"{AUTHORITY}/userinfo",
}
GOOGLE_METADATA = {
    "issuer": GOOGLE,
    "authorization_endpoint": f"{GOOGLE}/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
}
AUTHORIZE_ENDPOINTS = {"yandex": "https://oauth.yandex.ru/authorize", "google": f"{GOOGLE}/o/oauth2/v2/auth"}
YANDEX_PROFILE = {"id": "12345", "login": "ivan", "real_name": "Ivan Petrov", "default_email": "ivan@yandex.ru"}


async def users(db_session) -> list[User]:
    return list((await db_session.execute(select(User).order_by(User.sub))).scalars().all())


def set_cookie(resp) -> str | None:
    return resp.headers.get_list("set-cookie")[0] if resp.headers.get_list("set-cookie") else None


def serve_metadata(url: str, document: dict):
    """Answers the one discovery request from the app with `document`, and nothing else."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        assert str(request.url) == url
        return httpx2.Response(200, json=document)

    return httpx2.MockTransport(handler)


serve_oidc_metadata = serve_metadata(f"{AUTHORITY}/.well-known/openid-configuration", OIDC_METADATA)
serve_google_metadata = serve_metadata(f"{GOOGLE}/.well-known/openid-configuration", GOOGLE_METADATA)


def disable(provider: str, monkeypatch) -> None:
    monkeypatch.setattr(settings, f"{provider.upper()}_CLIENT_ID", "")


async def test_every_configured_provider_is_offered(anon_client):
    resp = await anon_client.get("/api/auth/providers")

    assert resp.status_code == 200
    assert resp.json() == {"providers": ["oidc", "yandex", "google"]}


async def test_a_provider_without_credentials_is_neither_offered_nor_reachable(anon_client, monkeypatch):
    disable("google", monkeypatch)

    assert (await anon_client.get("/api/auth/providers")).json() == {"providers": ["oidc", "yandex"]}
    assert (await anon_client.get("/auth/login/google")).status_code == 404
    assert (await anon_client.get(settings.GOOGLE_CALLBACK_PATH)).status_code == 404


async def test_an_unknown_provider_is_404(anon_client):
    assert (await anon_client.get("/auth/login/github")).status_code == 404
    assert (await anon_client.get("/auth/login/test")).status_code == 404


@pytest.mark.parametrize(
    "provider",
    ["yandex", "google"],
)
async def test_login_redirects_to_the_provider_with_our_callback(anon_client, monkeypatch, provider):
    if provider == "google":
        # Google, like any OIDC provider, is configured through its discovery document.
        monkeypatch.setitem(oauth.google.client_kwargs, "transport", serve_google_metadata)

    resp = await anon_client.get(f"/auth/login/{provider}")

    assert resp.status_code == 302
    location = httpx2.URL(resp.headers["location"])
    assert str(location).startswith(AUTHORIZE_ENDPOINTS[provider])
    assert location.params["redirect_uri"] == settings.callback_url(getattr(settings, f"{provider.upper()}_CALLBACK_PATH"))
    assert location.params["client_id"] == getattr(settings, f"{provider.upper()}_CLIENT_ID")
    # The state ties the callback to this login attempt.
    assert location.params["state"]


async def test_oidc_login_reads_the_authority_and_redirects_there(anon_client, monkeypatch):
    monkeypatch.setitem(oauth.oidc.client_kwargs, "transport", serve_oidc_metadata)

    resp = await anon_client.get("/auth/login/oidc")

    assert resp.status_code == 302
    assert resp.headers["location"].startswith(f"{AUTHORITY}/authorize")


async def test_yandex_callback_signs_in_a_new_user(anon_client, db_session, monkeypatch):
    async def fake_token(request):
        return {"access_token": "yandex-token", "token_type": "token"}

    def info_endpoint(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        return httpx2.Response(200, json=YANDEX_PROFILE)

    sent: list[httpx2.Request] = []
    monkeypatch.setattr(oauth.yandex, "authorize_access_token", fake_token)
    monkeypatch.setitem(oauth.yandex.client_kwargs, "transport", httpx2.MockTransport(info_endpoint))

    resp = await anon_client.get(settings.YANDEX_CALLBACK_PATH)

    assert resp.status_code == 303
    assert resp.headers["location"] == settings.BASE_URL
    assert settings.SESSION_COOKIE_NAME in resp.cookies
    # Yandex is asked for the profile with the scheme it documents.
    assert len(sent) == 1
    assert str(sent[0].url.copy_with(query=None)) == "https://login.yandex.ru/info"
    assert sent[0].headers["Authorization"] == "OAuth yandex-token"

    [user] = await users(db_session)
    assert user.sub == "yandex:12345"
    assert user.name == "Ivan Petrov"
    assert user.email == "ivan@yandex.ru"
    me = await anon_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"id": str(user.id), "name": "Ivan Petrov", "email": "ivan@yandex.ru"}


@pytest.mark.parametrize(
    "provider, token, sub, name",
    [
        ("google", {"userinfo": {"sub": "g-777", "name": "Jane Doe", "email": "jane@gmail.com"}}, "google:g-777", "Jane Doe"),
        ("oidc", {"userinfo": {"sub": "sub-1", "name": "Ola Nordmann", "email": "ola@example.org"}}, "sub-1", "Ola Nordmann"),
    ],
)
async def test_callback_signs_in_a_new_user(anon_client, db_session, monkeypatch, provider, token, sub, name):
    async def fake_token(request):
        return token

    monkeypatch.setattr(getattr(oauth, provider), "authorize_access_token", fake_token)

    resp = await anon_client.get(getattr(settings, f"{provider.upper()}_CALLBACK_PATH"))

    assert resp.status_code == 303
    assert settings.SESSION_COOKIE_NAME in resp.cookies
    [user] = await users(db_session)
    assert (user.sub, user.name) == (sub, name)


async def test_signing_in_again_updates_the_profile_without_duplicating_the_user(anon_client, db_session, monkeypatch):
    tokens = iter(
        [
            {"userinfo": {"sub": "g-777", "name": "Jane Doe", "email": "jane@gmail.com"}},
            {"userinfo": {"sub": "g-777", "name": "Jane Smith", "email": "jane.smith@gmail.com"}},
        ]
    )

    async def fake_token(request):
        return next(tokens)

    monkeypatch.setattr(oauth.google, "authorize_access_token", fake_token)

    for _ in range(2):
        assert (await anon_client.get(settings.GOOGLE_CALLBACK_PATH)).status_code == 303

    [user] = await users(db_session)
    assert (user.name, user.email) == ("Jane Smith", "jane.smith@gmail.com")


async def test_a_callback_without_a_login_attempt_fails_closed(anon_client, db_session):
    # The state was never issued by this server, so nothing may be exchanged for it.
    resp = await anon_client.get(f"{settings.GOOGLE_CALLBACK_PATH}?code=forged&state=forged&scope=openid")

    assert resp.status_code == 303
    assert resp.headers["location"] == f"{settings.BASE_URL}/?login=failed"
    assert settings.SESSION_COOKIE_NAME not in resp.cookies
    assert await users(db_session) == []


async def test_a_failed_exchange_sends_the_visitor_back(anon_client, db_session, monkeypatch):
    async def failing_token(request):
        raise httpx2.ConnectError("provider unreachable")

    monkeypatch.setattr(oauth.google, "authorize_access_token", failing_token)

    resp = await anon_client.get(settings.GOOGLE_CALLBACK_PATH)

    assert resp.status_code == 303
    assert resp.headers["location"] == f"{settings.BASE_URL}/?login=failed"
    assert settings.SESSION_COOKIE_NAME not in resp.cookies
    assert await users(db_session) == []


async def test_a_disabled_provider_refuses_its_callback(anon_client, monkeypatch):
    disable("yandex", monkeypatch)

    assert (await anon_client.get(settings.YANDEX_CALLBACK_PATH)).status_code == 404
