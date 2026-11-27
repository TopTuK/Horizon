"""Plan documents: what the server checks about them, and what it reports about them."""

import json

from app.models.plan import Plan
from app.schemas.plan import PlanOut, PlanSummary

REQUIRED_ARRAYS = ("pools", "swimlanes", "activities")


class InvalidPlanData(ValueError):
    """The document is not one an editor could open (HTTP 422)."""


class PlanTooLarge(ValueError):
    """The document is above the configured limit (HTTP 413)."""


def check_plan_data(data: dict, max_bytes: int) -> None:
    """Raises InvalidPlanData or PlanTooLarge. Everything else about the document is the editor's business."""
    version = data.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise InvalidPlanData("data.version must be an integer.")
    missing = [key for key in REQUIRED_ARRAYS if not isinstance(data.get(key), list)]
    if len(missing) == 1:
        raise InvalidPlanData(f"data.{missing[0]} must be an array.")
    if missing:
        raise InvalidPlanData("data must contain arrays: " + ", ".join(missing) + ".")
    try:
        size = len(json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8"))
    except ValueError:
        raise InvalidPlanData("data holds a number that is not finite (NaN or infinity).") from None
    if size > max_bytes:
        raise PlanTooLarge(f"The plan is {size:,} bytes; the limit is {max_bytes:,}.")


def document_stats(data: dict) -> dict:
    """Activity and people counts of a document, tolerating one the editor cannot open."""
    activities = data.get("activities")
    pools = data.get("pools")
    year = data.get("selectedYear")
    return {
        "activity_count": len(activities) if isinstance(activities, list) else 0,
        "member_count": sum(
            len(pool["members"])
            for pool in (pools if isinstance(pools, list) else [])
            if isinstance(pool, dict) and isinstance(pool.get("members"), list)
        ),
        "selected_year": year if isinstance(year, int) and not isinstance(year, bool) else None,
    }


def to_summary(plan: Plan) -> PlanSummary:
    return PlanSummary(
        id=plan.id,
        name=plan.name,
        revision=plan.revision,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        **document_stats(plan.data or {}),
    )


def to_out(plan: Plan) -> PlanOut:
    return PlanOut(**to_summary(plan).model_dump(), data=plan.data)
