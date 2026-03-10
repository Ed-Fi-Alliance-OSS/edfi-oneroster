#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

set -euo pipefail

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

is_disabled() {
  local value
  value=$(printf '%s' "${1:-true}" | tr '[:upper:]' '[:lower:]')
  case "$value" in
    false|0|no) return 0 ;;
    *) return 1 ;;
  esac
}

if is_disabled "${ONEROSTER_SCHEMA_BOOTSTRAP:-true}"; then
  log "OneRoster schema bootstrap disabled; skipping artifact execution"
  exit 0
fi

DB_HOST=${DB_HOST:-${POSTGRES_HOST:-db-ods}}
DB_PORT=${DB_PORT:-${POSTGRES_PORT:-5432}}
DB_NAME=${DB_NAME:-${POSTGRES_DB:-}}
DB_USER=${DB_USER:-${POSTGRES_USER:-postgres}}
DB_PASSWORD=${DB_PASS:-${POSTGRES_PASSWORD:-postgres}}
SCHEMA_NAME=${ONEROSTER_SCHEMA_NAME:-oneroster12}
ARTIFACT_DIR=${ONEROSTER_ARTIFACT_DIR:-/app/standard/5.2.0/artifacts/pgsql/core}
READY_ATTEMPTS=${DB_READY_ATTEMPTS:-30}
READY_DELAY_SECONDS=${DB_READY_DELAY_SECONDS:-5}

if [ -z "$DB_NAME" ]; then
  log "DB_NAME/POSTGRES_DB must be set so bootstrap knows which database to target"
  exit 1
fi

if [ ! -d "$ARTIFACT_DIR" ]; then
  log "Artifact directory $ARTIFACT_DIR not found; skipping schema bootstrap"
  exit 0
fi

export PGPASSWORD="$DB_PASSWORD"
ATTEMPT=1
while [ "$ATTEMPT" -le "$READY_ATTEMPTS" ]; do
  if psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" --no-password --command='SELECT 1;' >/dev/null 2>&1; then
    break
  fi
  if [ "$ATTEMPT" -eq "$READY_ATTEMPTS" ]; then
    log "Database is still unavailable after $READY_ATTEMPTS attempts"
    exit 1
  fi
  log "[#${ATTEMPT}/${READY_ATTEMPTS}] Database not ready; retrying in ${READY_DELAY_SECONDS}s"
  ATTEMPT=$((ATTEMPT + 1))
  sleep "$READY_DELAY_SECONDS"
done

SCHEMA_EXISTS=$(psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" --tuples-only --no-align --command "SELECT 1 FROM information_schema.schemata WHERE schema_name='${SCHEMA_NAME}' LIMIT 1;")
if [ "${SCHEMA_EXISTS:-}" = "1" ]; then
  log "Schema ${SCHEMA_NAME} already exists; nothing to do"
  exit 0
fi

log "Schema ${SCHEMA_NAME} missing; applying SQL artifacts from $ARTIFACT_DIR"
SQL_FILES=$(find "$ARTIFACT_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
if [ -z "$SQL_FILES" ]; then
  log "No SQL files found under $ARTIFACT_DIR; aborting"
  exit 1
fi

for sql_file in $SQL_FILES; do
  log "Running $(basename "$sql_file")"
  psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" --set=ON_ERROR_STOP=on --file="$sql_file"
  log "Finished $(basename "$sql_file")"
done

log "OneRoster schema bootstrap completed"
