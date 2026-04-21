# Ed-Fi OneRoster

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/badge)](https://securityscorecards.dev/viewer/?uri=https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster)

This app serves a OneRoster 1.2 API from data in an Ed-Fi ODS (Data Standard 4.0 and 5.x).

## Quick Start

**Docker Compose (Recommended):**

```bash
cd compose
cp .env.5.2.0.example .env
# Edit .env to configure credentials and settings
pwsh ./start-services.ps1 -GenerateSigningKeys -InitializeAdminClients
```

Access the stack at:

- **OneRoster API:** `https://localhost/oneroster-api`
- **Ed-Fi ODS/API:** `https://localhost/api`
- **Swagger UI:** `https://localhost/swagger`

See [compose/README.md](compose/README.md) for detailed Docker setup documentation.

### Architecture

#### Initial Implementation (PostgreSQL)

* materialized views on ODS tables (see `/sql` - these queries must be run on the ODS manually)
* express-js API connected to Ed-Fi ODS (Postgres) database
* [pg-boss](https://timgit.github.io/pg-boss/#/./api/scheduling) to schedule refresh of the materialized views
* Swagger documentation with OAS2.0
* OAuth2 authentication with [OneRoster 1.2 scopes](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#OpenAPI_Security)

#### Multi-Database Support (Added)

* **Database Abstraction Layer**: [Knex.js](https://knexjs.org/) provides unified database access for both PostgreSQL and Microsoft SQL Server
* **MSSQL Implementation**: Full Microsoft SQL Server support with stored procedures and automated refresh via SQL Server Agent jobs  
* **Cross-Database Compatibility**: Both implementations tested for identical API responses and OneRoster compliance
* **Factory Pattern**: `DatabaseServiceFactory` automatically selects the appropriate database service based on configuration

#### Data Standard Support

* **Ed-Fi Data Standard 5.x (5.0, 5.1, 5.2)**: Full support
* **Ed-Fi Data Standard 4.0**: Full support with separate SQL implementations

### Database Implementations

| Feature | PostgreSQL | Microsoft SQL Server |
|---------|------------|---------------------|
| **Data Views** | Materialized Views | Stored Procedures + Tables |
| **Refresh Method** | pg-boss scheduled jobs | SQL Server Agent jobs |
| **JSON Support** | Native JSON columns | NVARCHAR with JSON parsing |
| **Deployment** | Node.js scripts in `/standard/` | Node.js scripts in `/standard/` |

### Deployment Options

#### Docker Compose (Recommended)

The easiest way to get started is using Docker Compose, which sets up the entire Ed-Fi ODS/API stack with OneRoster:

```bash
cd compose

# Copy and configure the environment file for your data standard
cp .env.5.2.0.example .env
# Edit .env to set credentials, JWT keys, and other settings

# Start all services (Ed-Fi ODS/API + OneRoster API + NGINX + databases)
pwsh ./start-services.ps1 -GenerateSigningKeys -InitializeAdminClients

# Stop services
pwsh ./stop-services.ps1

# Stop and clean up everything (including volumes)
pwsh ./stop-services.ps1 -Purge
```

See [compose/README.md](compose/README.md) for detailed Docker Compose documentation.

#### PostgreSQL (Standalone Deployment)

Deploy the PostgreSQL OneRoster schema using the automated deployment script:

```bash
cd standard

# Create and configure the deployment environment file
cp .env.deploy.example .env.deploy

# Edit .env.deploy and update the PostgreSQL connection details:
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=EdFi_Ods
# DB_USER=postgres
# DB_PASS=P@ssw0rd
# DB_SSL=false
# PG_STATEMENT_TIMEOUT=120000

# Deploy OneRoster schema to PostgreSQL (Data Standard 5.2)
node deploy-pgsql.js ds5

# For Data Standard 4.0 support
node deploy-pgsql.js ds4
```

**Quick Start with Ed-Fi ODS Database:**

If you need just the Ed-Fi ODS database without the full stack, run:

```bash
# Data Standard 5.0 (ODS API v7.1)
docker run -d -e POSTGRES_PASSWORD=P@ssw0rd -p 5432:5432 --name edfi-ods edfialliance/ods-api-db-ods-sandbox:v7.1

# Data Standard 5.1 (ODS API v7.2)
docker run -d -e POSTGRES_PASSWORD=P@ssw0rd -p 5432:5432 --name edfi-ods edfialliance/ods-api-db-ods-sandbox:v7.2

# Data Standard 5.2 (ODS API v7.3)
docker run -d -e POSTGRES_PASSWORD=P@ssw0rd -p 5432:5432 --name edfi-ods edfialliance/ods-api-db-ods-sandbox:v7.3

# Enable database connections if needed:
docker exec -it edfi-ods psql -U postgres -c "ALTER DATABASE EdFi_Ods_Populated_Template ALLOW_CONNECTIONS true;"
```

**Windows / WSL Notes:**

If running on Windows, use Windows Subsystem for Linux (WSL2) for the best Docker + CLI experience:

1. **Install WSL:**

   ```powershell
   # From an elevated PowerShell prompt
   wsl --install
   # Restart when prompted and complete distro setup
   ```

2. **Configure Docker Desktop:**
   - Install Docker Desktop for Windows
   - Open Docker Desktop > Settings > Resources > WSL Integration
   - Enable integration for your Ubuntu distro and click "Apply & Restart"

3. **Run from WSL:**

   ```bash
   # Navigate to the project in WSL
   cd /mnt/c/Dev/Ed-Fi/edfi-oneroster
   
   # Use the Docker Compose setup or run containers directly
   ```

#### Microsoft SQL Server (Standalone Deployment)

Deploy the MSSQL OneRoster schema using the automated deployment script:

```bash
cd standard

# Create and configure the deployment environment file
cp .env.deploy.example .env.deploy

# Edit .env.deploy and update the MSSQL connection details:
# DB_HOST=localhost
# DB_PORT=1433
# DB_NAME=EdFi_Ods
# DB_USER=sa
# DB_PASS=yourStrong(!)Password
# DB_ENCRYPT=false
# DB_TRUST_SERVER_CERTIFICATE=true

# Deploy OneRoster schema to MSSQL (Data Standard 5.2)
node deploy-mssql.js ds5

# For Data Standard 4.0 support
node deploy-mssql.js ds4
```

### Configuration

#### Environment Variables

Make a copy of `.env.example` to `.env` and configure the following:

**Core API Settings:**

```bash
# OneRoster API port
PORT=3000

# Optional base path when hosted behind IIS virtual directory
API_BASE_PATH=

# Database type: 'postgres' or 'mssql'
DB_TYPE=postgres

# Environment mode: 'dev' or 'prod' (empty)
NODE_ENV=dev
```

**Database Connection - Single-Tenant Mode (Default):**

```bash
# Multi-tenancy disabled
MULTITENANCY_ENABLED=false

# EdFi_Admin connection for single-tenant mode
# PostgreSQL example:
CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=P@ssw0rd"}

# MSSQL example:
# CONNECTION_CONFIG={"adminConnection":"server=localhost;database=EdFi_Admin;user id=sa;password=P@ssw0rd;encrypt=false;TrustServerCertificate=true"}

# Required: Encryption key for ODS connection strings (generate with: openssl rand -base64 32)
ODS_CONNECTION_STRING_ENCRYPTION_KEY=vLgnKf+MyoAsEmeGsh+n+rKRN1bGS8s1b0eCo6zc5+o=
```

**Database Connection - Multi-Tenant Mode:**

```bash
# Multi-tenancy enabled
MULTITENANCY_ENABLED=true

# PostgreSQL multi-tenant config:
TENANTS_CONNECTION_CONFIG={"Tenant1":{"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant1;username=postgres;password=pass1"},"Tenant2":{"adminConnection":"host=localhost;port=5432;database=EdFi_Admin_Tenant2;username=postgres;password=pass2"}}

# MSSQL multi-tenant config:
# TENANTS_CONNECTION_CONFIG={"Tenant1":{"adminConnection":"server=localhost;database=EdFi_Admin_Tenant1;user id=sa;password=pass1;encrypt=false"},"Tenant2":{"adminConnection":"server=localhost;database=EdFi_Admin_Tenant2;user id=sa;password=pass2;encrypt=false"}}
```

**ODS Context Routing:**
```bash
# Enable context-based routing (e.g., route requests to different ODS instances based on school year)
ODS_CONTEXT_ROUTE_TEMPLATE={schoolYearFromRoute:range(2026,2027)}

# Leave empty to disable context routing
# ODS_CONTEXT_ROUTE_TEMPLATE=
```

**PostgreSQL-Specific Settings:**

```bash
# SSL/TLS configuration (only for PostgreSQL)
DB_SSL=false
# Optional CA certificate file path (only used when DB_SSL=true)
DB_SSL_CA=./certs/postgres-ca.pem

# pg-boss settings for scheduled refresh jobs
PGBOSS_CRON=*/15 * * * *
```

**OAuth2 & JWT Configuration:**

```bash
OAUTH2_ISSUERBASEURL=https://localhost/api
OAUTH2_AUDIENCE=https://localhost/oneroster-api
OAUTH2_TOKENSIGNINGALG=RS256

# PEM-encoded public key for verifying JWTs (use \n for line breaks)
OAUTH2_PUBLIC_KEY_PEM=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgk...\n-----END PUBLIC KEY-----
```

**Security & Performance:**

```bash
# CORS origins (comma-separated)
CORS_ORIGINS=http://localhost:3000,https://localhost

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Trust reverse proxy headers (set to true when behind IIS/NGINX/ARR)
TRUST_PROXY=false
```

**PostgreSQL SSL Behavior:**

- `DB_SSL=false` (default) disables TLS for local/dev setups.
- `DB_SSL=true` enables TLS with certificate validation (`rejectUnauthorized: true`).
- `DB_SSL_CA` is optional and should point to a CA PEM file when using a private/internal CA.
- If `DB_SSL_CA` is set but invalid (missing, unreadable, or empty), startup fails fast with an error.

#### Data Standard Configuration

The system supports Ed-Fi Data Standards 4.0 and 5.x (5.0, 5.1, 5.2). Deploy the appropriate artifacts:

```bash
# Deploy Ed-Fi Data Standard 5.2 (PostgreSQL)
cd standard
node deploy-pgsql.js ds5

# Deploy Ed-Fi Data Standard 4.0 (PostgreSQL)
node deploy-pgsql.js ds4

# Deploy Ed-Fi Data Standard 5.2 (MSSQL)
node deploy-mssql.js ds5

# Deploy Ed-Fi Data Standard 4.0 (MSSQL)
node deploy-mssql.js ds4
```

The deployment scripts automatically select the correct artifacts from `standard/<version>/artifacts/` directories.

### Running the Application

**Using Docker Compose (Recommended):**

```bash
cd compose

# Configure environment
cp .env.5.2.0.example .env
# Edit .env as needed

# Start all services
pwsh ./start-services.ps1 -GenerateSigningKeys -InitializeAdminClients

# Access the APIs:
# - Ed-Fi ODS/API: https://localhost/api
# - OneRoster API: https://localhost/oneroster-api
# - Swagger UI: https://localhost/swagger
# - PGAdmin: http://localhost:5050
```

**Using Docker (Standalone):**

```bash
# Install dependencies
npm install

# Create the required Docker network (if not already created by Docker Compose setup)
docker network create pgsql_default

# Configure environment for single database setup
cp .env.example .env
# Edit .env with your database type (postgres or mssql) and connection details:
#   DB_TYPE=postgres (or mssql)
#   CONNECTION_CONFIG={"adminConnection":"host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=P@ssw0rd"}
#   ODS_CONNECTION_STRING_ENCRYPTION_KEY=<your-encryption-key>
#   OAUTH2_ISSUERBASEURL, OAUTH2_AUDIENCE, and OAUTH2_PUBLIC_KEY_PEM

# Run via Docker (single database)
# Note: Ensure your Ed-Fi ODS database is running and accessible
docker compose up --build

# OR: Configure for dual database setup (for cross-database testing)
cp .env.example .env.postgres
cp .env.example .env.mssql
# Edit .env.postgres:
#   Set PORT=3000, DB_TYPE=postgres, and PostgreSQL connection details
# Edit .env.mssql:
#   Set PORT=3001, DB_TYPE=mssql, and MSSQL connection details

# Run via Docker (dual database setup - PostgreSQL on port 3000, MSSQL on port 3001)
# Note: Ensure both PostgreSQL and MSSQL Ed-Fi ODS databases are running
docker compose -f docker-compose.dual.yml up --build
```

**Running Natively:**

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with:
#   - Database type and connection (CONNECTION_CONFIG or TENANTS_CONNECTION_CONFIG)
#   - OAuth2/JWT settings (OAUTH2_ISSUERBASEURL, OAUTH2_AUDIENCE, OAUTH2_PUBLIC_KEY_PEM)
#   - ODS connection string encryption key (ODS_CONNECTION_STRING_ENCRYPTION_KEY)
#   - Other settings as needed (see Configuration section above)

# Start the server
node server.js

# Or use npm
npm start
```

**Testing Endpoints:**

```bash
# Test a OneRoster endpoint
curl -i http://localhost:3000/ims/oneroster/rostering/v1p2/orgs -H "Authorization: Bearer MYTOKEN"

# Or with HTTPS via the Docker Compose stack:
curl -k -i https://localhost/oneroster-api/ims/oneroster/rostering/v1p2/orgs -H "Authorization: Bearer MYTOKEN"
```

**Note:** `MYTOKEN` should be obtained via a request to the OAuth2 issuer and must contain one or more of the OneRoster 1.2 scopes: `roster.readonly`, `roster-core.readonly`, and `roster-demographics.readonly`.

### Testing & Validation

#### OneRoster API Endpoints

The following OneRoster 1.2 GET endpoints are fully implemented:

- ✅ `/ims/oneroster/rostering/v1p2/academicSessions` (from Ed-Fi `sessions`, `schools`, `schoolCalendars`)
- ✅ `/ims/oneroster/rostering/v1p2/academicSessions/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/classes` (from Ed-Fi `sections`, `courseOfferings`, `schools`)
- ✅ `/ims/oneroster/rostering/v1p2/classes/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/courses` (from Ed-Fi `courses`, `courseOfferings`, `schools`)
- ✅ `/ims/oneroster/rostering/v1p2/courses/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/demographics` (from Ed-Fi `students, studentEdOrgAssn`)
- ✅ `/ims/oneroster/rostering/v1p2/demographics/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/enrollments` (from Ed-Fi `staffSectionAssn`, `studentSectionAssn`, `sections`)
- ✅ `/ims/oneroster/rostering/v1p2/enrollments/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/orgs` (from Ed-Fi `schools`, `localEducationAgencies`, `stateEducationAgencies`)
- ✅ `/ims/oneroster/rostering/v1p2/orgs/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/users` (from Ed-Fi `staffs`, `schools`, `staffSectionAssn`, `staffSchoolAssn`, `students`, `studentSchoolAssn`, `studentEdOrgAssn`, `contacts`, `studentContactAssn`)
- ✅ `/ims/oneroster/rostering/v1p2/users/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/schools` (subset of `orgs`)
- ✅ `/ims/oneroster/rostering/v1p2/schools/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/students` (subset of `users`)
- ✅ `/ims/oneroster/rostering/v1p2/students/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/teachers` (subset of `users`)
- ✅ `/ims/oneroster/rostering/v1p2/teachers/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/gradingPeriods` (subset of `academicSessions`)
- ✅ `/ims/oneroster/rostering/v1p2/gradingPeriods/{id}`
- ✅ `/ims/oneroster/rostering/v1p2/terms` (subset of `academicSessions`)
- ✅ `/ims/oneroster/rostering/v1p2/terms/{id}`

See [OneRoster 1.2 specification](https://www.imsglobal.org/spec/oneroster/v1p2) for details.

**API Features:**

- ✅ OAuth 2.0 authentication with OneRoster-specific scopes
- ✅ Versioned base URL: `/ims/oneroster/rostering/v1p2/*`
- ✅ Pagination: `?limit=100&offset=0`
- ✅ Sorting: `?sort=familyName&orderBy=asc`
- ✅ Filtering: `?filter=familyName='jones' AND dateLastModified>'2015-01-01'`
- ✅ Field selection: `?fields=givenName,familyName`

#### Cross-Database Compatibility Testing

Validate that both database implementations return identical results:

```bash
# Compare PostgreSQL and MSSQL API responses
node tests/compare-api.js

# Compare database query results directly
node tests/compare-database.js

# Test with authentication
node tests/compare-api.js --auth
```

#### Performance Testing

See [tests/README.md](tests/README.md) for detailed performance testing information and results.

### Features

**Current Capabilities:**

- ✅ Full OneRoster 1.2 API implementation (all required GET endpoints)
- ✅ OAuth2 authentication with OneRoster-specific scopes
- ✅ Multi-database support (PostgreSQL and Microsoft SQL Server)
- ✅ Multi-tenancy with tenant isolation
- ✅ ODS context routing (e.g., school year-based routing)
- ✅ Ed-Fi Data Standard 4.0 and 5.x support
- ✅ Docker Compose deployment with full Ed-Fi ODS/API stack
- ✅ Pagination, sorting, filtering, and field selection
- ✅ JWT validation with PEM-encoded public keys
- ✅ Rate limiting and CORS configuration
- ✅ Performance testing suite

**Possible Future Work:**

- [ ] Implement nested OneRoster API endpoints (e.g., `/classes/{id}/students` - "convenience" endpoints)
- [ ] Implement OneRoster API optional recommendations:
    - [ ] HTTP header: X-Total-Count for total record count
    - [ ] HTTP Link Header for next, previous, first, and last links
- [ ] OneRoster 1.2 PUT/POST/DELETE operations (write support)

### About

**Built by** [Tom Reitz](https://github.com/tomreitz) of [Education Analytics](https://www.edanalytics.org/) for [1EdTech](https://www.1edtech.org/) in support of its [partnership](https://www.1edtech.org/about/partners/ed-fi) with the [Ed-Fi Alliance](https://www.ed-fi.org/).

**Enhanced with:**

- Multi-database architecture (PostgreSQL and Microsoft SQL Server)
- Cross-platform compatibility testing
- Ed-Fi Data Standard 4.0 and 5.x support
- Multi-tenancy and ODS context routing
- Docker Compose deployment stack
- Comprehensive testing and validation tools

**Documentation:**

- [Docker Compose Setup](compose/README.md) - Full stack deployment guide
- [Testing Guide](tests/README.md) - Performance and compatibility testing
- [Database Design](docs/database_abstraction_design_knex.md) - Knex.js abstraction layer
- [IIS Deployment](docs/IIS_Installation_Guide.md) - Windows/IIS hosting guide

## Legal Information

Copyright (c) 2025 1EdTech Consortium, Inc. and contributors.

Licensed under the [Apache License, Version 2.0](LICENSE) (the "License").

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

See [NOTICES](NOTICES.md) for additional copyright and license notifications.
