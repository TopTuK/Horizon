# Deployment Guide

Production is intended to run at **https://horizon.pmi.moscow**. A manual GitHub Actions workflow builds and deploys it to a
Docker host that already runs the shared **nginx-proxy**.

Horizon is a static site. Plans stay in the browser, so the stack is a single nginx container.

## Architecture

```
Internet --https--> nginx-proxy --(pmi_network)--> web:80
                    (shared, TLS)                  nginx + Vue SPA
```

| Service | Image | Networks | Exposure |
| --- | --- | --- | --- |
| `web` | `horizon-web:latest` (nginx serving the built SPA) | `default`, `pmi_network` | Through nginx-proxy via `VIRTUAL_HOST`; `127.0.0.1:8087` on the host for debugging |

- The shared **nginx-proxy** is not part of this repo. It sits on the external docker network `pmi_network`,
  terminates TLS with the `pmi.moscow` certificate and routes by hostname. `web` advertises itself with
  `VIRTUAL_HOST=horizon.pmi.moscow` and `VIRTUAL_PORT=80`.
- No public host ports are published. The loopback port `127.0.0.1:${WEB_HOST_PORT:-8087}` exists only for
  debugging on the server. `8087` is used so it does not collide with LeanProjectSimulator on `8086`.

Related files:

| File | Purpose |
| --- | --- |
| [Dockerfile](Dockerfile) | Multi-stage build: Node compiles the Vite app, nginx serves `dist` |
| [nginx.conf](nginx.conf) | nginx inside `web`; SPA fallback to `index.html` |
| [docker-compose.yml](docker-compose.yml) | Local stack; builds from source |
| [docker-compose.production.yml](docker-compose.production.yml) | Production stack; runs the prebuilt image, never builds |
| [deploy/vhost.d/horizon.pmi.moscow](deploy/vhost.d/horizon.pmi.moscow) | nginx-proxy server snippet: certificate, TLS protocols and ciphers, HSTS |
| [deploy/vhost.d/horizon.pmi.moscow_location](deploy/vhost.d/horizon.pmi.moscow_location) | nginx-proxy location snippet: body size, gzip, security headers |
| [.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml) | Manual build and deploy workflow |

## Server layout

```
/home/toptuk/horizon/
  docker-compose.production.yml   copied by every deploy
  .env                            rendered from GitHub variables by every deploy (mode 600)
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

### 2. GitHub secrets and variables

Set these under **Settings → Secrets and variables → Actions**. The workflow checks the required ones and fails
early with a clear message if one is missing.

| Kind | Name | Required | Notes |
| --- | --- | --- | --- |
| Secret | `PRODUCTION_SSH_HOST` | yes | Server host name or IP |
| Secret | `PRODUCTION_SSH_USERNAME` | yes | SSH user |
| Secret | `PRODUCTION_SSH_KEY` | yes | Private key (PEM / OpenSSH, full text) |
| Secret | `PRODUCTION_SSH_PORT` | no | Default `22` |
| Secret | `REGISTRY_TOKEN` | yes | GitHub PAT with `read:packages`; the server uses it to pull from GHCR |
| Variable | `DEPLOY_DIR` | no | Default `/home/toptuk/horizon` |
| Variable | `VIRTUAL_HOST` | no | Default `horizon.pmi.moscow` |
| Variable | `WEB_HOST_PORT` | no | Default `8087` |

The build job pushes images with the built-in `GITHUB_TOKEN`, so pushing needs no extra secret.
The package must be readable by the server token. For a private repository, grant the package
`read` access to that token (or make the package public).

## Deploying

1. Merge the changes into the branch you deploy from and run **Actions → Manual deploy production → Run workflow**.

The workflow does the following:

1. **Build and push images**: builds the Dockerfile and pushes `ghcr.io/toptuk/horizon-web:latest`.
2. **Deploy to PROD**:
   1. validates the secrets
   2. renders `.env` from variables
   3. copies `docker-compose.production.yml` and `.env` to `DEPLOY_DIR`
   4. on the server, logs in to GHCR, ensures `pmi_network` exists, pulls the image and retags it as
      `horizon-web:latest`
   5. runs `docker compose down` followed by `up -d --force-recreate`, then prunes unused images

Expect a few seconds of downtime while the container is recreated. Plans live in the browser, so a
redeploy does not erase them.

### Manual deploy

Do this on the server, for example when GitHub Actions is unavailable:

```sh
cd /home/toptuk/horizon
echo "$REGISTRY_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
docker pull ghcr.io/toptuk/horizon-web:latest
docker tag ghcr.io/toptuk/horizon-web:latest horizon-web:latest
docker compose -f docker-compose.production.yml up -d --no-build --remove-orphans
```

### Rollback

Images are tagged only `latest`, and the deploy prunes old images. To roll back, deploy older code:

1. Create a branch or tag at the last good commit, for example `git tag rollback-2026-11-22 && git push origin rollback-2026-11-22`.
2. Run **Manual deploy production** and select that tag or branch.

## Verifying

On the server:

```sh
cd /home/toptuk/horizon
docker compose -f docker-compose.production.yml ps
curl -sI http://127.0.0.1:8087/ | head -n 5
```

From outside:

```sh
curl -sI https://horizon.pmi.moscow | head -n 5
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `502 Bad Gateway` or the default proxy page | `web` is not on `pmi_network`, or the proxy hasn't picked it up | `docker network inspect pmi_network` should list the `web` container; check `VIRTUAL_HOST` in `.env` and the nginx-proxy logs |
| Certificate warning | The `vhost.d` snippet is missing, or the cert doesn't cover the host | Copy `deploy/vhost.d/*` to the proxy and reload it; check the `certs/pmi.moscow.*` files |
| Deploy fails with `Permission denied (publickey)` | Wrong SSH user or key | Check `PRODUCTION_SSH_USERNAME`, `PRODUCTION_SSH_KEY` and `PRODUCTION_SSH_PORT` |
| `denied` pulling from ghcr.io on the server | `REGISTRY_TOKEN` is missing `read:packages` or has expired | Issue a new PAT and update the secret |
