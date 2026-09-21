#!/usr/bin/env bash
# Runs the pgTAP integration battery under supabase/tests/ (SDD task 4.2).
#
# Usage (from the repository root):
#   npm run test:db            # every supabase/tests/*.sql file
#   npm run test:db -- <path>  # a specific test file or directory
#
# The target database must already carry the project schema plus this
# repository's migrations (phase9..phase12); a local stack linked to the project
# provides that. The battery is self-contained and rolls its own fixtures back,
# so it never mutates ambient data.
#
# Environment:
#   SUPABASE_TEST_DB_URL   Postgres connection string reachable from the host.
#                          Defaults to the standard local Supabase stack.
#   SUPABASE_TEST_NETWORK  Docker network of the running stack. Set it when the
#                          stack was started from another project directory,
#                          e.g. supabase_network_conexion-db.
set -euo pipefail

self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(cd "$(dirname "$0")" && pwd)/.."

# The Supabase CLI shells into Docker to run pg_prove. Re-exec under `sg docker`
# when the current shell cannot reach the daemon directly (Docker group login
# not refreshed yet).
if ! docker info >/dev/null 2>&1; then
  if command -v sg >/dev/null 2>&1; then
    exec sg docker -c "$(printf '%q ' "$self" "$@")"
  fi
  echo "db-test: docker is not reachable; add your user to the docker group" >&2
  exit 1
fi

args=(test db --db-url "${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}")
if [[ -n "${SUPABASE_TEST_NETWORK:-}" ]]; then
  args+=(--network-id "$SUPABASE_TEST_NETWORK")
fi

exec npx --yes supabase "${args[@]}" "$@"
