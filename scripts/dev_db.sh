#!/usr/bin/env bash
# Start a local development PostgreSQL 17 + pgvector container (rootless podman or docker).
# Credentials here are for local development only; production uses DATABASE_URL from the environment.
set -euo pipefail
ENGINE="${CONTAINER_ENGINE:-$(command -v podman || command -v docker)}"
NAME="${DB_CONTAINER_NAME:-icr-postgres}"
PORT="${DB_PORT:-5433}"

if "$ENGINE" container exists "$NAME" 2>/dev/null || "$ENGINE" ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  "$ENGINE" start "$NAME" >/dev/null
else
  "$ENGINE" run -d --name "$NAME" \
    -e POSTGRES_USER=icr -e POSTGRES_PASSWORD=icr_dev_password -e POSTGRES_DB=icr \
    -p "127.0.0.1:${PORT}:5432" -v icr-pgdata:/var/lib/postgresql/data \
    docker.io/pgvector/pgvector:pg17 >/dev/null
fi
for _ in $(seq 1 30); do
  if "$ENGINE" exec "$NAME" pg_isready -U icr -d icr >/dev/null 2>&1; then
    "$ENGINE" exec "$NAME" psql -U icr -d icr -c "CREATE DATABASE icr_test" >/dev/null 2>&1 || true
    echo "PostgreSQL ready on 127.0.0.1:${PORT} (databases: icr, icr_test)"; exit 0
  fi
  sleep 1
done
echo "PostgreSQL did not become ready" >&2; exit 1
