#!/bin/sh
set -eu

attempt=0
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL is not ready after 30 attempts" >&2
    exit 1
  fi
  sleep 1
done

psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -v service_password="$SERVICE_DB_PASSWORD" -f /workspace/scripts/bootstrap-roles.sql
psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for file in /workspace/migrations/*.sql; do
  name="$(basename "$file")"
  applied="$(psql -Atqc "SELECT 1 FROM public.schema_migrations WHERE name = '$name'")"
  if [ "$applied" = "1" ]; then
    echo "Skipping migration: $name"
    continue
  fi
  echo "Applying migration: $name"
  psql -v ON_ERROR_STOP=1 -f "$file"
  psql -v ON_ERROR_STOP=1 -v migration_name="$name" <<'SQL'
INSERT INTO public.schema_migrations(name) VALUES (:'migration_name');
SQL
done

psql -v ON_ERROR_STOP=1 -v jwt_secret="$JWT_SECRET" -f /workspace/scripts/sync-runtime-settings.sql
echo "Migrations completed successfully"
