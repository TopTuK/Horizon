"""The schema in the database comes from Alembic. This keeps the migrations and the models in step:
when a model changes without a migration, the test fails."""

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext

import app.models  # noqa: F401  (registers the tables on Base.metadata)
from app.core.database import Base, engine


def differences(sync_connection) -> list:
    context = MigrationContext.configure(sync_connection, opts={"compare_type": True})
    return compare_metadata(context, Base.metadata)


async def test_the_models_match_the_migrations(db_session):
    async with engine.connect() as connection:
        diff = await connection.run_sync(differences)

    assert diff == []
