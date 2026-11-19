#!/usr/bin/env bash
# Обединява всички миграции и seed в един файл за поставяне в Supabase SQL Editor.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=supabase/setup_all.sql
{
  echo "-- ВСИЧКО В ЕДИН ФАЙЛ: схема, права (RLS), функции и начална структура."
  echo "-- Генерирано от scripts/build-setup-sql.sh – не редактирайте ръчно."
  echo "-- Поставете целия файл в Supabase → SQL Editor → Run. Пуска се ЕДИН път на празен проект."
  for f in supabase/migrations/*.sql; do echo; echo "-- ===== $f ====="; cat "$f"; done
  echo; echo "-- ===== supabase/seed.sql ====="; cat supabase/seed.sql
} > "$OUT"
echo "Създаден: $OUT"
