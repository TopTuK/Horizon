"""Horizon API: sign-in, plans and health. In production the same process serves the built SPA."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from app.api.routes import auth, plans
from app.core import database
from app.core.config import settings
from app.services.plans import InvalidPlanData, PlanTooLarge

logger = logging.getLogger(__name__)

# The built SPA, copied here by the Dockerfile.
STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
# Vite gives files in this directory content-hashed names, so browsers may cache them for good.
ASSETS = "/assets"


class HashedAssets(StaticFiles):
    """Static files whose names change whenever their content does."""

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def _serve_spa(app: FastAPI, static_dir: Path) -> None:
    root = static_dir.resolve()
    index = root / "index.html"
    if (root / "assets").is_dir():
        app.mount(ASSETS, HashedAssets(directory=root / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        # Unknown API paths stay JSON 404s rather than answering with the SPA shell.
        if full_path.startswith(("api/", "auth/")):
            raise HTTPException(status_code=404, detail="Not found")
        # Only files inside the static directory are served; everything else is a client-side route.
        candidate = (root / full_path).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            candidate = index
        return FileResponse(candidate, headers={"Cache-Control": "no-cache"})


def create_app(static_dir: Path = STATIC_DIR) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        await database.engine.dispose()

    app = FastAPI(
        title="Horizon API",
        version="1.0.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
        # Enforced while the body is read, so it holds for chunked requests too. PLAN_MAX_BYTES leaves
        # room for the JSON envelope around a plan document.
        max_body_size=settings.PLAN_MAX_BYTES + 4096,
    )
    # A signed cookie that never reaches JavaScript carries the session.
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret_key,
        session_cookie=settings.SESSION_COOKIE_NAME,
        max_age=settings.SESSION_MAX_AGE,
        same_site="lax",
        https_only=settings.SESSION_COOKIE_SECURE,
    )

    @app.exception_handler(InvalidPlanData)
    async def invalid_plan_data(request: Request, exc: InvalidPlanData) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(PlanTooLarge)
    async def plan_too_large(request: Request, exc: PlanTooLarge) -> JSONResponse:
        return JSONResponse(status_code=413, content={"detail": str(exc)})

    @app.get("/health")
    async def health():
        """Used by the container health check and the deploy: fails until the database answers and the
        migrations have run."""
        try:
            async with database.engine.connect() as conn:
                migrated = await conn.scalar(text("SELECT to_regclass('public.plans') IS NOT NULL"))
        except Exception as exc:  # the database is down or rejects the connection
            logger.error("Health check: database unavailable: %s", exc.__class__.__name__)
            return JSONResponse(status_code=503, content={"status": "error", "database": "unavailable"})

        if not migrated:
            logger.error("Health check: the plans table is missing; run the migrations.")
            return JSONResponse(status_code=503, content={"status": "error", "database": "schema missing"})
        return {"status": "ok", "database": "ok"}

    app.include_router(auth.router, tags=["auth"])
    app.include_router(plans.router, prefix="/api/plans", tags=["plans"])

    if static_dir.is_dir():
        _serve_spa(app, static_dir)
    return app


settings.check_startup()
app = create_app()
