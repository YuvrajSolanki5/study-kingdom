#!/usr/bin/env bash
# Disposable PostgreSQL 17 for integration tests (port 54329).
#   scripts/test-db.sh up|down
set -euo pipefail
NAME=sk-test-pg
case "${1:-up}" in
  up)
    if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
      docker rm -f "$NAME" >/dev/null 2>&1 || true
      docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17-alpine >/dev/null
    fi
    for _ in $(seq 1 30); do
      docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && { echo "test database ready on 127.0.0.1:54329"; exit 0; }
      sleep 1
    done
    echo "database did not become ready" >&2; exit 1 ;;
  down) docker rm -f "$NAME" >/dev/null && echo "removed $NAME" ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
