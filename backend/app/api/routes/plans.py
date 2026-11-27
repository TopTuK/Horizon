"""Plans. Every route sees only the signed-in user's own plans; anyone else's plan answers 404."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.plan import Plan
from app.models.user import User
from app.schemas.plan import PlanContentUpdate, PlanCreate, PlanOut, PlanRename, PlanSummary
from app.services.plans import check_plan_data, to_out, to_summary

router = APIRouter()

CurrentUser = Annotated[User, Depends(get_current_user)]
Db = Annotated[AsyncSession, Depends(get_db)]


async def _owned_plan(db: AsyncSession, owner: User, plan_id: uuid.UUID, *, lock: bool = False) -> Plan:
    stmt = select(Plan).where(Plan.id == plan_id, Plan.owner_id == owner.id)
    if lock:
        stmt = stmt.with_for_update()
    plan = (await db.execute(stmt)).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.get("", response_model=list[PlanSummary])
async def list_plans(user: CurrentUser, db: Db) -> list[PlanSummary]:
    """The user's plans, most recently changed first."""
    stmt = select(Plan).where(Plan.owner_id == user.id).order_by(Plan.updated_at.desc(), Plan.id)
    plans = (await db.execute(stmt)).scalars().all()
    return [to_summary(plan) for plan in plans]


@router.post("", response_model=PlanOut, status_code=201)
async def create_plan(payload: PlanCreate, user: CurrentUser, db: Db) -> PlanOut:
    check_plan_data(payload.data, settings.PLAN_MAX_BYTES)
    plan = Plan(owner_id=user.id, name=payload.name, data=payload.data)
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return to_out(plan)


@router.get("/{plan_id}", response_model=PlanOut)
async def get_plan(plan_id: uuid.UUID, user: CurrentUser, db: Db) -> PlanOut:
    return to_out(await _owned_plan(db, user, plan_id))


@router.put("/{plan_id}", response_model=PlanSummary)
async def save_plan(plan_id: uuid.UUID, payload: PlanContentUpdate, user: CurrentUser, db: Db):
    """Replaces the document. The row lock keeps two saves of one revision from both passing the check."""
    plan = await _owned_plan(db, user, plan_id, lock=True)
    check_plan_data(payload.data, settings.PLAN_MAX_BYTES)
    if plan.revision != payload.revision:
        # Read before the rollback, which expires the row.
        current_revision = plan.revision
        await db.rollback()
        return JSONResponse(
            status_code=409,
            content={
                "detail": "The plan was changed elsewhere since it was loaded.",
                "current_revision": current_revision,
            },
        )

    plan.data = payload.data
    plan.revision += 1
    await db.commit()
    await db.refresh(plan)
    return to_summary(plan)


@router.patch("/{plan_id}", response_model=PlanSummary)
async def rename_plan(plan_id: uuid.UUID, payload: PlanRename, user: CurrentUser, db: Db) -> PlanSummary:
    plan = await _owned_plan(db, user, plan_id)
    # Renaming is not an edit of the plan, so updated_at keeps its value.
    await db.execute(update(Plan).where(Plan.id == plan.id).values(name=payload.name, updated_at=Plan.updated_at))
    await db.commit()
    await db.refresh(plan)
    return to_summary(plan)


@router.delete("/{plan_id}", status_code=204)
async def delete_plan(plan_id: uuid.UUID, user: CurrentUser, db: Db) -> Response:
    plan = await _owned_plan(db, user, plan_id)
    await db.delete(plan)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
