"""Sign-in: the providers on offer, login redirects and callbacks, the current user, and sign-out.

A visitor is sent to /auth/login/<provider>, the provider redirects back to the callback path, the
backend exchanges the code, upserts the user and starts the session in a signed HttpOnly cookie.
"""

import logging
from collections.abc import Awaitable, Callable

from authlib.common.errors import AuthlibBaseError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from httpx2 import HTTPError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.oauth import oauth
from app.models.user import User
from app.schemas.user import UserResponse

logger = logging.getLogger(__name__)
router = APIRouter()

PROVIDERS = ("oidc", "yandex", "google")
# Settings naming each provider's callback path, relative to BASE_URL.
_CALLBACK_PATH_SETTINGS = {
    "oidc": "OIDC_CALLBACK_PATH",
    "yandex": "YANDEX_CALLBACK_PATH",
    "google": "GOOGLE_CALLBACK_PATH",
}
# The one user POST /api/dev/test-login signs in, while ENABLE_TEST_LOGIN is on.
TEST_USER_SUB = "test-user"

# Provider-scoped subject, display name and email of a signed-in visitor.
Identity = tuple[str, str | None, str | None]


def _require(provider: str) -> None:
    if provider not in settings.enabled_providers():
        raise HTTPException(status_code=404, detail="Not found")


async def _oidc_identity(request: Request) -> Identity:
    token = await oauth.oidc.authorize_access_token(request)
    userinfo = token.get("userinfo") or await oauth.oidc.userinfo(token=token)
    return userinfo["sub"], userinfo.get("name"), userinfo.get("email")


async def _yandex_identity(request: Request) -> Identity:
    token = await oauth.yandex.authorize_access_token(request)
    # Yandex documents the "OAuth" authorization scheme rather than "Bearer", so the header is sent by hand.
    resp = await oauth.yandex.get(
        "info",
        params={"format": "json"},
        headers={"Authorization": f"OAuth {token['access_token']}"},
        withhold_token=True,
    )
    resp.raise_for_status()
    info = resp.json()
    name = info.get("real_name") or info.get("display_name") or info.get("login")
    # The prefix keeps Yandex ids from colliding with other providers' subjects.
    return f"yandex:{info['id']}", name, info.get("default_email")


async def _google_identity(request: Request) -> Identity:
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo") or await oauth.google.userinfo(token=token)
    return f"google:{userinfo['sub']}", userinfo.get("name"), userinfo.get("email")


_EXCHANGES: dict[str, Callable[[Request], Awaitable[Identity]]] = {
    "oidc": _oidc_identity,
    "yandex": _yandex_identity,
    "google": _google_identity,
}


async def _upsert_user(db: AsyncSession, sub: str, name: str | None, email: str | None) -> User:
    result = await db.execute(select(User).where(User.sub == sub))
    user = result.scalar_one_or_none()
    if user is not None:
        user.name = name
        user.email = email
        return user

    user = User(sub=sub, name=name, email=email)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # Two first sign-ins of one person raced for the same row; keep the one that got there first.
        await db.rollback()
        result = await db.execute(select(User).where(User.sub == sub))
        user = result.scalar_one_or_none()
        assert user is not None
    return user


async def _sign_in(
    request: Request,
    db: AsyncSession,
    exchange: Callable[[], Awaitable[Identity]],
) -> Response:
    """Runs a provider callback and starts the session. A failed exchange sends the visitor back to the
    landing page with ?login=failed, which the page explains."""
    try:
        sub, name, email = await exchange()
    except (AuthlibBaseError, HTTPError, KeyError, TypeError, ValueError) as exc:
        logger.warning("Sign-in failed: %s: %s", type(exc).__name__, exc)
        return RedirectResponse(settings.callback_url("/?login=failed"), status_code=303)

    user = await _upsert_user(db, sub, name, email)
    request.session.clear()
    request.session["user_id"] = str(user.id)
    await db.commit()
    return RedirectResponse(settings.callback_url(""), status_code=303)


@router.get("/api/auth/providers")
async def providers() -> dict[str, list[str]]:
    """Sign-in buttons to show. "test" appears only while the test login is enabled."""
    names = settings.enabled_providers()
    if settings.ENABLE_TEST_LOGIN:
        names = [*names, "test"]
    return {"providers": names}


@router.get("/auth/login/{provider}")
async def login(provider: str, request: Request) -> Response:
    _require(provider)
    callback_path = getattr(settings, _CALLBACK_PATH_SETTINGS[provider])
    client = getattr(oauth, provider)
    return await client.authorize_redirect(request, settings.callback_url(callback_path))


def _callback(provider: str) -> Callable:
    async def signin(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
        _require(provider)
        return await _sign_in(request, db, lambda: _EXCHANGES[provider](request))

    return signin


for _provider in PROVIDERS:
    router.add_api_route(
        getattr(settings, _CALLBACK_PATH_SETTINGS[_provider]),
        _callback(_provider),
        methods=["GET"],
        include_in_schema=False,
        name=f"signin_{_provider}",
    )


@router.post("/api/dev/test-login", response_model=UserResponse)
async def test_login(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """Signs in without a provider. Answers 404 unless ENABLE_TEST_LOGIN is on, which production forbids."""
    if not settings.ENABLE_TEST_LOGIN:
        raise HTTPException(status_code=404, detail="Not found")

    user = await _upsert_user(db, TEST_USER_SUB, "Test user", "test-user@horizon.local")
    request.session.clear()
    request.session["user_id"] = str(user.id)
    await db.commit()
    return user


@router.get("/api/auth/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/api/auth/logout")
async def logout(request: Request) -> dict[str, str]:
    request.session.clear()
    return {"status": "ok"}
