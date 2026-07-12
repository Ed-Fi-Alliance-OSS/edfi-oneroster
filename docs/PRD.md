# Product Requirements Document — Ed-Fi OneRoster API

| Field | Value |
|---|---|
| **Product** | Ed-Fi OneRoster API |
| **Version** | 1.0 |
| **Status** | Reverse-engineered from the existing implementation |
| **Repository** | `Ed-Fi-Alliance-OSS/edfi-oneroster` |
| **License** | Apache License, Version 2.0 |
| **Standard** | 1EdTech OneRoster 1.2 — <https://standards.1edtech.org/oneroster/specifications/standards/v1p2> |
| **Data source** | Ed-Fi ODS (Data Standard 4.0 and 5.x) |

> **Reverse-engineering note.** This PRD documents the product as observed in the
> codebase (routes, middleware, SQL artifacts, configuration, and Dockerfile).
> Sections labeled **Current Functionality** describe shipped behavior. Sections
> labeled **Requirements** restate that behavior as normative product requirements
> using SHALL/SHOULD/MAY. Open questions are called out explicitly rather than
> hidden as assumptions.

---

## 1. Product Overview

The Ed-Fi OneRoster API is a thin HTTP layer that serves a 1EdTech OneRoster 1.2
compliant REST API from data held in an Ed-Fi ODS. It exposes read-only rostering
data — organizations, academic sessions, courses, classes, enrollments, users, and
demographics — over the standard OneRoster endpoints, so that any OneRoster-capable
consumer (for example a Learning Management System) can retrieve roster data from an
Ed-Fi ODS without needing to understand the Ed-Fi data model.

The application is intentionally thin: the HTTP layer performs authentication,
authorization, request validation, pagination/filtering/sorting, and response
shaping, while the mapping from the Ed-Fi data model to the OneRoster data model is
performed by SQL views installed into the ODS database. The REST interface and
authentication model are governed entirely by the OneRoster 1.2 specification; this
product does not invent an interface of its own.

> The IMS OneRoster (OR) standard addresses the exchange of student data (primarily
> about people, courses, enrollments and grades) between different educational
> systems for the specific needs of K-12. The primary use-case is the exchange of
> data between a Student Information System (SIS) and Learning Management System
> (LMS).

The application SHALL conform to the OneRoster 1.2 specification for REST-based data
exchange. The REST interface, query parameters, resource schemas, error payload
format, and OAuth 2.0 authentication and scope model are fully covered by the
OneRoster 1.2 specification and are not re-specified here. See
<https://standards.1edtech.org/oneroster/specifications/standards/v1p2>.

---

## 2. Strategic Alignment

- **Interoperability.** Enable Ed-Fi ecosystems to participate in the broad
  OneRoster-consuming market (LMS platforms, courseware, assessment tools) using a
  standard interface rather than bespoke integrations.
- **Partnership.** The product was built for 1EdTech in support of its partnership
  with the Ed-Fi Alliance, and serves as a reference bridge between the two data
  standards.
- **Low operational footprint.** By pushing the data transformation into SQL views
  and keeping the HTTP layer thin, the product minimizes application-side business
  logic and can be operated as a small stateless service alongside an existing ODS.

---

## 3. Target Users and Personas

| Persona | Description | Primary need |
|---|---|---|
| **Integration consumer (LMS / edtech app)** | A OneRoster-compliant client system that reads roster data. | Retrieve academic sessions, orgs, courses, classes, enrollments, users, and demographics via standard OneRoster endpoints using an OAuth 2.0 bearer token. |
| **District / state Ed-Fi operator** | Operations staff running an Ed-Fi ODS/API. | Deploy and host the OneRoster API next to an existing ODS, configure connections, and keep the SQL views refreshed. |
| **Ed-Fi data / integration engineer** | Technical staff installing the SQL artifacts and validating mappings. | Install the correct SQL artifacts for their Ed-Fi Data Standard version and confirm the OneRoster projections are correct. |

---

## 4. Jobs To Be Done

- When an LMS needs current roster data, the consumer wants to call a standard
  OneRoster 1.2 endpoint with a bearer token, so that it can synchronize rosters
  without Ed-Fi-specific knowledge.
- When a district operator stands up the service, they want to point it at an
  existing Ed-Fi ODS and Admin database, so that OneRoster data is served without a
  separate ETL pipeline into a new datastore.
- When a data engineer supports multiple Ed-Fi Data Standard versions, they want
  version-specific SQL artifacts, so that the same application serves ODS 4.0 or 5.x
  correctly.
- When a security administrator issues credentials, they want scope- and
  organization-limited tokens, so that a consumer only sees data it is authorized to
  see.

---

## 5. System Context

```
+---------------------+        Bearer JWT (RS256)        +------------------------+
|  OneRoster consumer | -------------------------------> |  Ed-Fi OneRoster API   |
|  (LMS / edtech app) |   GET /ims/oneroster/...          |  (Node.js / Express)   |
+---------------------+                                   +-----------+------------+
                                                                      | Knex (pg / mssql)
        token issued by                                               v
+---------------------+                                   +------------------------+
|  Ed-Fi ODS / API    |  ---- shares JWT signing key ---> |  Ed-Fi ODS database    |
|  (issues JWT)       |                                   |  - edfi.* source data  |
+---------------------+                                   |  - oneroster12.* views |
        |                                                 |  - auth.* auth views   |
        | EdFi_Admin DB                                   +------------------------+
        v  (OdsInstances, contexts, connections)
+---------------------+
|  EdFi_Admin         |
+---------------------+
```

- **Identity provider:** The Ed-Fi ODS/API issues the JWT. The OneRoster API is a
  resource server only; it does not issue tokens.
- **Data store:** The Ed-Fi ODS holds source data in the `edfi` schema, the
  OneRoster projections in the `oneroster12` schema, and Ed-Fi authorization views in
  the `auth` schema.
- **Admin store:** `EdFi_Admin` provides ODS instance resolution, connection
  strings, and context values (optional, depending on deployment mode).

---

## 6. Current Functionality (Reverse-Engineered)

### 6.1 Application shape

- Node.js (≥ 22.12) Express 5 microservice; entrypoint `server.js` → `src/app.js`.
- Serves HTTP by default, or HTTPS when `ENABLE_HTTPS=true` (requires TLS key/cert).
- Uses Knex.js as a database abstraction supporting **PostgreSQL** (`pg`) and
  **Microsoft SQL Server** (`mssql`), selected by `DB_TYPE`.
- Read-only: only HTTP `GET` routes are defined; all other methods and unknown paths
  return a OneRoster-formatted 404.
- Emits OneRoster-style error payloads (`imsx_codeMajor`, `imsx_severity`,
  `imsx_description`) for 401, 403, 404, 422, 429, and 500 conditions.
- Serves a discovery document at `/` (no auth), Swagger UI at `/docs`, the OpenAPI
  document at `/swagger.json`, a health check at `/health-check`, and redirects
  `/oauth/token` to the configured issuer's token endpoint.

### 6.2 Implemented OneRoster 1.2 endpoints and Ed-Fi source mapping

All endpoints are served under `/ims/oneroster/rostering/v1p2` (optionally prefixed
with tenant and/or ODS-context path segments — see 6.6). Every listed endpoint is a
fully implemented `GET`, in both collection and single-record (`/{id}`) form.

| Endpoint | Ed-Fi source (via SQL view) | Authorization scope group |
|---|---|---|
| `academicSessions` | `sessions`, `schools`, `schoolCalendars` | `academicsessions` |
| `gradingPeriods` | Subset of `academicSessions` | `academicsessions` |
| `terms` | Subset of `academicSessions` | `academicsessions` |
| `classes` | `sections`, `courseOfferings`, `schools` | `classes` |
| `courses` | `courses`, `courseOfferings`, `schools` | `courses` |
| `demographics` | `students`, `studentEdOrgAssn` | `demographics` |
| `enrollments` | `staffSectionAssn`, `studentSectionAssn`, `sections` | `enrollments` |
| `orgs` | `schools`, `localEducationAgencies`, `stateEducationAgencies` | `orgs` |
| `schools` | Subset of `orgs` | `orgs` |
| `users` | `staffs`, `students`, `contacts`, section/school associations | `users` |
| `students` | Subset of `users` | `users` |
| `teachers` | Subset of `users` | `users` |

Each collection endpoint supports the OneRoster query parameters `limit`/`offset`
(pagination), `sort`/`orderBy` (sorting), `filter` (server-side filtering), and
`fields` (field selection). The controller constrains `filter` and `fields` to an
allow-list of fields per resource.

### 6.3 SQL view mappings (the transformation layer)

The Ed-Fi → OneRoster transformation is implemented entirely in SQL artifacts, not in
application code. Artifacts are organized by Ed-Fi Data Standard version and database
engine:

```
standard/<version>/artifacts/<pgsql|mssql>/core/
  00_setup.sql              -- creates the `oneroster12` schema
  01_descriptors.sql        -- OneRoster descriptor definitions
  02_descriptorMappings.sql -- maps Ed-Fi descriptors -> OneRoster enumerations
  academic_sessions.sql, classes.sql, courses.sql, demographics.sql,
  enrollments.sql, orgs.sql, users.sql  -- one projection per OneRoster resource
```

Supported versions present in the repository: `standard/4.0.0` and `standard/5.2.0`
(the README states support for Ed-Fi Data Standard 4.0 and 5.x — 5.0, 5.1, 5.2).

Key mapping characteristics observed:

- **Schema:** All projections live in a dedicated `oneroster12` schema in the ODS,
  keeping OneRoster objects separate from the native `edfi` schema.
- **Materialization by engine:** On **PostgreSQL** each OneRoster resource is a
  **materialized view** (with a `sourcedid` index) for read performance; on **SQL
  Server** the equivalent objects are provided with an orchestration layer
  (`master_refresh` + SQL Agent job) to refresh them.
- **Descriptor mapping:** Ed-Fi descriptors are translated to OneRoster enumerated
  values through rows inserted into `edfi.descriptormapping` (for example
  `CalendarEventDescriptor` → instructional-day boolean, `ClassroomPositionDescriptor`
  → teacher-of-record, `TermDescriptor` → OneRoster term type). The application relies
  on these mappings rather than hard-coding value translations.
- **Composition:** Each view joins the underlying Ed-Fi entities required to satisfy
  the OneRoster resource (e.g., `academicsessions` composes `edfi.session`,
  `edfi.school`, and calendar data to derive session start/end dates and type).
- **Refresh:** On PostgreSQL a pg-boss cron job (default `*/15 * * * *`) refreshes the
  materialized views; on SQL Server a SQL Agent job invokes the master refresh script.

### 6.4 Authentication (JWT from the Ed-Fi ODS/API)

Authentication is delegated entirely to the Ed-Fi ODS/API. A client first performs
the OAuth 2.0 client-credentials flow against the ODS/API and receives a **JSON Web
Token (JWT)**. The client then presents that JWT as a `Bearer` token on every request
to the Ed-Fi OneRoster API. The OneRoster API acts purely as a resource server and
verifies the token; it never mints tokens.

Observed token verification behavior:

- The token SHALL be an RS256-signed JWT (`OAUTH2_TOKENSIGNINGALG` is fixed to
  `RS256`).
- Signature is verified against a configured **PEM public key**
  (`OAUTH2_PUBLIC_KEY_PEM`), which must match the ODS/API's
  `Security:Jwt:SigningKey:PublicKey`. This shared signing key is what ties the two
  services together.
- The `aud` (audience) claim SHALL match `OAUTH2_AUDIENCE`.
- The `iss` (issuer) claim SHALL match `OAUTH2_ISSUERBASEURL` (compared after
  trailing-slash normalization).
- Expired or otherwise invalid tokens are rejected with `401` and a OneRoster error
  body.

**Reverse-engineered JWT structure.** Based on how the middleware reads the token,
the JWT is expected to carry the following claims (in addition to standard `iss`,
`aud`, `exp`):

| Claim | Type | Purpose in this application |
|---|---|---|
| `scope` | space-delimited string (or array) | OneRoster scope(s) granted — drives per-endpoint authorization (see 6.5). |
| `educationOrganizationId` | string or array | The education organization(s) the token is authorized for; used to filter returned rows to authorized orgs. |
| `odsInstanceId` (aliases `ods_instance_id`, `OdsInstanceId`) | numeric | Identifies which ODS database/instance the token is authorized to query. |
| `odsInstances` | JSON string containing `OdsInstances` | Set of ODS instances the token may access; validated against configuration/route. |
| `tenantId` | string | In multi-tenant deployments, the tenant the token belongs to; must match the tenant in the request route. |

This JWT shape is inferred from the resource-server code and SHOULD be confirmed
against the actual token issued by the target Ed-Fi ODS/API version (see Open
Questions).

### 6.5 Authorization scheme

Authorization has two layers, both enforced in middleware after token verification:

1. **Scope-based endpoint authorization.** Each route is guarded by a scope check
   using OneRoster 1.2 scopes:
   - `.../scope/roster.readonly` (full roster read) **or**
     `.../scope/roster-core.readonly` (core roster read) grants access to all
     non-demographic endpoints.
   - `.../scope/roster-demographics.readonly` is **required** for the `demographics`
     endpoints and is the **only** scope that grants demographics access — consistent
     with OneRoster 1.2 (roster.readonly explicitly excludes demographics).
   - A request lacking the required scope receives `403` with a OneRoster error body.

2. **Education-organization row authorization.** The `educationOrganizationId`
   claim(s) are extracted from the token and used to constrain results to the
   authorized organizations. Row filtering is implemented against Ed-Fi authorization
   views in the `auth` schema (e.g.,
   `educationorganizationidtoeducationorganizationid`,
   `...tostudentusi`, `...tostaffusi`, `...tocontactusi`/`...toparentusi`), so a
   token only ever returns data for organizations (and the students/staff/contacts
   beneath them) that it is entitled to.

Additionally, in multi-tenant / multi-instance deployments the token's `tenantId` and
ODS-instance claims are validated against the request route and configuration, so a
token cannot be replayed against a tenant or ODS instance it was not issued for.

### 6.6 Deployment configuration modes

- **Single-tenant (default):** one `EdFi_Admin` connection via `CONNECTION_CONFIG`;
  ODS instances resolved from `EdFi_Admin.OdsInstances` or injected via
  `ODS_INSTANCES`.
- **Multi-tenant:** `MULTITENANCY_ENABLED=true` with `TENANTS_CONNECTION_CONFIG`
  mapping tenant IDs to admin connections; routes are prefixed with `:tenantId`.
- **ODS context routing (optional):** `ODS_CONTEXT_ROUTE_TEMPLATE` (e.g., a school
  year range) adds a context path segment used to select the correct ODS instance and
  is validated against the constraint and the `OdsInstanceContexts` data.
- **Connection-string encryption:** ODS connection strings stored in
  `EdFi_Admin.OdsInstances` are decrypted with
  `ODS_CONNECTION_STRING_ENCRYPTION_KEY`, which must match the ODS/API's
  `OdsConnectionStringEncryptionKey`.

### 6.7 Packaging and hosting

- **Docker:** A `Dockerfile` (based on `node:22-alpine`, running as a non-root
  `appuser`, exposing port 3000, with `curl` and the PostgreSQL client and the AWS RDS
  global trust bundle installed) builds the runnable service image.
- **Docker Compose:** Compose-based stacks are provided for local development and
  testing/demonstration.
- **IIS:** A Windows/IIS hosting path is documented, with graceful shutdown tuned to
  fit within the IIS app-pool recycle timeout.

---

## 7. Functional Requirements

### Conformance
- **FR-CONF-1** The application SHALL conform to the 1EdTech OneRoster 1.2
  specification for REST-based data exchange
  (<https://standards.1edtech.org/oneroster/specifications/standards/v1p2>).
- **FR-CONF-2** The REST interface, query parameter semantics, resource field
  definitions, and error payload format SHALL follow OneRoster 1.2 and SHALL NOT be
  redefined by this product.

### Endpoints
- **FR-EP-1** The application SHALL implement, as read-only `GET` operations, the
  OneRoster Rostering resources listed in §6.2 in both collection and single-record
  form under `/ims/oneroster/rostering/v1p2`.
- **FR-EP-2** Each collection endpoint SHALL support the `limit`/`offset`,
  `sort`/`orderBy`, `filter`, and `fields` query parameters.
- **FR-EP-3** `filter` and `fields` SHALL be restricted to a per-resource allow-list
  of supported fields.
- **FR-EP-4** The application SHALL expose a discovery document, an OpenAPI document,
  interactive API documentation, and a health-check endpoint.
- **FR-EP-5** Unsupported paths and non-GET methods SHALL return a OneRoster-formatted
  `404`.

### Data mapping
- **FR-MAP-1** The Ed-Fi → OneRoster transformation SHALL be implemented as SQL views
  installed into a dedicated `oneroster12` schema in the ODS, not in application code.
- **FR-MAP-2** The application SHALL provide version-specific SQL artifacts for the
  supported Ed-Fi Data Standard versions (4.0 and 5.x) and for both PostgreSQL and SQL
  Server.
- **FR-MAP-3** Ed-Fi descriptors SHALL be translated to OneRoster enumerated values
  via descriptor mappings rather than hard-coded application logic.
- **FR-MAP-4** On PostgreSQL, OneRoster resources SHALL be materialized views with a
  refresh mechanism; on SQL Server, an equivalent refresh orchestration SHALL be
  provided.

### Authentication
- **FR-AUTH-1** The application SHALL accept a bearer JWT issued by the Ed-Fi ODS/API
  and SHALL act solely as a resource server (it SHALL NOT issue tokens).
- **FR-AUTH-2** The application SHALL verify the JWT signature (RS256) using a
  configured public key that matches the ODS/API signing key, and SHALL validate the
  `aud` and `iss` claims.
- **FR-AUTH-3** The application SHALL reject missing, malformed, expired, or otherwise
  invalid tokens with a OneRoster-formatted `401`.

### Authorization
- **FR-AUTHZ-1** The application SHALL enforce OneRoster 1.2 scope requirements per
  endpoint: `roster.readonly` or `roster-core.readonly` for non-demographic resources,
  and `roster-demographics.readonly` (only) for demographics.
- **FR-AUTHZ-2** Requests lacking the required scope SHALL receive a
  OneRoster-formatted `403`.
- **FR-AUTHZ-3** The application SHALL constrain returned rows to the education
  organizations authorized by the token's `educationOrganizationId` claim, using the
  Ed-Fi `auth` schema views.
- **FR-AUTHZ-4** In multi-tenant / multi-instance deployments, the application SHALL
  validate the token's tenant and ODS-instance claims against the request route and
  configuration.

### Deployment
- **FR-DEP-1** The application SHALL support single-tenant and multi-tenant
  configurations, and optional ODS-context routing.
- **FR-DEP-2** The application SHALL support both PostgreSQL and Microsoft SQL Server
  as the ODS engine, selected by configuration.
- **FR-DEP-3** A `Dockerfile` SHALL be provided to build a runnable container image of
  the service.
- **FR-DEP-4** The application SHALL provide a Docker Compose based setup for local
  development and testing.

---

## 8. Non-Functional Requirements

- **NFR-COMPAT-1** The application SHALL be compatible with Ed-Fi Data Standard 4.0
  and 5.x ODS databases.
- **NFR-SEC-1** The application SHALL support HTTPS/TLS (TLS 1.2+) for its own
  endpoint when enabled.
- **NFR-SEC-2** The application SHALL support configurable CORS origins.
- **NFR-SEC-3** ODS connection strings stored in `EdFi_Admin` SHALL be decryptable
  using a key that matches the ODS/API configuration; secrets SHALL be supplied via
  environment/secret store, not committed.
- **NFR-SEC-4** The container image SHALL run as a non-root user.
- **NFR-REL-1** The application SHALL validate required environment variables at
  startup and SHALL abort startup on invalid configuration.
- **NFR-REL-2** The application SHALL perform graceful shutdown on `SIGTERM`/`SIGINT`,
  closing database pools and background jobs within the IIS recycle timeout.
- **NFR-PERF-1** The application SHALL rate-limit OneRoster endpoints (configurable
  window and request cap) and SHALL support `trust proxy` for correct client-IP
  identification behind a reverse proxy.
- **NFR-PERF-2** Read performance SHALL be supported through materialized views
  (PostgreSQL) with a scheduled refresh, keeping request-time work minimal.
- **NFR-OPS-1** The application SHALL expose a health-check endpoint suitable for
  container and load-balancer probes.
- **NFR-OBS-1** The application SHALL log verification, authorization, and unhandled
  error events without leaking stack traces to clients in production.

---

## 9. System Architecture

| Component | Responsibility | Technology |
|---|---|---|
| HTTP API | Routing, auth, validation, pagination/filter/sort, response shaping | Express 5 (Node.js ≥ 22) |
| Auth middleware | JWT verification, scope checks, tenant/instance/context validation | `jose`, custom middleware |
| Data access | Query OneRoster views, apply org-based auth filtering | Knex.js (`pg`, `mssql`) |
| OneRoster projection layer | Ed-Fi → OneRoster transformation | SQL views/materialized views (`oneroster12` schema) |
| Refresh orchestration | Keep projections current | pg-boss cron (PostgreSQL) / SQL Agent (SQL Server) |
| Admin/instance resolution | Resolve ODS connections, contexts, tenants | `EdFi_Admin`, env config |
| Packaging | Container image and local stack | Dockerfile, Docker Compose |

**Data ownership:** The Ed-Fi ODS remains the system of record. This application owns
no persistent data of its own; the `oneroster12` and refresh objects are derived
projections over `edfi` source data. Tokens are owned by the Ed-Fi ODS/API.

---

## 10. Out of Scope and Known Limitations

- **Write operations.** Only `GET` is implemented; the application does not support
  creating, updating, or deleting roster data.
- **Non-Rostering OneRoster services.** Gradebook/Resources and other OneRoster
  service families beyond the Rostering endpoints in §6.2 are not implemented.
- **Token issuance.** The application does not issue, refresh, or manage OAuth tokens;
  that is the responsibility of the Ed-Fi ODS/API.
- **Data correction.** The application does not correct source-data quality issues; it
  projects whatever the ODS contains through the SQL views and descriptor mappings.
- **Non-supported Ed-Fi versions.** Only Ed-Fi Data Standard 4.0 and 5.x artifacts are
  provided.

---

## 11. Glossary

| Term | Definition |
|---|---|
| **OneRoster 1.2** | 1EdTech standard for exchanging K-12 roster data over REST. |
| **Ed-Fi ODS** | Operational Data Store holding source student/education data in the `edfi` schema. |
| **Ed-Fi ODS/API** | Ed-Fi API platform that here also issues the OAuth JWT. |
| **Data Standard (DS) 4.0 / 5.x** | Versions of the Ed-Fi data model; determine which SQL artifacts apply. |
| **`oneroster12` schema** | ODS schema holding the OneRoster projection views. |
| **`auth` schema** | Ed-Fi authorization views used to filter rows by education organization. |
| **Descriptor mapping** | Rows in `edfi.descriptormapping` translating Ed-Fi descriptors to OneRoster enumerations. |
| **sourcedId** | OneRoster's stable per-record identifier. |
| **Scope** | OAuth 2.0 permission string; here the OneRoster `roster*.readonly` scopes. |
| **ODS instance** | A specific ODS database; selected via token claims and/or route context. |
| **Tenant** | A logically isolated customer in multi-tenant deployments. |

---

## 12. Open Questions

1. **Exact JWT claim names.** The resource server accepts several aliases
   (`odsInstanceId` / `ods_instance_id` / `OdsInstanceId`) and reads
   `educationOrganizationId`, `odsInstances`, and `tenantId`. The canonical claim
   names and formats emitted by each supported Ed-Fi ODS/API version SHOULD be
   confirmed and pinned.
2. **SQL Server refresh cadence.** PostgreSQL refresh cadence is configurable via
   `PGBOSS_CRON`; the operationally recommended SQL Agent schedule for SQL Server
   SHOULD be documented.
3. **Field-level conformance coverage.** Whether every OneRoster 1.2 field for each
   resource is populated by the current views (vs. left null) SHOULD be validated
   against the specification's required/optional field lists.
4. **Consumer authorization granularity.** Confirm whether org-scoped filtering fully
   covers all resources (including derived subsets like `teachers`/`students`) in all
   supported Ed-Fi versions.
