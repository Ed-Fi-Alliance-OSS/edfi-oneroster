#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

set -e
set +x

DB_HOST=${POSTGRES_HOST:-${PGHOST:-}}
DB_PORT=${POSTGRES_PORT:-${PGPORT:-5432}}
DB_SUPERUSER=${POSTGRES_USER:-${PGUSER:-postgres}}
DB_PASSWORD=${POSTGRES_PASSWORD:-${PGPASSWORD:-postgres}}
TARGET_DB=${TARGET_DB:-EdFi_Ods}
TEMPLATE_DB=${TEMPLATE_DB:-EdFi_Ods_Populated_Template}

export PGPASSWORD="$DB_PASSWORD"

echo "Running initialization against PostgreSQL at ${DB_HOST}:${DB_PORT}"

echo "Checking if POSTGRES_USER is set to 'postgres'..."
if [ "$POSTGRES_USER" != "postgres" ]; then
  echo "Creating postgres role..."
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL 1> /dev/null
    CREATE ROLE postgres WITH NOLOGIN INHERIT;
    GRANT $POSTGRES_USER TO postgres;
EOSQL
else
  echo "POSTGRES_USER is set to 'postgres'. Skipping role creation."
fi

PSQL_BASE=(psql --username "$DB_SUPERUSER" --dbname postgres)
if [ -n "$DB_HOST" ]; then
  PSQL_BASE+=(--host "$DB_HOST")
fi
if [ -n "$DB_PORT" ]; then
  PSQL_BASE+=(--port "$DB_PORT")
fi

PSQL_QUERY=(${PSQL_BASE[@]} --tuples-only --no-align)

template_exists=$("${PSQL_QUERY[@]}" --command "SELECT 1 FROM pg_database WHERE datname='${TEMPLATE_DB}' LIMIT 1;" 2>/dev/null || true)
if [ "$template_exists" != "1" ]; then
  echo "Template database ${TEMPLATE_DB} was not found"
  exit 1
fi

target_exists=$("${PSQL_QUERY[@]}" --command "SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}' LIMIT 1;")
if [ "$target_exists" = "1" ]; then
  echo "Target database ${TARGET_DB} already exists; nothing to do"
  exit 0
fi

echo "Ensuring ${TEMPLATE_DB} allows connections"
"${PSQL_BASE[@]}" --command "ALTER DATABASE \"${TEMPLATE_DB}\" WITH ALLOW_CONNECTIONS = true;" >/dev/null

echo "Creating ${TARGET_DB} from template ${TEMPLATE_DB}"
"${PSQL_BASE[@]}" --command "CREATE DATABASE \"${TARGET_DB}\" WITH TEMPLATE \"${TEMPLATE_DB}\" OWNER \"${DB_SUPERUSER}\";"

echo "Database ${TARGET_DB} created successfully"
