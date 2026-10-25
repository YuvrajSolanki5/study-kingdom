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

# Client tools that need no connection, such as pg_restore -f -.
pg_offline() {
  if [[ -n "${PGTOOLS_CONTAINER:-}" ]]; then
    docker exec -i "$PGTOOLS_CONTAINER" "$@"
  else
    "$@"
  fi
}
