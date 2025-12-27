# Spike Results

Executive summary: This document summarizes the spike findings for the current EdFi OneRoster implementation and recommends an approach for adding automated tests to ensure data integrity and consistency. The recommended path is API-level end-to-end testing using Bruno, with database-layer scripts as a possible simpler alternative for focused checks.

The following spike results define the state of the art of the current EdFi OneRoster implementation and provide next steps, considerations, and recommendations for adding automated tests to ensure data integrity and consistency.

## Context

__EdFi OneRoster__ API is a straightforward API that does not handle business logic itself. The business logic is implemented in database artifacts — materialized views (PostgreSQL) and tables (MSSQL). Periodic scripts update those views and tables: they extract and synthesize data from the EdFi ODS database and transform it into a simpler format the OneRoster ecosystem consumes. The OneRoster API then reads that processed data; a parameter controls whether it reads from PostgreSQL or MSSQL.

This spike explored whether to implement automation at the database level (using scripts) or at the API level (using an API tester such as Bruno). The implications of each approach are described in the next sections.

## Automation layers

Next you will find the considerations and recommendations for implementing automated testing in the different layers of the application (database layer or API layer).

### API layer

This is the __recommended__ approach since it will perform a holistic API validation, ensuring integrity and data consistency as experienced by an end user. It will use [Bruno](https://www.usebruno.com/) (preferred option) to implement E2E tests. The tests will compare results from the __EdFi OneRoster__ API and the __EdFi DataStandard__ API; details follow.

| Pros                                              | Cons                                  |
| ------------------------------------------------- | ------------------------------------- |
| End to End testing (full application validation)  | More complex implementation           |
| Comparison between different database engines     | Will require sandbox credentials      |
| One single language (JavaScript scripts)          | Complex data caching for comparisons  |
| Bruno Reports                                     |                                       |
| Bruno CLI features for CI implementation  |                                       |
| Easier code reviews                               |                                       |

#### How to infer what should be tested?


Since __EdFi OneRoster__ endpoints synthesize data from different sources, each endpoint should be validated against its counterpart in the __EdFi DataStandard__ API.

The synthesized data for OneRoster is stored under the `oneroster12` schema, and the original data resides under the `edfi` schema in the ODS database.

Therefore, when evaluating the [academicSessions](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/blob/main/sql/academic_sessions.sql) PostgreSQL script, consider which EdFi tables supply the data that populate `academicSessions` records.

For example, continuing with the `academicSessions` endpoint (/ims/rostering/v1p2/academicSessions), take a look to the following results from `oneroster12`.`academicSessions` and `edfi`.`Session` scripts for the same record:

> The `schoolId` and `sessionName` values were extracted from the `metadata` column.

##### academicSessions

```sql
SELECT *
    FROM [EdFi_Ods_Populated_Template_Test].[oneroster12].[academicsessions]
    WHERE JSON_VALUE(metadata, '$.edfi.naturalKey.schoolId') = 255901107 AND
          JSON_VALUE(metadata, '$.edfi.naturalKey.sessionName') = '2021-2022 Spring Semester'
```

| sourcedId | status | dateLastModified | title | type | startDate | endDate | parent | schoolYear | metadata |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
|*UUID*|active|2025-09-09 15:15:47|Spring Semester|semester|2022-01-04|2022-05-27| *JSON reference* |2022| ```{"edfi":{"resource":"sessions","naturalKey":{"schoolId":255901107,"sessionName":"2021-2022 Spring Semester"}}}``` |

##### Session

```sql
SELECT *
    FROM [edfi].Session
    WHERE schoolId= 255901107 and
          sessionName = '2021-2022 Spring Semester'
```
| SchoolId | SchoolYear | SessionName | BeginDate | EndDate | TermDescriptorId | TotalInstructionalDays | Discriminator | CreateDate | LastModifiedDate | Id | ChangeVersion|
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
|255901107|2022|2021-2022 Spring Semester|2022-01-04|2022-05-27|564|88|*NULL*|2025-09-09 15:15:47|2025-09-09 15:15:47|*UUID*|12053|

From `academicSessions` we are interested in validating the following properties:

|OneRoster (`oneroster12`)|DataStandard (`edfi`)|API validations|
|--|--|--|
|title|[termDescriptor](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/blob/main/sql/academic_sessions.sql#L114)|Validate against `ed-fi/termDescriptors`. It comes from the [termDescriptor code value](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/blob/main/sql/academic_sessions.sql#L94)|
|type|[descriptorMappings](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/blob/main/sql/academic_sessions.sql#L116)|Validate against `ed-fi/descriptorMappings`. It comes from the [mappedtermdescriptor](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/blob/main/sql/academic_sessions.sql#L95)|
|startDate|[BeginDate](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/blob/main/sql/academic_sessions.sql#L96)|Validate against `ed-fi/sessions`. It comes from `edfi.sessions`.|
|endDate|EndDate|Validate against `ed-fi/sessions`. It comes from `edfi.sessions`.|
|schoolYear|SchoolYear|Validate against `ed-fi/sessions`. It comes from `edfi.sessions`.|

> As shown above, each case is different and must be reviewed in the corresponding SQL script to understand how the data is populated.

#### Steps to validate each scenario

The following are the pseudo steps to consider for validating each endpoint, we'll continue with the *academicSessions* example:

1) Create a new Bruno folder for `academicSessions`
2) Create a new request to `GET` the __OneRoster__ `academic sessions` data and cache it.
3) Create a new request to `GET` the __DataStandard__ `sessions` data. Then, compare its values against OneRoster using [Assertions](https://docs.usebruno.com/testing/tests/assertions).
4) Create a new request to `GET` the __DataStandard__ `term descriptor` data. Then, compare it against OneRoster using [Assertions](https://docs.usebruno.com/testing/tests/assertions).
5) Create a new request to `GET` the __DataStandard__ `descriptor mapping` data. Then, compare it against OneRoster using [Assertions](https://docs.usebruno.com/testing/tests/assertions).

#### EdFi OneRoster Endpoints to validate

``` javascript
baseUrl = `http://localhost:3000` // PostgreSQL

GET {{baseUrl}}/ims/rostering/v1p2/academicSessions
GET {{baseUrl}}/ims/rostering/v1p2/gradingPeriods
GET {{baseUrl}}/ims/rostering/v1p2/terms
GET {{baseUrl}}/ims/rostering/v1p2/classes
GET {{baseUrl}}/ims/rostering/v1p2/courses
GET {{baseUrl}}/ims/rostering/v1p2/demographics
GET {{baseUrl}}/ims/rostering/v1p2/enrollments
GET {{baseUrl}}/ims/rostering/v1p2/orgs
GET {{baseUrl}}/ims/rostering/v1p2/schools
GET {{baseUrl}}/ims/rostering/v1p2/users
GET {{baseUrl}}/ims/rostering/v1p2/students
GET {{baseUrl}}/ims/rostering/v1p2/teachers
```

#### General requirements

The following items are needed to create a base where to start coding the validation items

* Create a Bruno collection:
    1) Create a [Collection environment](https://docs.usebruno.com/variables/collection-variables) and its `.env` file ([secrets manager](https://docs.usebruno.com/secrets-management/dotenv-file))
    2) Configure [Bearer authentication](https://docs.usebruno.com/auth/bearer) at Collection level. Use the [certification auth](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/bruno/SIS/collection.bru) implementation as a reference if needed.
* Create the automation workflow:
    1) Create a basic automation GitHub Actions workflow to run all Bruno requests sequentially using Docker postgreSQL, DataStandard, and OneRoster API containers. It should report a summary of assertions passed/failed. Use [certification tests automation script](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/scripts/run-scenarios.cjs#L299) as a reference if needed, but expect differences.

#### Validation requirements

The following are the requirements to validate each of the __EdFi OneRoster__ API endpoints.

> Due to both SQL Server and PostgresSQL scripts should return the exact same results, In this preliminary phase, only PostgresSQL is going to be evaluted.

##### academicSessions

1) Create a new Bruno folder for `academicSessions`
2) Create a new request to `GET` the __OneRoster__ `academic sessions` data from `{{baseUrl}}/ims/rostering/v1p2/academicSessions`. Then, select a random item from the list results and cache it. 
3) Extract from the `metadata` property the query parameters for DataStandar APIs and cache it.
4) Create a new request to `GET` the __DataStandard__ `sessions` data from `{{baseUrl}}/ed-fi/sessions` using the parameters from `metadata` (step 3). Then, cache its value and compare the `BeginDate`, `EndDate`, and `SchoolYear` are the same as the results from `academicSessions`.
5) Create a new request to `GET` the __DataStandard__ `term descriptor` data from `{{baseUrl}}/ed-fi/termDescriptors` using the `title` as a parameter (step 2). Then, check it exists and it's the same as the results from `academicSessions`.

### Database layer

The database approach was considered. Even though it is simpler, this is not the recommended option because it only validates data at the database level instead of the whole application flow; bugs in higher layers could be missed.

| Pros                                                  | Cons                                  |
| ----------------------------------------------------- | ------------------------------------- |
| Simpler implementation (direct database comparison)   | Won't test the whole data flow       |
| Can execute single-tenant comparisons easily          |                                       |
| One single language (PostgreSQL)                      |                                       |
| No data caching management needed                     |                                       |
| Code reviews could be cumbersome                      |                                       |

#### Steps to validate each scenario (database layer)

The following are the pseudo steps to consider for validating each script, we'll continue with the *academicSessions* example:

1) Create a new script for validating `academicSessions`
2) Filter `WHERE` `edfi`.`sessions` using the parameters extracted from `metadata` and ensure the rows match.
3) Verify `WHERE` `edfi`.`descriptors` matches the `title` column.
4) Verify `WHERE` `edfi`.`descriptorMappings` matches the `type` column.
5) If the checks yield a consistent result (`count = 1`), the test is successful and the data is in sync.

#### General requirements (database layer)

* Create the automation workflow:
    1) Create a basic automation GitHub Actions workflow to run all validation scripts using Docker PostgreSQL. It should report a summary of successful tests.

#### Validation requirements (database layer)

The following are the requirements to validate each of the __EdFi OneRoster__ API endpoints.

> Due to both SQL Server and PostgresSQL scripts should return the exact same results, In this preliminary phase, only PostgresSQL is going to be evaluted.

##### academicSessions (database layer)

1) Create a new script for validating `academicSessions`
2) Create a query to `SELECT` a random `id` from the `oneroster12`.`academic sessions`.
3) Create a query to `SELECT` the data from `oneroster12`.`academic sessions` using the proposed `id`.
4) In the same query filter the results `WHERE` `edfi`.`sessions` is the same using the `metadata` parameters.
5) In the same query filter the results `WHERE` `edfi`.`descriptors` is the same as the `title` column.
6) In the same query filter the results `WHERE` `edfi`.`descriptorMappings` is the same as the `type` column.
7) If you get a consistent result (`count = 1`), the test is successful and everything is in sync.

---

## Next steps / Tickets

Below are suggested tickets to capture the next work items from this spike. Each ticket includes a short description and proposed acceptance criteria.

* __Ticket 1 — Create Bruno collection and environment__: Create a Bruno collection for OneRoster validations and add a collection `.env` for secrets. Acceptance: Bruno collection exists in the repo (or as an exported file) and an example `.env.example` is added with placeholders for required variables.
* __Ticket 2 — Implement academicSessions Bruno tests__: Implement the Bruno folder and requests described in the spike: cache OneRoster academicSessions, request corresponding DataStandard `sessions`, `termDescriptors`, and `descriptorMappings`, and add assertions. Acceptance: Bruno automation runs locally and in CI for `academicSessions` and reports pass/fail assertions.
* __Ticket 3 — CI workflow for Bruno tests__: Add a GitHub Actions workflow that starts Docker containers (PostgreSQL, DataStandard, OneRoster API) and runs Bruno tests, producing a summary of assertions. Acceptance: Workflow runs on push and reports test results in the Actions UI.
* __Ticket 4 — Database-layer validation scripts (optional)__: Implement PostgreSQL scripts that validate materialized view rows against EdFi tables for one or two endpoints to serve as fast smoke checks. Acceptance: Scripts run against the PostgreSQL instance and return `count = 1` for matched rows for tested records.
* __Ticket 5 — Documentation & runbook__: Add a short README showing how to run Bruno tests locally and in CI, and how to interpret results. Acceptance: README added with example commands and environment setup.
