# Web app: builds frontend/ and serves it from the FastAPI backend on one origin

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STATIC_DIR=/app/static
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Litestream copies the SQLite database to a Cloud Storage bucket as it changes
# (only when LITESTREAM_REPLICA_URL is set; see backend/start.sh)
ARG LITESTREAM_VERSION=0.3.13
RUN python -c "import urllib.request as u; u.urlretrieve('https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz', '/tmp/ls.tgz')"  && tar -xzf /tmp/ls.tgz -C /usr/local/bin litestream && rm /tmp/ls.tgz

COPY backend/main.py backend/store.py backend/storage.py backend/listing_rules.py backend/db.py backend/deps.py \
     backend/business.py backend/crm.py backend/crm_repo.py backend/orgs_repo.py backend/permissions.py backend/workspace.py backend/workspace_repo.py \
     backend/performance.py backend/performance_repo.py backend/videos.py backend/videos_repo.py backend/video_storage.py backend/start.sh ./
COPY backend/migrations/ ./migrations/
# Windows checkouts can add CR line endings, which sh can't run
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh
COPY --from=web /web/dist ./static

CMD ["./start.sh"]
