"""Plans: validation, ownership and the revision check. Requests are signed in through a dependency
override; the sign-in flow itself is covered in test_auth.py."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.plan import Plan
from tests.conftest import activity, insert_plan, plan_document

PLAN_ID = uuid.uuid4()
OWN_PLAN = f"/api/plans/{PLAN_ID}"


def own(plan) -> str:
    return f"/api/plans/{plan.id}"


async def test_every_plan_route_requires_a_session(anon_client):
    responses = [
        await anon_client.get("/api/plans"),
        await anon_client.post("/api/plans", json={"name": "Roadmap", "data": plan_document()}),
        await anon_client.get(OWN_PLAN),
        await anon_client.put(OWN_PLAN, json={"data": plan_document(), "revision": 1}),
        await anon_client.patch(OWN_PLAN, json={"name": "Renamed"}),
        await anon_client.delete(OWN_PLAN),
    ]

    assert [r.status_code for r in responses] == [401] * 6


async def test_create_returns_the_plan_with_its_counts(api_client):
    document = plan_document(activities=[activity(1), activity(2), activity(3)])

    resp = await api_client.post("/api/plans", json={"name": "  Roadmap 2027  ", "data": document})

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Roadmap 2027"
    assert body["revision"] == 1
    assert body["activity_count"] == 3
    assert body["member_count"] == 2
    assert body["selected_year"] == 2027
    assert body["data"] == document


async def test_create_keeps_non_ascii_text(api_client):
    document = plan_document(swimlanes=[{"id": "l1", "name": "Поддержка KNIS"}])

    resp = await api_client.post("/api/plans", json={"name": "План 2027", "data": document})

    assert resp.status_code == 201
    assert resp.json()["name"] == "План 2027"
    assert resp.json()["data"] == document


@pytest.mark.parametrize(
    "data, complaint",
    [
        ({"pools": [], "swimlanes": [], "activities": []}, "data.version"),
        ({"version": "4", "pools": [], "swimlanes": [], "activities": []}, "data.version"),
        ({"version": True, "pools": [], "swimlanes": [], "activities": []}, "data.version"),
        ({"version": 4, "pools": {}, "swimlanes": [], "activities": []}, "data.pools"),
        ({"version": 4, "pools": [], "swimlanes": "none", "activities": []}, "data.swimlanes"),
        ({"version": 4, "pools": [], "swimlanes": [], "activities": "none"}, "data.activities"),
        ({"version": 4}, "pools, swimlanes, activities"),
    ],
)
async def test_create_rejects_a_document_the_editor_could_not_open(api_client, data, complaint):
    resp = await api_client.post("/api/plans", json={"name": "Roadmap", "data": data})

    assert resp.status_code == 422
    assert complaint in resp.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"data": plan_document()},
        {"name": "   ", "data": plan_document()},
        {"name": "x" * 256, "data": plan_document()},
        {"name": "Roadmap", "data": [1]},
    ],
)
async def test_create_rejects_malformed_requests(api_client, payload):
    resp = await api_client.post("/api/plans", json=payload)

    assert resp.status_code == 422


async def test_create_rejects_a_plan_past_the_size_limit(api_client, monkeypatch):
    monkeypatch.setattr(settings, "PLAN_MAX_BYTES", 300)
    document = plan_document(activities=[activity(n) for n in range(20)])

    resp = await api_client.post("/api/plans", json={"name": "Big", "data": document})

    assert resp.status_code == 413
    assert "limit is 300" in resp.json()["detail"]


async def test_oversized_request_bodies_are_refused(api_client):
    resp = await api_client.post("/api/plans", content=b"x" * (settings.PLAN_MAX_BYTES + 4097))

    assert resp.status_code == 413


async def test_an_oversized_body_is_refused_even_when_it_arrives_without_a_length(api_client):
    async def chunks():
        yield b'{"name": "Big", "data": {"filler": "'
        for _ in range(30):
            yield b"x" * 40_000
        yield b'"}}'

    resp = await api_client.post("/api/plans", content=chunks(), headers={"Content-Type": "application/json"})

    assert resp.status_code == 413


async def test_a_plan_holding_a_non_finite_number_is_rejected(api_client):
    body = '{"name": "Roadmap", "data": {"version": 4, "pools": [], "swimlanes": [], "activities": [], "x": NaN}}'

    resp = await api_client.post("/api/plans", content=body, headers={"Content-Type": "application/json"})

    assert resp.status_code == 422
    assert "not finite" in resp.json()["detail"]


async def test_list_shows_own_plans_most_recently_changed_first(api_client, db_session, user, other_user):
    await insert_plan(db_session, user, name="Older", age_hours=5)
    await insert_plan(db_session, other_user, name="Not mine", age_hours=0)
    await insert_plan(db_session, user, name="Newer", age_hours=1)

    resp = await api_client.get("/api/plans")

    assert resp.status_code == 200
    listed = resp.json()
    assert [p["name"] for p in listed] == ["Newer", "Older"]
    assert all("data" not in p for p in listed)


async def test_other_users_plans_do_not_exist_for_you(api_client, other_client, db_session, user):
    plan = await insert_plan(db_session, user, name="Mine")

    responses = [
        await other_client.get(own(plan)),
        await other_client.put(own(plan), json={"data": plan_document(), "revision": 1}),
        await other_client.patch(own(plan), json={"name": "Stolen"}),
        await other_client.delete(own(plan)),
    ]

    assert [r.status_code for r in responses] == [404] * 4
    body = (await api_client.get(own(plan))).json()
    assert (body["name"], body["revision"]) == ("Mine", 1)


async def test_an_unknown_plan_is_404(api_client):
    resp = await api_client.get(f"/api/plans/{uuid.uuid4()}")

    assert resp.status_code == 404


async def test_save_replaces_the_document_and_bumps_the_revision(api_client, db_session, user):
    plan = await insert_plan(db_session, user)
    document = plan_document(activities=[activity(1), activity(2)])

    resp = await api_client.put(own(plan), json={"data": document, "revision": 1})

    assert resp.status_code == 200
    assert (resp.json()["revision"], resp.json()["activity_count"]) == (2, 2)
    saved = (await api_client.get(own(plan))).json()
    assert saved["data"] == document
    assert saved["revision"] == 2


async def test_a_save_from_a_stale_revision_is_rejected(api_client, db_session, user):
    plan = await insert_plan(db_session, user)
    await api_client.put(own(plan), json={"data": plan_document(activities=[activity(9)]), "revision": 1})

    resp = await api_client.put(own(plan), json={"data": plan_document(activities=[activity(8)]), "revision": 1})

    assert resp.status_code == 409
    assert resp.json()["current_revision"] == 2
    # The first save is what the server keeps.
    stored = (await api_client.get(own(plan))).json()
    assert [a["id"] for a in stored["data"]["activities"]] == ["a9"]
    assert stored["revision"] == 2


async def test_a_save_is_validated_like_a_create(api_client, db_session, user):
    plan = await insert_plan(db_session, user)

    resp = await api_client.put(own(plan), json={"data": {"version": 4}, "revision": 1})

    assert resp.status_code == 422
    assert (await api_client.get(own(plan))).json()["revision"] == 1


async def test_rename_does_not_count_as_an_edit(api_client, db_session, user):
    saved_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    plan = await insert_plan(db_session, user, name="Before", updated_at=saved_at)

    resp = await api_client.patch(own(plan), json={"name": "  After  "})

    assert resp.status_code == 200
    assert (resp.json()["name"], resp.json()["revision"]) == ("After", 1)
    assert datetime.fromisoformat(resp.json()["updated_at"]) == saved_at


async def test_delete_removes_the_plan(api_client, db_session, user):
    plan = await insert_plan(db_session, user)

    assert (await api_client.delete(own(plan))).status_code == 204
    assert (await api_client.get(own(plan))).status_code == 404
    assert (await api_client.get("/api/plans")).json() == []


async def test_deleting_an_account_removes_its_plans(db_session, user):
    plan = await insert_plan(db_session, user)

    await db_session.delete(user)
    await db_session.commit()

    remaining = await db_session.scalar(select(Plan.id).where(Plan.id == plan.id))
    assert remaining is None
