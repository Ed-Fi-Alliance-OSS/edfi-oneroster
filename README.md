This app serves a OneRoster 1.2 API from data in an Ed-Fi ODS (Data Standard 4.0+ and 5.0+).

### Architecture

**Initial Implementation (PostgreSQL)**
* materialized views on ODS tables (see `/sql` - these queries must be run on the ODS manually)
* express-js API connected to Ed-Fi ODS (Postgres) database
* [pg-boss](https://timgit.github.io/pg-boss/#/./api/scheduling) to schedule refresh of the materialized views
* Swagger documentation with OAS2.0
* OAuth2 authentication with [OneRoster 1.2 scopes](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#OpenAPI_Security)

**Multi-Database Support (Added)**
* **Database Abstraction Layer**: [Knex.js](https://knexjs.org/) provides unified database access for both PostgreSQL and Microsoft SQL Server
* **MSSQL Implementation**: Full Microsoft SQL Server support with stored procedures and automated refresh via SQL Server Agent jobs  
* **Cross-Database Compatibility**: Both implementations tested for identical API responses and OneRoster compliance
* **Factory Pattern**: `DatabaseServiceFactory` automatically selects the appropriate database service based on configuration

**Data Standard Support**
* **Ed-Fi Data Standard 5.0-5.2**: Full support (original implementation)
* **Ed-Fi Data Standard 4.0**: Added support with separate SQL implementations for both PostgreSQL and MSSQL

### Database Implementations

| Feature | PostgreSQL | Microsoft SQL Server |
|---------|------------|---------------------|
| **Data Views** | Materialized Views | Stored Procedures + Tables |
| **Refresh Method** | pg-boss scheduled jobs | SQL Server Agent jobs |
| **JSON Support** | Native JSON columns | NVARCHAR with JSON parsing |
| **Deployment** | SQL scripts in `/sql/` | Deployment scripts in `/sql/mssql/` |

### Details
The specific OneRoster (GET) endpoints implemented are:
- [x] `/ims/oneroster/rostering/v1p2/academicSessions` (from Ed-Fi `sessions`, `schools`, `schoolCalendars`)
- [x] `/ims/oneroster/rostering/v1p2/academicSessions/{id}`
- [x] `/ims/oneroster/rostering/v1p2/classes` (from Ed-Fi `sections`, `courseOfferings`, `schools`)
- [x] `/ims/oneroster/rostering/v1p2/classes/{id}`
- [x] `/ims/oneroster/rostering/v1p2/courses` (from Ed-Fi `courses`, `courseOfferings`, `schools`)
- [x] `/ims/oneroster/rostering/v1p2/courses/{id}`
- [x] `/ims/oneroster/rostering/v1p2/demographics` (from Ed-Fi `students, studentEdOrgAssn`)
- [x] `/ims/oneroster/rostering/v1p2/demographics/{id}`
- [x] `/ims/oneroster/rostering/v1p2/enrollments` (from Ed-Fi `staffSectionAssn`, `studentSectionAssn`, `sections`)
- [x] `/ims/oneroster/rostering/v1p2/enrollments/{id}`
- [x] `/ims/oneroster/rostering/v1p2/orgs` (from Ed-Fi `schools`, `localEducationAgencies`, `stateEducationAgencies`)
- [x] `/ims/oneroster/rostering/v1p2/orgs/{id}`
- [x] `/ims/oneroster/rostering/v1p2/users` (from Ed-Fi `staffs`, `schools`, `staffSectionAssn`, `staffSchoolAssn`, `students`, `studentSchoolAssn`, `studentEdOrgAssn`, `contacts`, `studentContactAssn`)
- [x] `/ims/oneroster/rostering/v1p2/users/{id}`
- [x] `/ims/oneroster/rostering/v1p2/schools` (subset of `orgs`)
- [x] `/ims/oneroster/rostering/v1p2/schools/{id}`
- [x] `/ims/oneroster/rostering/v1p2/students` (subset of `users`)
- [x] `/ims/oneroster/rostering/v1p2/students/{id}`
- [x] `/ims/oneroster/rostering/v1p2/teachers` (subset of `users`)
- [x] `/ims/oneroster/rostering/v1p2/teachers/{id}`
- [x] `/ims/oneroster/rostering/v1p2/gradingPeriods` (subset of `academicSessions`)
- [x] `/ims/oneroster/rostering/v1p2/gradingPeriods/{id}`
- [x] `/ims/oneroster/rostering/v1p2/terms` (subset of `academicSessions`)
- [x] `/ims/oneroster/rostering/v1p2/terms/{id}`

(See OneRoster docs at  https://www.imsglobal.org/spec/oneroster/v1p2#rest-documents)

OneRoster API requirements:
- [x] OAuth 2.0
- [x] Base URL must be versioned, like `/oneroster/v1p2/*`
- [x] Each endpoint can accept a `limit` (default=100) and `offset` (default=0) parameters for pagination.
- [x] Sorting possible via `?sort=familyName&orderBy=asc`
- [x] Filtering possible via `?filter=familyName%3D%27jones%27%20AND%20dateLastModified%3E%272015%3D01-01%27` (see [these docs](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main3p3))
- [x] Field selection possible via `?fields=givenName,familyName`

### Deployment Options

#### PostgreSQL (Original Implementation)
Deploy the PostgreSQL implementation using the automated deployment script:

```bash
# Deploy OneRoster schema to PostgreSQL (Data Standard 5)
./sql/deploy-postgres.sh

# For Data Standard 4 support
./sql/deploy-postgres.sh ds4
```

Alternatively, the SQL in `/sql/*.sql` can be manually run on your Ed-Fi ODS Postgres database.

To run an Ed-Fi ODS (Postgres database, DS 5.x) in docker:
```bash
# (DS 5.0)
docker run -d -e POSTGRES_PASSWORD=P@ssw0rd -p 5432:5432 edfialliance/ods-api-db-ods-sandbox:7.1

# (DS 5.1)
docker run -d -e POSTGRES_PASSWORD=P@ssw0rd -p 5432:5432 edfialliance/ods-api-db-ods-sandbox:7.2

# (DS 5.2)
docker run -d -e POSTGRES_PASSWORD=P@ssw0rd -p 5432:5432 edfialliance/ods-api-db-ods-sandbox:7.3

# Then enable connections:
psql -U postgres
ALTER DATABASE "EdFi_Ods_Populated_Template" ALLOW_CONNECTIONS true;
```

#### Microsoft SQL Server (Added Support)
Deploy the MSSQL implementation using the automated deployment script:

```bash
# Deploy OneRoster schema to MSSQL
node sql/mssql/deploy-mssql.js

# For Data Standard 4 support
node sql/mssql/deploy-mssql.js ds4
```

#### Multi-Database Development
Test both implementations simultaneously:

```bash
# Run both PostgreSQL and MSSQL APIs
./deploy-dual.sh

# This starts:
# - PostgreSQL API on port 3000
# - MSSQL API on port 3001
```

### Configuration

#### Environment Variables
Make a copy of .env.sample to .env

Configure the database type and connection:

```bash
# PostgreSQL Configuration
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=password
DB_NAME=EdFi_Ods_Populated_Template

# MSSQL Configuration
DB_TYPE=mssql
MSSQL_SERVER=localhost
MSSQL_DATABASE=EdFi_Ods_Sandbox
MSSQL_USER=sa
MSSQL_PASSWORD=YourPassword
MSSQL_PORT=1433

# OAuth2 Configuration
OAUTH2_AUDIENCE=your-audience
OAUTH2_ISSUERBASEURL=https://your-auth0-domain/
OAUTH2_TOKENSIGNINGALG=RS256

# API Configuration
PORT=3000
```

#### Data Standard Configuration
The system automatically detects and supports both Data Standard 4 and 5:

```bash
# Ed-Fi Data Standard 5 (default)
npm start

# Ed-Fi Data Standard 4 (configure via deployment scripts)
./sql/deploy-postgres.sh ds4
node sql/mssql/deploy-mssql.js ds4
```

### Running the Application

```bash
# Install dependencies
npm install

# Run via Docker (PostgreSQL)
docker compose up --build

# Run via Docker (dual database setup)
docker compose -f docker-compose.dual.yml up --build

# Run natively
node server.js

# Test a OneRoster endpoint
curl -i http://localhost:3000/ims/oneroster/rostering/v1p2/orgs -H "Authorization: Bearer MYTOKEN"
# "MYTOKEN" should be obtained via a request to the OAuth2 issuer base URL and must contain one or
# more of the OneRoster 1.2 scopes: `roster.readonly`, `roster-core.readonly`, and
# `roster-demographics.readonly`.
```

### Testing & Validation

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
See [`tests/README.md`](tests/README.md) for detailed performance testing information and results.

### Possible future work
- [ ] implement nested OneRoster API endpoints (like `/classes/{id}/students` - see "convenience"-tagged endpoints in Swagger)? (not required for OneRoster certification)
- [ ] implement OneRoster API optional recommendations:
    - [ ] HTTP header: X-Total-Count should report the total record count.
    - [ ] HTTP Link Header. should give next, previous, first and last links.
- [ ] Multi-tenant support with tenant isolation strategies

### About
Built by [Tom Reitz](https://github.com/tomreitz) of [Education Analytics](https://www.edanalytics.org/) for [1EdTech](https://www.1edtech.org/) in support of its [partnership](https://www.1edtech.org/about/partners/ed-fi) with the [Ed-Fi Alliance](https://www.ed-fi.org/).

**Database abstraction and MSSQL support** added with multi-database architecture, cross-platform compatibility testing, and Ed-Fi Data Standard 4 support.
