#!/usr/bin/env bash
# Applies the real migrations to a throwaway PostgreSQL container and runs the RLS tests.
# Requires Docker. Uses the postgres image already present locally, or pulls it.
set -euo pipefail

IMAGE="${WISHLY_TEST_PG_IMAGE:-postgres:18-alpine}"
NAME="wishly-db-test-$$"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 \
     && docker exec "$NAME" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done

run_sql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f - < "$1"; }

run_sql "$ROOT/tests/integration/db/00_supabase_shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do run_sql "$migration"; done
run_sql "$ROOT/tests/integration/db/10_rls_tests.sql"
run_sql "$ROOT/tests/integration/db/20_sharing_tests.sql"
run_sql "$ROOT/tests/integration/db/30_reservation_tests.sql"

# ---------------------------------------------------------------------------
# Concurrency: many independent connections race to reserve the same gift.
# ---------------------------------------------------------------------------
psql_q() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

psql_q -c "insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1')" \
       -c "insert into public.wishlists (owner_id, title) values ('00000000-0000-0000-0000-0000000000f1', 'Race')" \
       -c "insert into public.wishlist_items (wishlist_id, title) select id, 'Contested' from public.wishlists where title = 'Race'"
TOKEN=$(psql_q -c "select share_token from public.wishlists where title = 'Race'")
ITEM=$(psql_q -c "select id from public.wishlist_items where title = 'Contested'")

race() { # $1 = number of racers, $2 = how to pick each racer's hash char ("distinct" or a fixed char)
  local out; out="$(mktemp -d)"
  for i in $(seq 1 "$1"); do
    local ch="$2"; [ "$2" = distinct ] && ch="$(printf '%x' $(( i % 16 )))$(printf '%x' $(( i / 16 )))"
    local hash; hash="$(printf '%s' "$ch" | head -c 2)"; hash="$(printf "%-64s" "$hash" | tr ' ' "${hash:0:1}")"
    docker exec -i "$NAME" psql -U postgres -qtA -c "set role service_role" \
      -c "select public.reserve_item('$TOKEN', '$ITEM', '$hash')" > "$out/$i" 2>&1 &
  done
  wait
  cat "$out"/* | sort | uniq -c | sed 's/^ *//'
  rm -rf "$out"
}

reset_race() { psql_q -c "delete from public.reservations"; }

echo "Race 1: 24 different guests, one gift"
reset_race
RESULT1="$(race 24 distinct)"; echo "$RESULT1"
CREATED=$(echo "$RESULT1" | awk '$2=="created"{print $1}')
[ "${CREATED:-0}" = "1" ] || { echo "TEST FAILED: expected exactly 1 created, got '${CREATED:-0}'"; exit 1; }
[ "$(psql_q -c 'select count(*) from public.reservations')" = "1" ] || { echo "TEST FAILED: expected exactly 1 reservation row"; exit 1; }

echo "Race 2: 24 retries from the SAME guest (idempotent)"
reset_race
RESULT2="$(race 24 c)"; echo "$RESULT2"
CREATED=$(echo "$RESULT2" | awk '$2=="created"{print $1}')
CONFLICTS=$(echo "$RESULT2" | awk '$2=="conflict"{print $1}')
[ "${CREATED:-0}" = "1" ] && [ -z "${CONFLICTS:-}" ] || { echo "TEST FAILED: same-guest retries must yield one 'created' and no conflicts"; exit 1; }

echo "Concurrency tests passed."
