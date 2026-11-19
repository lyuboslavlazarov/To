#!/usr/bin/env bash
# Локален тест на миграциите: ./supabase/tests/run_local.sh "<psql connection opts>"
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql $1 -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists ngo_test" -c "create database ngo_test"
$PSQL -d ngo_test -f tests/supabase_shim.sql
for f in migrations/*.sql; do echo "→ $f"; $PSQL -d ngo_test -f "$f" -o /dev/null; done
echo "→ seed.sql"; $PSQL -d ngo_test -f seed.sql -o /dev/null
echo "→ tests/rls_test.sql"; $PSQL -d ngo_test -f tests/rls_test.sql -o /dev/null && echo "ВСИЧКИ ТЕСТОВЕ МИНАХА ✔"
