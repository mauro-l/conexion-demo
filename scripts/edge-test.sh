#!/usr/bin/env bash
# Drives the *served* public-availability Edge Function over real HTTP and
# asserts the response contract that client-side tests cannot prove: the
# Cache-Control: no-store header on every response (W1) and each stable error
# code/status on the validation branches (W2).
#
# Usage (from the repository root):
#   npm run test:edge
#
# Environment:
#   SUPABASE_URL       Base URL of the local scratch stack. Defaults to the
#                      standard Supabase API gateway on 127.0.0.1:54321.
#   SUPABASE_ANON_KEY  Publishable anon key. When empty, .env.local (then .env)
#                      is sourced to fill it. The Edge functions are invoked
#                      with this key exactly as the Next server does.
#   EDGE_CURL_TIMEOUT  Per-request curl timeout in seconds. Defaults to 15.
#
# A read-only GET of the catalog first resolves a real service token, so the
# suite needs no hardcoded fixtures and never writes. The Edge function must
# already be served by the running stack; when it is not, the first request
# fails loudly with its status instead of inventing a pass.
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)/.."

if [[ -z "${SUPABASE_ANON_KEY:-}" ]]; then
  for env_file in .env.local .env; do
    if [[ -z "${SUPABASE_ANON_KEY:-}" && -f "$env_file" ]]; then
      # shellcheck disable=SC1090
      set -a && . "./$env_file" && set +a
    fi
  done
fi

base_url="${SUPABASE_URL:-http://127.0.0.1:54321}"
base_url="${base_url%/}"
anon_key="${SUPABASE_ANON_KEY:-}"
slug="${BARBERSHOP_PUBLIC_SLUG:-conexion-barberia}"
timeout="${EDGE_CURL_TIMEOUT:-15}"

if [[ -z "$anon_key" ]]; then
  echo "edge-test: SUPABASE_ANON_KEY is not set and no .env.local/.env supplied it" >&2
  echo "edge-test: copy .env.example to .env.local before running against the scratch stack" >&2
  exit 1
fi

failures=0
checks=0

# One request, captured as a temp file: status on line 1, body on line 2, then
# the lowercased headers as `name: value` lines.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

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

echo "edge-test: ${base_url} (slug ${slug})"

# 0. Resolve a live service token through the read-only catalog. A failure here
#    means the stack is not serving the Edge functions, which is a hard stop.
catalog_url="${base_url}/functions/v1/public-catalog?slug=${slug}"
if ! request GET "$catalog_url"; then
  echo "edge-test: could not reach ${catalog_url}; is the local stack serving the Edge functions?" >&2
  exit 1
fi
if [[ "$(status)" != "200" ]]; then
  echo "edge-test: catalog returned $(status); expected 200 before the availability checks" >&2
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
