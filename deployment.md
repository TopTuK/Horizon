# Deployment Guide

Production is intended to run at **https://horizon.pmi.moscow**. A manual GitHub Actions workflow builds and deploys it to a
Docker host that already runs the shared **nginx-proxy**.

Horizon is one application container: the FastAPI backend serves the API and the built Vue app, and keeps plans and
accounts in PostgreSQL.

## Architecture

```
Internet --https--> nginx-proxy --(pmi_network)--> app:8000
                     (shared, TLS)                 FastAPI: /api, /auth and the Vue SPA
                                                        |
                                                     db:5432 (PostgreSQL 16, volume horizon_postgres_data)
```

| Service | Image | Networks | Exposure |
| --- | --- | --- | --- |
| `app` | `horizon:latest` (Python 3.12, FastAPI and the built SPA) | `default`, `pmi_network` | Through nginx-proxy via `VIRTUAL_HOST`; `127.0.0.1:8087` on the host for debugging |
| `db` | `postgres:16-alpine` | `default` | Not published |

- The shared **nginx-proxy** is not part of this repo. It sits on the external docker network `pmi_network`,
  terminates TLS with the `pmi.moscow` certificate and routes by hostname. `app` advertises itself with
  `VIRTUAL_HOST=horizon.pmi.moscow` and `VIRTUAL_PORT=8000`.
- No public host ports are published. The loopback port `127.0.0.1:${WEB_HOST_PORT:-8087}` exists only for
  debugging on the server. `8087` is used so it does not collide with LeanProjectSimulator on `8086`.
- **Data** lives in the named volume `horizon_postgres_data`. It survives `docker compose down` and every redeploy.
  Only `docker compose down -v` or `docker volume rm` removes it: never run those in production.
- **Start-up**: the container's entry point waits for the database, applies the Alembic migrations, then starts the
  server. `GET /health` answers `200` only once the database answers and the migrations have run; the deploy waits
  for it.
- **Safety checks**: with `APP_ENV=production` the application refuses to start on an unsafe configuration and lists
  what is missing: a session secret, an `https://` `BASE_URL`, a secure session cookie, the test sign-in switched
  off, a database URL of its own, and at least one sign-in provider.

Related files:

| File | Purpose |
| --- | --- |
| [Dockerfile](Dockerfile) | Two stages: Node builds the Vue app, a Python image runs the API and serves the build |
| [backend/app/bootstrap.py](backend/app/bootstrap.py) | Container entry point: wait for the database, migrate, start the server |
| [backend/alembic/](backend/alembic/) | Database migrations |
| [docker-compose.yml](docker-compose.yml) | Local stack; builds from source |
| [docker-compose.production.yml](docker-compose.production.yml) | Production stack; runs the prebuilt image, never builds |
| [deploy/vhost.d/horizon.pmi.moscow](deploy/vhost.d/horizon.pmi.moscow) | nginx-proxy server snippet: certificate, TLS protocols and ciphers, HSTS |
| [deploy/vhost.d/horizon.pmi.moscow_location](deploy/vhost.d/horizon.pmi.moscow_location) | nginx-proxy location snippet: body size, gzip, security headers |
| [.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml) | Manual build and deploy workflow |

## Server layout

```
/home/toptuk/horizon/
  docker-compose.production.yml   copied by every deploy
  .env                            written by every deploy (mode 600)
```

## One-time setup

### 1. Server

1. Docker Engine with the Compose plugin, plus the shared nginx-proxy running on `pmi_network`.
2. The proxy network. The deploy creates it if missing, but nginx-proxy needs to be on it:

    ```sh
    docker network inspect pmi_network >/dev/null 2>&1 || docker network create pmi_network
    ```

3. A DNS record for `horizon.pmi.moscow` pointing at the server. The `pmi.moscow` certificate must cover it
   (wildcard `*.pmi.moscow`) and be present in the proxy as `certs/pmi.moscow.crt` / `.key`.
4. The vhost snippets, copied into the proxy's `vhost.d/` directory, followed by a proxy reload:

    ```sh
    scp deploy/vhost.d/horizon.pmi.moscow deploy/vhost.d/horizon.pmi.moscow_location <server>:<rproxy>/vhost.d/
    docker exec <nginx-proxy> nginx -t && docker exec <nginx-proxy> nginx -s reload
    ```

    The pipeline never touches the shared proxy config. Repeat this step whenever these files change.
    If `VIRTUAL_HOST` is not `horizon.pmi.moscow`, rename both snippets to match that hostname.
5. An SSH user that can run `docker` and owns `/home/toptuk/horizon`. The workflow creates the directory.

The snippets already in the proxy need no change for accounts: cookies pass through, and a plan is far below the
`client_max_body_size` of 1 MB.

### 2. Sign-in providers

Register the callback URL of each provider you enable, or that provider's sign-in button fails:

| Provider | Redirect URI | Where |
| --- | --- | --- |
| Organization OIDC | `https://horizon.pmi.moscow/auth/signin-oidc` | Your identity provider |
| Yandex | `https://horizon.pmi.moscow/auth/signin-yandex` | [oauth.yandex.ru](https://oauth.yandex.ru) |
| Google | `https://horizon.pmi.moscow/auth/signin-google` | Google Cloud Console → Credentials → OAuth client ID (*Web application*) |

### 3. GitHub secrets and variables

Set these under **Settings → Secrets and variables → Actions**.

| Kind | Name | Required | Notes |
| --- | --- | --- | --- |
| Secret | `PRODUCTION_SSH_HOST` | yes | Server host name or IP |
| Secret | `PRODUCTION_SSH_USERNAME` | yes | SSH user |
| Secret | `PRODUCTION_SSH_KEY` | yes | Private key (PEM / OpenSSH, full text) |
| Secret | `PRODUCTION_SSH_PORT` | no | Default `22` |
| Secret | `REGISTRY_TOKEN` | yes | GitHub PAT with `read:packages`; the server uses it to pull from GHCR |
| Secret | `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTHORITY` | no | Organization OIDC. `OIDC_AUTHORITY` is the issuer base URL; discovery runs against `/.well-known/openid-configuration` |
| Secret | `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | no | Yandex ID |
| Secret | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google |
| Variable | `DEPLOY_DIR` | no | Default `/home/toptuk/horizon` |
| Variable | `VIRTUAL_HOST` | no | Default `horizon.pmi.moscow` |
| Variable | `WEB_HOST_PORT` | no | Default `8087` |

At least one provider must have its credentials, or the application refuses to start in production. A provider
without credentials is simply not offered.

The build job pushes images with the built-in `GITHUB_TOKEN`, so pushing needs no extra secret.
The package must be readable by the server token. For a private repository, grant the package
`read` access to that token (or make the package public).

**Two secrets are not kept in GitHub**: the database password (`POSTGRES_PASSWORD`) and the session secret
(`SESSION_SECRET_KEY`). The server generates them at the first deploy and keeps them at every later one:

- Changing `SESSION_SECRET_KEY` signs everybody out.
- Changing `POSTGRES_PASSWORD` in `.env` does not change the password of the existing database (it is set when the
  data volume is first created), so the application could no longer connect. Leave both alone.

## Deploying

1. Merge the changes into the branch you deploy from and run **Actions → Manual deploy production → Run workflow**.

The workflow does the following:

1. **Build and push image**: builds the Dockerfile and pushes `ghcr.io/toptuk/horizon:latest`.
2. **Deploy to PROD**:
   1. validates the secrets
   2. renders a `.env` from the provider secrets and the variables
   3. copies `docker-compose.production.yml` and that file to `DEPLOY_DIR`
   4. on the server, adds the database password and the session secret (generating them at the first deploy),
      logs in to GHCR, ensures `pmi_network` exists, pulls the image and retags it as `horizon:latest`
   5. runs `docker compose down --remove-orphans`, then `up -d --wait`: the command only returns once the
      application reports healthy
   6. prunes unused images
3. **Verifies** that `/health` answers on the server.

Expect up to about a minute of unavailability while both containers are recreated and the database comes up.
Plans are in the database volume, so a redeploy loses nothing.

### Upgrading from the static site

The first deploy with accounts replaces the old `web` container, which `down --remove-orphans` removes. Plans that
visitors had kept in their browser are not lost: after signing in, the landing page offers to save that plan to
their account.

On a machine that ran the previous local stack, remove the old container once: `docker compose up --build --remove-orphans`.

### Manual deploy

Do this on the server, for example when GitHub Actions is unavailable. The `.env` from an earlier deploy stays as
it is; a first manual deploy needs one first (copy `.env.example`, then at least `POSTGRES_PASSWORD`,
`SESSION_SECRET_KEY`, `BASE_URL` and one provider's credentials).

```sh
cd /home/toptuk/horizon
echo "$REGISTRY_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
docker pull ghcr.io/toptuk/horizon:latest
docker tag ghcr.io/toptuk/horizon:latest horizon:latest
docker compose -f docker-compose.production.yml up -d --no-build --remove-orphans --wait
```

### Rollback

Images are tagged only `latest`, and the deploy prunes old images. To roll back, deploy older code:

1. Create a branch or tag at the last good commit, for example `git tag rollback-2026-11-26 && git push origin rollback-2026-11-26`.
2. Run **Manual deploy production** and select that tag or branch.

A rollback keeps the data. A migration that dropped data cannot be undone this way; take a backup before deploying a
migration you are unsure about.

### Backups

The plans and accounts are the only data there is, and it is all in one database:

```sh
cd /home/toptuk/horizon
docker compose -f docker-compose.production.yml exec -T db pg_dump -U horizon horizon > horizon-$(date +%F).sql
```

To restore a dump into a fresh database:

```sh
docker compose -f docker-compose.production.yml exec -T db psql -U horizon horizon < horizon-YYYY-MM-DD.sql
```

## Verifying

On the server:

```sh
cd /home/toptuk/horizon
docker compose -f docker-compose.production.yml ps
curl -s http://127.0.0.1:8087/health      # {"status":"ok","database":"ok"}
```

From outside:

```sh
curl -sI https://horizon.pmi.moscow | head -n 5
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `502 Bad Gateway` or the default proxy page | `app` is not on `pmi_network`, not healthy, or the proxy has not picked it up | `docker compose -f docker-compose.production.yml ps` and `logs app`; `docker network inspect pmi_network` should list the `app` container; check `VIRTUAL_HOST` in `.env` and the nginx-proxy logs |
| The `app` container exits at start with `Refusing to start in production` | A required setting is missing or unsafe; the message lists which | Set it in `.env` (or in the GitHub secrets the workflow renders it from) and deploy again |
| `/health` answers `schema missing` | A migration failed | `docker compose -f docker-compose.production.yml logs app` shows the SQL error |
| A sign-in button is missing | That provider has no credentials | Fill in its `*_CLIENT_ID` and `*_CLIENT_SECRET` |
| Sign-in fails and the landing page says so | The callback URL is not registered, the client secret is wrong, or the state did not match | Check the redirect URIs above; `logs app` holds a warning naming the failure |
| Everybody is signed out after a deploy | `SESSION_SECRET_KEY` changed | It should be kept across deploys; compare `.env` with the previous one and put the old value back |
| Certificate warning | The `vhost.d` snippet is missing, or the cert doesn't cover the host | Copy `deploy/vhost.d/*` to the proxy and reload it; check the `certs/pmi.moscow.*` files |
| Deploy fails with `Permission denied (publickey)` | Wrong SSH user or key | Check `PRODUCTION_SSH_USERNAME`, `PRODUCTION_SSH_KEY` and `PRODUCTION_SSH_PORT` |
| `denied` pulling from ghcr.io on the server | `REGISTRY_TOKEN` is missing `read:packages` or has expired | Issue a new PAT and update the secret |
