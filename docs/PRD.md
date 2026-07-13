# Product Requirements Document — Ed-Fi OneRoster API

> **Status:** complete \
> **Owner:** Ed-Fi Alliance and 1EdTech Consortium \
> **Jira Project:** OneRoster \
> **Repository:** `Ed-Fi-Alliance-OSS/edfi-oneroster`

## 1. Product Overview

The Ed-Fi OneRoster API is a thin HTTP layer that serves a 1EdTech OneRoster 1.2
compliant REST API from data held in an Ed-FI API. It exposes read-only rostering
data — organizations, academic sessions, courses, classes, enrollments, users, and
demographics — over the standard OneRoster endpoints, so that any OneRoster-capable
consumer (for example a Learning Management System) can retrieve roster data from an
Ed-FI API without needing to understand the Ed-Fi Data Standard model.

The application is intentionally thin: the HTTP layer performs authentication,
authorization, request validation, pagination/filtering/sorting, and response
shaping, while the mapping from the Ed-Fi database to the OneRoster data model is
performed by SQL views installed into the `EdFi_ODS` database. The REST interface and
authentication model are governed entirely by the OneRoster 1.2 specification; this
product does not invent an interface of its own.

> The IMS OneRoster (OR) standard addresses the exchange of student data (primarily
> about people, courses, enrollments and grades) between different educational
> systems for the specific needs of K-12. The primary use-case is the exchange of
> data between a Student Information System (SIS) and Learning Management System
> (LMS).

The application SHALL conform to the OneRoster 1.2 specification for REST-based
data exchange. The REST interface, query parameters, resource schemas, error
payload format, and OAuth 2.0 authentication and scope model are fully covered
by the [OneRoster 1.2
specification](https://standards.1edtech.org/oneroster/specifications/standards/v1p2)
and are not re-specified here.

### 1.1. Strategic Alignment

- **Interoperability.** Enable Ed-Fi Data Standard ecosystems to participate in
  the broad OneRoster-consuming market (LMS platforms, courseware, assessment
  tools) using a standard interface rather than bespoke integrations.
- **Partnership.** The product was built for 1EdTech in support of its partnership
  with the Ed-Fi Alliance, and serves as a reference bridge between the two data
  standards.
- **Low operational footprint.** By pushing the data transformation into SQL views
  and keeping the HTTP layer thin, the product minimizes application-side business
  logic and can be operated as a small stateless service alongside an existing ODS.

### 1.2. Target Users and Personas

- **Integration consumer (LMS / edtech app)**: A OneRoster-compliant client
  system that reads roster data.
  - Primary need: Retrieve academic sessions, orgs, courses, classes,
    enrollments, users, and demographics via standard OneRoster endpoints using
    an OAuth 2.0 bearer token.
- **District / state Ed-Fi operator** - Operations staff running an Ed-FI
  API/API.
  - Primary need: Deploy and host the OneRoster API next to an existing ODS,
    configure connections, and keep the SQL views refreshed.
- **Ed-Fi data / integration engineer** - Technical staff installing the SQL
  artifacts and validating mappings.
  - Primary need: Install the correct SQL artifacts for their Ed-Fi Data
    Standard version and confirm the OneRoster projections are correct. |

### 1.3. Jobs To Be Done

- When an LMS needs current roster data, the consumer wants to call a standard
  OneRoster 1.2 endpoint with a bearer token, so that it can synchronize rosters
  without Ed-Fi-specific knowledge.
- When a district operator stands up the service, they want to point it at an
  existing `EdFi_ODS` and `EdFi_Admin` database, so that OneRoster data is
  served without a separate ETL pipeline into a new datastore.
- When a data engineer supports multiple Ed-Fi Data Standard versions, they want
  version-specific SQL artifacts, so that the same application serves ODS 4.0 or 5.x
  correctly.
- When a security administrator issues credentials, they want scope- and
  organization-limited tokens, so that a consumer only sees data it is authorized to
  see.

## 2. Enterprise Architecture

```plaintext
+---------------------+        Bearer JWT (RS256)        +------------------------+
|  OneRoster consumer | -------------------------------> |  Ed-Fi OneRoster API   |
|  (LMS / edtech app) |   GET /ims/oneroster/...         |  (Node.js / Express)   |
+---------------------+                                  +-----------+------------+
                                                                      | pg / mssql
        token issued by                                               v
+---------------------+                                   +------------------------+
|  Ed-FI ODS / API    |  ---- shares JWT signing key ---> |  EdFi_ODS database     |
|  (issues JWT)       |                                   |  - edfi.* source data  |
+---------------------+                                   |  - oneroster12.* views |
        |                                                 |  - auth.* auth views   |
        | EdFi_Admin DB                                   +------------------------+
        v
+-------------------------+
|  EdFi_Admin             |
|  - OdsInstances         |
|  - OdsInstanceContexts  |
+-------------------------+
```

- **Identity provider:** The Ed-FI API/API issues the JWT. The OneRoster API is a
  resource server only; it does not issue tokens.
- **Data store:** The Ed-FI API holds source data in the `edfi` schema, the
  OneRoster projections in the `oneroster12` schema, and Ed-Fi authorization views in
  the `auth` schema.
- **Admin store:** `EdFi_Admin` provides ODS instance resolution, connection
  strings, and context values (optional, depending on deployment mode).

## 3. Functional Requirements

### Conformance

- **FR-CONF-1** The application SHALL conform to the [1EdTech OneRoster
  1.2](https://standards.1edtech.org/oneroster/specifications/standards/v1p2)
  specification for REST-based data exchange.
- **FR-CONF-2** The REST interface, query parameter semantics, and resource field
  definitions SHALL follow OneRoster 1.2 and SHALL NOT be redefined by this
  product.
- **FR-CONF-3**: Error payloads emitted by the application's own handlers SHALL
  use the OneRoster-style payloads (`imsx_codeMajor`, `imsx_severity`,
  `imsx_description`) for 401, 403, 404, 422, and 500 conditions.

### Endpoints

- **FR-EP-1** The application SHALL implement, as read-only `GET` operations, the
  OneRoster Rostering resources listed below in both collection and single-record
  form under `/ims/oneroster/rostering/v1p2`. Every listed endpoint is a
  fully implemented `GET`, in both collection and single-record (`/{id}`) form.

  | Endpoint           | Ed-Fi source (via SQL view)                                   | Authorization scope group |
  | ------------------ | ------------------------------------------------------------- | ------------------------- |
  | `academicSessions` | `sessions`, `schools`, `schoolCalendars`                      | `academicsessions`        |
  | `gradingPeriods`   | Subset of `academicSessions`                                  | `academicsessions`        |
  | `terms`            | Subset of `academicSessions`                                  | `academicsessions`        |
  | `classes`          | `sections`, `courseOfferings`, `schools`                      | `classes`                 |
  | `courses`          | `courses`, `courseOfferings`, `schools`                       | `courses`                 |
  | `demographics`     | `students`, `studentEdOrgAssn`                                | `demographics`            |
  | `enrollments`      | `staffSectionAssn`, `studentSectionAssn`, `sections`          | `enrollments`             |
  | `orgs`             | `schools`, `localEducationAgencies`, `stateEducationAgencies` | `orgs`                    |
  | `schools`          | Subset of `orgs`                                              | `orgs`                    |
  | `users`            | `staffs`, `students`, `contacts`, section/school associations | `users`                   |
  | `students`         | Subset of `users`                                             | `users`                   |
  | `teachers`         | Subset of `users`                                             | `users`                   |

- **FR-EP-2** Each collection endpoint SHALL support the `limit`/`offset`,
  `sort`/`orderBy`, `filter`, and `fields` query parameters.
- **FR-EP-3** `filter` and `fields` SHALL be restricted to a per-resource allow-list
  of supported fields.
- **FR-EP-4** The application SHALL expose a discovery document, an OpenAPI document,
  interactive API documentation, and a health-check endpoint.
- **FR-EP-5** Unknown `GET` paths within the OneRoster router SHALL return a
  OneRoster-formatted `404`.
- **FR-EP-6** The application SHALL expose a read-only, anonymously-accessible,
  discovery document at `/`.
- **FR-EP-7** The application SHALL return a valid OpenAPI specification
  document at path `/docs/swagger.json`.
- **FR-EP-8**: The application SHALL provide an anonymously-accessible,
  read-only `/health-check` endpoint that responds with status code 200 when all
  connected databases are alive, or 503 when any connection cannot be reached.

### Data mapping

- **FR-MAP-1** The Ed-Fi → OneRoster transformation SHALL be implemented as SQL views
  installed into a dedicated `oneroster12` schema in the ODS, not in application code.
- **FR-MAP-2** The application SHALL provide version-specific SQL artifacts for
  the supported Ed-Fi Data Standard versions (4.0 and 5.x) and for both
  PostgreSQL and Microsoft SQL Server.
- **FR-MAP-3** Ed-Fi descriptors SHALL be translated to OneRoster enumerated values
  via descriptor mappings rather than hard-coded application logic.
- **FR-MAP-4** On PostgreSQL, OneRoster resources SHALL be materialized views with a
  refresh mechanism; on SQL Server, an equivalent refresh orchestration SHALL be
  provided.

### Authentication

- **FR-AUTHN-1** The application SHALL accept a bearer JWT issued by the Ed-FI ODS/API
  and SHALL act solely as a resource server (it SHALL NOT issue tokens).
- **FR-AUTHN-2** The application SHALL verify the JWT signature (RS256) using a
  configured public key that matches the ODS/API signing key.
- **FR-AUTHN-3** The application SHALL validate the `aud` and `iss` claims.
- **FR-AUTHN-4** The application SHALL reject missing, malformed, expired, or otherwise
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
- **FR-AUTHZ-4** In multi-tenant deployments, the application SHALL validate the
  token's `tenantId` claim against the request route. When ODS-context routing is
  enabled, the application SHALL resolve the requested ODS instance from the JWT's
  authorized `odsInstances` entries using the route context value.

### Deployment

- **FR-DEP-1** The application SHALL support single-tenant and multi-tenant
  configurations, and optional ODS-context routing.
- **FR-DEP-2** The application SHALL support both PostgreSQL and Microsoft SQL Server
  as the database engine, selected by configuration.
- **FR-DEP-3** A `Dockerfile` SHALL be provided to build a runnable container image of
  the service.
- **FR-DEP-4** The application SHALL provide a Docker Compose based setup for local
  development and testing.

## 4. Non-Functional Requirements

### Security

- **NFR-SEC-1** The application SHALL support HTTPS/TLS (TLS 1.2+) for its own
  endpoint when enabled.
- **NFR-SEC-2** The application SHALL support configurable CORS origins.
- **NFR-SEC-3** ODS connection strings stored in `EdFi_Admin` SHALL be decryptable
  using a key that matches the ODS/API configuration; secrets SHALL be supplied via
  environment/secret store, not committed.
- **NFR-SEC-4** The container image SHALL run as a non-root user.

### Reliability

- **NFR-REL-1** The application SHALL validate required environment variables at
  startup and SHALL abort startup on invalid configuration.
- **NFR-REL-2** The application SHALL perform graceful shutdown on `SIGTERM`/`SIGINT`,
  closing database pools and background jobs within the IIS recycle timeout.

### Performance

- **NFR-PERF-1** The application SHALL rate-limit OneRoster endpoints (configurable
  window and request cap) and SHALL support `trust proxy` for correct client-IP
  identification behind a reverse proxy.
- **NFR-PERF-2** Read performance SHALL be supported through materialized views
  (PostgreSQL) with refresh orchestration that can be scheduled via `PGBOSS_CRON`,
  keeping request-time work minimal.

### Operations

- **NFR-OPS-1** The application SHALL expose a health-check endpoint suitable for
  container and load-balancer probes.
- **NFR-OBS-1** The application SHALL log verification, authorization, and
  unhandled error events without leaking stack traces or PII to clients in
  production.

## 5. Out of Scope and Known Limitations

- **Write operations.** Only `GET` is implemented; the application does not support
  creating, updating, or deleting roster data.
- **Non-Rostering OneRoster services.** Gradebook/Resources and other OneRoster
  service families beyond the Rostering endpoints are not implemented.
- **Token issuance.** The application does not issue, refresh, or manage OAuth tokens;
  that is the responsibility of the Ed-FI API/API.
- **Data correction.** The application does not correct source-data quality issues; it
  projects whatever the ODS contains through the SQL views and descriptor mappings.
- **Non-supported Ed-Fi versions.** Only Ed-Fi Data Standard 4.0 and 5.x artifacts are
  provided.

## 6. Glossary

| Term                             | Definition                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| **OneRoster 1.2**                | 1EdTech standard for exchanging K-12 roster data over REST.                               |
| **Ed-FI ODS**                    | Operational Data Store holding source student/education data in the `edfi` schema.        |
| **Ed-FI ODS/API**                | Ed-Fi API platform that here also issues the OAuth JWT.                                   |
| **Data Standard (DS) 4.0 / 5.x** | Versions of the Ed-Fi data model; determine which SQL artifacts apply.                    |
| **`oneroster12` schema**         | ODS schema holding the OneRoster projection views.                                        |
| **`auth` schema**                | Ed-Fi authorization views used to filter rows by education organization.                  |
| **Descriptor mapping**           | Rows in `edfi.descriptormapping` translating Ed-Fi descriptors to OneRoster enumerations. |
| **sourcedId**                    | OneRoster's stable per-record identifier.                                                 |
| **Scope**                        | OAuth 2.0 permission string; here the OneRoster `roster*.readonly` scopes.                |
| **ODS instance**                 | A specific ODS database; selected via token claims and/or route context.                  |
| **Tenant**                       | A logically isolated customer in multi-tenant deployments.                                |
