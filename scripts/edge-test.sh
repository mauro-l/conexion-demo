#!/usr/bin/env bash
# Proves the response contract of THIS repository's public-availability Edge
# Function over real HTTP: the Cache-Control: no-store header on every response
# (W1) and each stable error code/status on the validation branches (W2).
# Client-side tests cannot prove either, because they never cross the wire.
#
# WHICH CODE PATH IT SERVES (and why that matters)
#   The local stack routes /functions/v1/* through Kong to the
#   supabase_edge_runtime_<project> container, and that container bind-mounts
#   <workdir>/supabase/functions. When the stack was started from another
#   checkout, the mount points at *that* checkout's Functions: the served bytes
#   are then not the ones under review, and breaking a file here would still
#   leave the suite green. That is exactly the defect this harness fixes.
#
#   So the suite starts its own Functions server from a throwaway workdir whose
#   only Function mount is a symlink to THIS repository's supabase/functions.
#   Kong still fronts the request, but the bytes it forwards are the repo's.
#   Deleting this repo's `no-store` header must fail the run (it does).
#
#   The throwaway workdir is required because the CLI identifies the running
#   local stack by `project_id` in its config.toml and derives the container and
#   network names from it. The workdir carries a copy of this repo's
#   config.toml with `project_id` pointed at the running stack, so the CLI
#   attaches to it while keeping this repo's Function declarations intact.
#   Everything under it is removed on exit.
#
# SERVER LIFECYCLE
#   The server is started before the checks and torn down on exit, including on
#   failure, via a trap — the suite leaves no stray process behind. Readiness is
#   established by polling the catalog endpoint, never by sleeping a fixed
#   amount of time. If the server cannot start, the run exits non-zero with the
#   server log; it never falls back to whatever the stack may already serve.
#
# Usage (from the repository root):
#   npm run test:edge
#
# Environment:
#   SUPABASE_URL                   Base URL of the local scratch stack. Defaults
#                                  to the standard Supabase API gateway on
#                                  127.0.0.1:54321.
#   SUPABASE_ANON_KEY              Publishable anon key. When empty, .env.local
#                                  (then .env) is sourced to fill it. The Edge
#                                  Functions are invoked with this key exactly as
#                                  the Next server does.
#   PUBLIC_AVAILABILITY_HMAC_SECRET
#                                  Signing secret for the availability tokens.
#                                  Sourced from .env.local; the Function fails
#                                  closed without it. Its value is never printed.
#   EDGE_TEST_PROJECT_ID           Local stack project id, used to derive the
#                                  container and network names. Defaults to
#                                  conexion-db.
#   EDGE_TEST_NETWORK              Docker network of the running stack. Defaults
#                                  to supabase_network_$EDGE_TEST_PROJECT_ID.
#   EDGE_CURL_TIMEOUT              Per-request curl timeout in seconds. Default 15.
#   EDGE_TEST_READY_ATTEMPTS       Readiness polls before giving up. Default 60.
#
# A read-only GET of the catalog first resolves a real service token, so the
# suite needs no hardcoded fixtures. The only writes are to the local scratch
# stack and to the throwaway workdir.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
self="$script_dir/$(basename "$0")"
cd "$script_dir/.."

# The Supabase CLI shells into Docker to start the Functions runtime. Re-exec
# under `sg docker` when this shell cannot reach the daemon directly (Docker
# group membership not refreshed yet), the same way scripts/db-test.sh does.
if ! docker info >/dev/null 2>&1; then
  if command -v sg >/dev/null 2>&1; then
    exec sg docker -c "$(printf '%q ' "$self" "$@")"
  fi
  echo "edge-test: docker is not reachable; add your user to the docker group" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ANON_KEY:-}" ]]; then
  for env_file in .env.local .env; do
    if [[ -z "${SUPABASE_ANON_KEY:-}" && -f "$env_file" ]]; then
      # shellcheck disable=SC1090
      set -a && . "./$env_file" && set +a
    fi
  done
fi

# The Function fails closed when its signing secret is absent, so the suite
# cannot run without it. Read it from the same local file the app uses; never
# from .env, whose SUPABASE_URL points at the hosted project.
if [[ -z "${PUBLIC_AVAILABILITY_HMAC_SECRET:-}" && -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a && . ./.env.local && set +a
fi

base_url="${SUPABASE_URL:-http://127.0.0.1:54321}"
base_url="${base_url%/}"
anon_key="${SUPABASE_ANON_KEY:-}"
slug="${BARBERSHOP_PUBLIC_SLUG:-conexion-barberia}"
timeout="${EDGE_CURL_TIMEOUT:-15}"
project_id="${EDGE_TEST_PROJECT_ID:-conexion-db}"
network="${EDGE_TEST_NETWORK:-supabase_network_${project_id}}"
ready_attempts="${EDGE_TEST_READY_ATTEMPTS:-60}"

if [[ -z "$anon_key" ]]; then
  echo "edge-test: SUPABASE_ANON_KEY is not set and no .env.local/.env supplied it" >&2
  echo "edge-test: copy .env.example to .env.local before running against the scratch stack" >&2
  exit 1
fi

if [[ -z "${PUBLIC_AVAILABILITY_HMAC_SECRET:-}" ]]; then
  echo "edge-test: PUBLIC_AVAILABILITY_HMAC_SECRET is not set and .env.local did not supply it" >&2
  echo "edge-test: the Edge Function fails closed without it; add it to .env.local" >&2
  exit 1
fi

failures=0
checks=0

# One request, captured as a temp file: status on line 1, body on line 2, then
# the lowercased headers as `name: value` lines.
work="$(mktemp -d)"
serve_dir="$(mktemp -d)"
env_file="$(mktemp)"
server_log="$work/server.log"
chmod 600 "$env_file"

# The CLI forwards non-SUPABASE_* env vars from here to the Function worker.
# Write only the signing secret; its value is never echoed.
printf 'PUBLIC_AVAILABILITY_HMAC_SECRET=%s\n' "$PUBLIC_AVAILABILITY_HMAC_SECRET" > "$env_file"

mkdir -p "$serve_dir/supabase"
# Attach to the running stack (project_id drives the container/network names)
# while preserving this repo's Function declarations, such as verify_jwt.
sed -E "s/^project_id *=.*/project_id = \"${project_id}\"/" supabase/config.toml \
  > "$serve_dir/supabase/config.toml"
# The only Function bytes the server can see are this repository's.
ln -s "$PWD/supabase/functions" "$serve_dir/supabase/functions"

server_pid=""
started=0

cleanup() {
  local status=$?
  if (( started == 1 )); then
    if kill -0 "$server_pid" 2>/dev/null; then
      kill -TERM -- "-$server_pid" 2>/dev/null || kill -TERM "$server_pid" 2>/dev/null || true
      for _ in $(seq 1 30); do
        kill -0 "$server_pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -KILL -- "-$server_pid" 2>/dev/null || true
    fi
    # The CLI stops its container on SIGTERM; stop it anyway so a crashed CLI
    # cannot leave a stray server behind.
    if docker ps --format '{{.Names}}' | grep -qx "supabase_edge_runtime_${project_id}"; then
      docker stop "supabase_edge_runtime_${project_id}" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$work" "$serve_dir" "$env_file"
  return "$status"
}
trap cleanup EXIT

echo "edge-test: serving $PWD/supabase/functions as ${project_id} on ${base_url} (slug ${slug})"
setsid npx --yes supabase --workdir "$serve_dir" functions serve \
  --network-id "$network" \
  --env-file "$env_file" \
  > "$server_log" 2>&1 &
server_pid=$!
started=1

request() {
  local method="$1" url="$2"
  curl --silent --show-error --max-time "$timeout" \
    --request "$method" \
    --dump-header "$work/headers" \
    --output "$work/body" \
    --write-out '%{http_code}\n' \
    --header "Authorization: Bearer $anon_key" \
    "$url" > "$work/status"
  tr 'A-Z' 'a-z' < "$work/headers" > "$work/headers.lc"
}

status() { tr -d '\r\n' < "$work/status"; }
body() { cat "$work/body"; }

header_value() {
  local name="$1"
  awk -v wanted="$name" '
    BEGIN { IGNORECASE = 1 }
    index($0, ":") > 0 {
      key = tolower(substr($0, 1, index($0, ":") - 1))
      if (key == wanted) {
        value = substr($0, index($0, ":") + 2)
        gsub(/[[:space:]]+$/, "", value)
      }
    }
    END { print value }
  ' "$work/headers.lc"
}

pass() { checks=$((checks + 1)); printf 'ok   %s\n' "$1"; }

fatal() {
  checks=$((checks + 1))
  failures=$((failures + 1))
  printf 'FAIL %s\n' "$1"
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass "$label"
  else
    fatal "$label (expected [$expected], got [$actual])"
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$label"
  else
    fatal "$label (missing [$needle] in [${haystack:0:200}])"
  fi
}

# Every served response, on every path, must carry Cache-Control: no-store (W1).
assert_no_store() {
  local label="$1"
  assert_eq "$label: Cache-Control: no-store" "no-store" "$(header_value 'cache-control')"
}

# Stable errors carry their code in the JSON body, never as readable metadata.
assert_error_code() {
  local label="$1" code="$2"
  assert_eq "$label: status" "$3" "$(status)"
  assert_contains "$label: stable code" "\"code\":\"$code\"" "$(body)"
  assert_eq "$label: no internal ids" "0" \
    "$(printf '%s' "$(body)" | grep -cE '"(id|barbero_id|barberia_id|users_id)"' || true)"
  assert_no_store "$label"
}

echo "edge-test: waiting for the repo-served Edge runtime to come up"

# 0. Resolve a live service token through the read-only catalog. Readiness is
#    polled through this request, so a slow start is absorbed and a server that
#    never starts fails the run instead of passing on stale code.
catalog_url="${base_url}/functions/v1/public-catalog?slug=${slug}"
ready=0
for _ in $(seq 1 "$ready_attempts"); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi
  if request GET "$catalog_url" 2>/dev/null && [[ "$(status)" == "200" ]]; then
    ready=1
    break
  fi
  sleep 1
done

if (( ready == 0 )); then
  echo "edge-test: the repo-served Edge runtime never served ${catalog_url}" >&2
  echo "edge-test: server log follows" >&2
  tail -n 20 "$server_log" >&2 || true
  exit 1
fi

service_token="$(body | grep -oE '"publicServiceToken":"[a-f0-9]{32}"' | head -1 | cut -d'"' -f4)"
if [[ -z "$service_token" ]]; then
  echo "edge-test: the catalog exposed no service token for slug ${slug}" >&2
  exit 1
fi
echo "edge-test: resolved a service token (${#service_token} chars)"

availability_base="${base_url}/functions/v1/public-availability?slug=${slug}&service=${service_token}"

# 1. 200 path: the served read is uncached and returns the exact five-field DTO.
request GET "$availability_base"
assert_eq "valid read: status" "200" "$(status)"
assert_no_store "valid read"
assert_contains "valid read: days are present" '"days":[' "$(body)"
assert_contains "valid read: service snapshot is returned" '"service":{' "$(body)"

# 2. Unknown query field -> INVALID_INPUT.
request GET "${availability_base}&bogus=1"
assert_error_code "unknown query field" "INVALID_INPUT" "400"

# 3. Malformed date -> INVALID_INPUT.
request GET "${availability_base}&date=2026-2-3"
assert_error_code "malformed date" "INVALID_INPUT" "400"

# 4. A date the window cannot contain -> AVAILABILITY_RANGE_EXCEEDED. The Edge
#    only accepts dates the RPC actually returned, so a far-future date is a
#    deterministic outside-window case regardless of the wall clock.
request GET "${availability_base}&date=2030-01-01"
assert_error_code "date outside the window" "AVAILABILITY_RANGE_EXCEEDED" "400"

# 5. Unknown service token -> PUBLIC_RESOURCE_NOT_FOUND.
request GET "${base_url}/functions/v1/public-availability?slug=${slug}&service=00000000000000000000000000000000"
assert_error_code "unknown service token" "PUBLIC_RESOURCE_NOT_FOUND" "404"

# 6. Unknown slug -> PUBLIC_RESOURCE_NOT_FOUND.
request GET "${base_url}/functions/v1/public-availability?slug=zz-unknown-slug&service=${service_token}"
assert_error_code "unknown slug" "PUBLIC_RESOURCE_NOT_FOUND" "404"

# 7. Wrong HTTP method -> its own stable code and status, still no-store.
request POST "$availability_base"
assert_error_code "wrong HTTP method" "METHOD_NOT_ALLOWED" "405"

echo "edge-test: ${checks} checks, ${failures} failed"
if (( failures > 0 )); then
  exit 1
fi
