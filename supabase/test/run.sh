#!/usr/bin/env bash
# Verify the migration against a throwaway Postgres. Needs Docker running.
#   bash supabase/test/run.sh
set -euo pipefail

CONTAINER=dchat-pg
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=dchat postgres:17 >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres -d dchat >/dev/null 2>&1; do sleep 1; done

run() { docker exec -i "$CONTAINER" psql -U postgres -d dchat -v ON_ERROR_STOP=1 -q < "$1"; }

echo "loading supabase stubs..."
run "$HERE/00_stub.sql" >/dev/null

echo "applying migrations..."
for m in "$HERE"/../migrations/*.sql; do
  echo "  $(basename "$m")"
  run "$m" >/dev/null
done

echo "re-applying to check idempotency..."
for m in "$HERE"/../migrations/*.sql; do run "$m" >/dev/null; done

echo "running tests..."
run "$HERE/02_test.sql" 2>&1 | grep -Ev '^(INSERT|SELECT|UPDATE|GRANT|SET)'
