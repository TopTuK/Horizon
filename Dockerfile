# Stage 1: the Vue app, built with Node.
# The workdir sits next to /build/docs so the landing page can import the README screenshots.
FROM node:22-alpine AS frontend

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src
COPY docs /build/docs
RUN npm run build

# Stage 2: the API, which also serves the built app. One image, one container.
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

RUN groupadd --system horizon && useradd --system --gid horizon horizon

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini
COPY --from=frontend /build/frontend/dist ./static

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

USER horizon
# The entry point waits for the database, applies the migrations, then becomes the server.
ENTRYPOINT ["python", "-m", "app.bootstrap"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
