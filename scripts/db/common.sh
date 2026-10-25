#!/usr/bin/env bash
# PGTOOLS_CONTAINER optionally uses PostgreSQL tools already in a local container.
pg_tool() {
  local connection="$1"; shift
  (
    export PGDATABASE="$connection"
    if [[ -n "${PGTOOLS_CONTAINER:-}" ]]; then
      docker exec -i "$PGTOOLS_CONTAINER" "$@" --dbname="$connection"
    else
      "$@" --dbname="$connection"
    fi
  )
}
