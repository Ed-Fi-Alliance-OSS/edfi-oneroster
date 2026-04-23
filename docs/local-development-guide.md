# Local Development Guide

This guide walks you through setting up Ed-Fi OneRoster for local development
and testing. It assumes you already have a running Ed-Fi ODS/API instance and a
PostgreSQL or MSSQL database server available.

## Prerequisites

- **Node.js** 18 or later
- **Ed-Fi ODS** already deployed and running (Data Standard 4.0 or 5.x)
  - The ODS database must be accessible from your development machine
  - The `EdFi_Admin` database must be reachable (contains ODS instance
    connection strings)
- **PostgreSQL** or **Microsoft SQL Server** matching your ODS deployment
- **Ed-Fi ODS API configured as an OAuth2 provider** — set `Security:AccessTokenType` to `jwt` in the ODS API `appsettings.json`. The issued JWTs must include one or more OneRoster scopes (`roster.readonly`, `roster-core.readonly`, `roster-demographics.readonly`). Copy the value of `Security:Jwt:SigningKey:PublicKey` from `appsettings.json` into `OAUTH2_PUBLIC_KEY_PEM` in your `.env` file.

## Step 1: Configure Environment Variables

Copy the example file and edit it with your local values:

```bash
cp .env.example .env
```

The sections below describe every relevant setting.

### Core API Settings

```bash
# Port the OneRoster API listens on
PORT=3000

# Optional base path when hosted behind a virtual directory (e.g., IIS)
# Leave empty for local development
API_BASE_PATH=

# Database type: 'postgres' or 'mssql'
DB_TYPE=postgres

# Set to 'dev' to enable verbose logging and development middleware
NODE_ENV=dev
```

### Single-Tenant Mode (Default)

Use this when your ODS has a single `EdFi_Admin` database (the most common local setup).

```bash
MULTITENANCY_ENABLED=false

# PostgreSQL — replace host, port, database, username, and password as needed
CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=P@ssw0rd"}

# MSSQL equivalent:
# CONNECTION_CONFIG={"adminConnection":"server=localhost;database=EdFi_Admin;user id=sa;password=P@ssw0rd;encrypt=false;TrustServerCertificate=true"}

# Encryption key used to decrypt ODS connection strings stored in EdFi_Admin
# Generate a new key with: openssl rand -base64 32
# Value must match the ODS API ApiSettings:OdsConnectionStringEncryptionKey configuration value.
ODS_CONNECTION_STRING_ENCRYPTION_KEY=<your-base64-key>
```

### Multi-Tenant Mode

Use this when each tenant has its own `EdFi_Admin` database.

```bash
MULTITENANCY_ENABLED=true

# PostgreSQL — add as many tenants as needed
TENANTS_CONNECTION_CONFIG={"Tenant1":{"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant1;username=postgres;password=pass1"},"Tenant2":{"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant2;username=postgres;password=pass2"}}

# MSSQL equivalent:
# TENANTS_CONNECTION_CONFIG={"Tenant1":{"adminConnection":"server=localhost;database=EdFi_Admin_Tenant1;user id=sa;password=pass1;encrypt=false"},"Tenant2":{"adminConnection":"server=localhost;database=EdFi_Admin_Tenant2;user id=sa;password=pass2;encrypt=false"}}

# Encryption key (same as single-tenant)
ODS_CONNECTION_STRING_ENCRYPTION_KEY=<your-base64-key>
```

### ODS Context Routing (Optional)

Enable when you need to route requests to different ODS instances based on a URL
segment (e.g., school year).

```bash
# Example: route by school year extracted from the URL path
ODS_CONTEXT_ROUTE_TEMPLATE={schoolYearFromRoute:range(2026,2027)}

# Leave empty (or omit) to disable context routing
# ODS_CONTEXT_ROUTE_TEMPLATE=
```

### PostgreSQL-Specific Settings

Required when `DB_TYPE=postgres`.

```bash
# Disable TLS for local development (default)
DB_SSL=false
# Set to true and supply a CA cert when connecting to a TLS-enabled PostgreSQL server
# DB_SSL=true
# DB_SSL_CA=./certs/postgres-ca.pem

# pg-boss backing-store connection — used for scheduling materialized-view refresh jobs.
# Explicit PostgreSQL admin connection used for pg-boss metadata storage.
# Valid options:
# - Tenant admin DB (multi-tenant mode)
# - Same admin DB referenced by CONNECTION_CONFIG (single-tenant mode)
# - Dedicated pg-boss database
PG_BOSS_CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=P@ssw0rd"}

# Cron schedule for materialized view refresh (every 15 minutes by default)
PGBOSS_CRON=*/15 * * * *
```

**PostgreSQL SSL behavior summary:**

| Setting | Behavior |
|---|---|
| `DB_SSL=false` (default) | TLS disabled; suitable for local/dev |
| `DB_SSL=true` | TLS enabled with `rejectUnauthorized: true` |
| `DB_SSL=true` + `DB_SSL_CA` | TLS enabled; uses supplied CA certificate |
| `DB_SSL_CA` set but missing/unreadable | Startup fails immediately with an error |

### OAuth2 & JWT Configuration

```bash
OAUTH2_ISSUERBASEURL=https://localhost/api
OAUTH2_AUDIENCE=https://localhost/oneroster-api
OAUTH2_TOKENSIGNINGALG=RS256

# PEM-encoded RSA public key for verifying tokens (use \n for line breaks)
# Value must match the Security:Jwt:SigningKey:PublicKey configuration value in the ODS API appsettings.json.
OAUTH2_PUBLIC_KEY_PEM=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgk...\n-----END PUBLIC KEY-----
```

### Security & Performance

```bash
# Comma-separated list of allowed CORS origins
CORS_ORIGINS=http://localhost:3000,https://localhost

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Set to true when running behind a reverse proxy (IIS, NGINX, ARR)
TRUST_PROXY=false
```

---

## Step 2: Deploy the OneRoster Database Schema

The OneRoster API reads from views or tables that must be deployed on top of
your existing ODS database. Run the appropriate script for your database type
and Ed-Fi Data Standard version.

> **Note:** These scripts use a separate `.env.deploy` file so that deployment credentials can differ from runtime credentials.

### PostgreSQL

#### Configure deployment credentials

```bash
cd standard
cp .env.deploy.example .env.deploy
```

Edit `.env.deploy`:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=EdFi_Ods        # target ODS database
DB_USER=postgres
DB_PASS=P@ssw0rd
DB_SSL=false
PG_STATEMENT_TIMEOUT=120000
```

#### Deploy for Data Standard 5.x (5.0, 5.1, 5.2) — recommended

```bash
node deploy-pgsql.js ds5
```

This installs the views and materialized views from `standard/5.2.0/artifacts/` into your ODS database.

#### Deploy for Data Standard 4.0

```bash
node deploy-pgsql.js ds4
```

This installs the artifacts from `standard/4.0.0/artifacts/`. Use this only when your ODS is on Data Standard 4.0.

> The deployment scripts automatically select the correct artifact directory based on the `ds4`/`ds5` argument.

### Microsoft SQL Server

#### Configure deployment credentials

```bash
cd standard
cp .env.deploy.example .env.deploy
```

Edit `.env.deploy`:

```bash
DB_HOST=localhost
DB_PORT=1433
DB_NAME=EdFi_Ods        # target ODS database
DB_USER=sa
DB_PASS=yourStrong(!)Password
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
```

#### Deploy for Data Standard 5.x (5.0, 5.1, 5.2) — recommended

```bash
node deploy-mssql.js ds5
```

#### Deploy for Data Standard 4.0

```bash
node deploy-mssql.js ds4
```

> If you have previously deployed and want to re-run, the scripts are idempotent — existing objects are dropped and recreated.

---

## Step 3: Run the Application

Install dependencies (first time only):

```bash
npm install
```

Start the server:

```bash
node server.js

# Or via npm
npm start
```

The API will be available at `http://localhost:<PORT>` (default: `http://localhost:3000`).

---

## Step 4: Test and Validate

### Quick Endpoint Test

Obtain a JWT from your OAuth2 provider that includes one or more of the required scopes:

- `roster.readonly`
- `roster-core.readonly`
- `roster-demographics.readonly`

Then call any endpoint:

```bash
# Basic connectivity check
curl -i http://localhost:3000/ims/oneroster/rostering/v1p2/orgs \
  -H "Authorization: Bearer <your-token>"

# With pagination and filtering
curl -i "http://localhost:3000/ims/oneroster/rostering/v1p2/users?limit=10&offset=0&sort=familyName&orderBy=asc" \
  -H "Authorization: Bearer <your-token>"
```

### Cross-Database Compatibility Testing

When running both PostgreSQL and MSSQL deployments, validate that both return identical results:

```bash
# Compare API responses from PostgreSQL and MSSQL instances
node tests/compare-api.js

# Compare database query results directly (no HTTP layer)
node tests/compare-database.js

# Run with authentication
node tests/compare-api.js --auth
```
