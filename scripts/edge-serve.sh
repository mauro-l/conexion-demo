#!/usr/bin/env bash
# Serve THIS repository's Edge Functions through the running local stack.
#
# WHY THIS EXISTS
#   The scratch stack on 127.0.0.1:54321 runs under project_id `conexion-db`,
#   which this repository's config.toml does not use. Running `supabase start`
#   from here would therefore create a SECOND stack instead of serving these
#   Functions. And the stack's own edge-runtime container mounts whatever
#   checkout started it, so its bytes may not be the ones under review.
#   scripts/edge-test.sh solves the same problem for one run; this script leaves
#   the runtime up so `npm run dev` / `npm run start` and the Playwright suite
#   can reach the public API reads.
#
# WHAT IT DOES
#   Starts `supabase functions serve` from a throwaway workdir whose only
#   Function mount is a symlink to this repository's supabase/functions, with
#   project_id rewritten to the running stack's so the CLI attaches to it
#   instead of starting a new one. It then polls the catalog until the runtime
#   answers, so a caller never races the startup.
#
# Usage (from the repository root):
#   scripts/edge-serve.sh          # foreground; Ctrl-C stops it
#
#   Uses .env.local for SUPABASE_ANON_KEY and PUBLIC_AVAILABILITY_HMAC_SECRET,
#   exactly like scripts/edge-test.sh. The signing secret is written to a
#   mode-600 temp file and never printed.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir/.."

if ! docker info >/dev/null 2>&1; then
  if command -v sg >/dev/null 2>&1; then
    exec sg docker -c "$(printf '%q ' "$script_dir/$(basename "$0")" "$@")"
  fi
  echo "edge-serve: docker is not reachable; add your user to the docker group" >&2
  exit 1
fi

for env_file in .env.local .env; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a && . "./$env_file" && set +a
  fi
done

: "${SUPABASE_ANON_KEY:?edge-serve: SUPABASE_ANON_KEY is not set; see .env.example}"
: "${PUBLIC_AVAILABILITY_HMAC_SECRET:?edge-serve: PUBLIC_AVAILABILITY_HMAC_SECRET is not set; the public-booking Edge fails closed without it}"

project_id="${EDGE_TEST_PROJECT_ID:-conexion-db}"
network="supabase_network_${project_id}"
base_url="${SUPABASE_URL:-http://127.0.0.1:54321}"
base_url="${base_url%/}"

serve_dir="$(mktemp -d)"
env_file="$(mktemp)"
chmod 600 "$env_file"
cleanup() {
  rm -rf "$serve_dir" "$env_file"
}
trap cleanup EXIT

printf 'PUBLIC_AVAILABILITY_HMAC_SECRET=%s\n' "$PUBLIC_AVAILABILITY_HMAC_SECRET" > "$env_file"

mkdir -p "$serve_dir/supabase"
sed -E "s/^project_id *=.*/project_id = \"${project_id}\"/" supabase/config.toml \
  > "$serve_dir/supabase/config.toml"
# The only Function bytes the server can see are this repository's.
ln -s "$PWD/supabase/functions" "$serve_dir/supabase/functions"

echo "edge-serve: serving $PWD/supabase/functions as ${project_id} on ${base_url}"
setsid npx --yes supabase --workdir "$serve_dir" functions serve \
  --network-id "$network" \
  --env-file "$env_file" &
server_pid=$!
trap 'kill -TERM -- "-$server_pid" 2>/dev/null || true; cleanup' EXIT

for _ in $(seq 1 120); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "edge-serve: the runtime exited before it answered" >&2
    exit 1
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    "${base_url}/functions/v1/public-context?slug=${BARBERSHOP_PUBLIC_SLUG}" || true)"
  if [[ "$code" == "200" ]]; then
    echo "edge-serve: ready; Ctrl-C to stop"
    break
  fi
  sleep 1
done

if [[ "${code:-}" != "200" ]]; then
  echo "edge-serve: the runtime never served the catalog (last status ${code:-none})" >&2
  exit 1
fi

wait "$server_pid"
