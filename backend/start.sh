#!/bin/sh
# Starts the web app. With LITESTREAM_REPLICA_URL set (for example
# gcs://my-bucket/db), the database is restored from the bucket on start and
# every change is copied back within about a second, so it survives deploys
# and idle shutdowns. Without it, the database stays on the container's disk.
set -e

DB="${DATABASE_PATH:-/data/smartland.db}"
mkdir -p "$(dirname "$DB")"
APP="uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"

if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  litestream restore -if-db-not-exists -if-replica-exists -o "$DB" "$LITESTREAM_REPLICA_URL"
  exec litestream replicate -exec "$APP" "$DB" "$LITESTREAM_REPLICA_URL"
fi

exec $APP
