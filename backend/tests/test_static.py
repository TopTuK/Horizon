"""The production layout, where the API also serves the built SPA."""

import httpx2
import pytest
import pytest_asyncio

from app.main import create_app

SHELL = "<html>Horizon shell</html>"


@pytest.fixture
def site(tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "icons").mkdir()
    (static / "index.html").write_text(SHELL)
    (static / "assets" / "app.abc123.js").write_text("console.log('app')")
    (static / "icons" / "logo.png").write_bytes(b"\x89PNG")
    (tmp_path / "secret.txt").write_text("outside the static directory")
    return static


@pytest_asyncio.fixture
async def client(site):
    app = create_app(site)
    async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://testserver") as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/plan/123", "/anything/else"])
async def test_client_side_routes_get_the_shell(client, path):
    resp = await client.get(path)

    assert resp.status_code == 200
    assert SHELL in resp.text
    assert resp.headers["cache-control"] == "no-cache"


async def test_files_are_served(client):
    logo = await client.get("/icons/logo.png")

    assert logo.status_code == 200
    assert logo.content == b"\x89PNG"
    assert (await client.get("/index.html")).text == SHELL


async def test_hashed_assets_may_be_cached_for_good(client):
    resp = await client.get("/assets/app.abc123.js")

    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert (await client.get("/assets/missing.js")).status_code == 404


@pytest.mark.parametrize("path", ["/api/nope", "/auth/nope", "/api/plans/"])
async def test_unknown_server_paths_stay_json_404(client, path):
    resp = await client.get(path)

    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")


async def test_nothing_outside_the_static_directory_is_served(client):
    resp = await client.get("/%2e%2e/secret.txt")

    assert resp.status_code == 200
    assert "outside" not in resp.text
    assert SHELL in resp.text
