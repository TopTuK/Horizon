"""Container entry point: wait for the database, apply the migrations, then become the server.

Usage: python -m app.bootstrap [server command, default uvicorn]
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core.database import engine

logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parents[1]
WAIT_ATTEMPTS = 30
WAIT_SECONDS = 2.0


async def wait_for_database() -> None:
    for attempt in range(1, WAIT_ATTEMPTS + 1):
        try:
            async with engine.connect() as conn:
                await conn.scalar(text("SELECT 1"))
            return
        except Exception as exc:
            logger.warning("Database not ready (%s of %d): %s", attempt, WAIT_ATTEMPTS, exc.__class__.__name__)
            await asyncio.sleep(WAIT_SECONDS)
    raise SystemExit(f"Database did not become ready after {WAIT_ATTEMPTS} attempts.")


def migrate() -> None:
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(wait_for_database())
    migrate()
    logger.info("Database is up to date")

    # Replace this process with the server, so it keeps PID 1 and receives the container's signals.
    server = sys.argv[1:] or ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
    os.execvp(server[0], server)


if __name__ == "__main__":
    main()
