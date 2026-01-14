# Executive summary

This document summarizes the investigation findings for the current OneRoster implementation and recommends an approach for adding automated tests to ensure data integrity and consistency. The **recommended** path is API-level end-to-end testing using Bruno, with database-layer scripts as an **optional** simpler alternative for focused checks.

## Supporting Multiple DataStandards and Database Engines

The **OneRoster API** implementation can be configured to use different **ODS database** versions and either SQL Server or PostgreSQL as the backend _provider_.

**Automated validation must:**

- Support both PostgreSQL and SQL Server deployments.
- Validate against the correct **ODS database** version/schema in use.
- Ensure that tests are parameterized for both database types and schema differences.

This ensures that data integrity is maintained regardless of the underlying database or DataStandard version.

## Recommended Testing Approach

- **API Layer (Preferred):**
  - Use Bruno to create end-to-end tests that compare **OneRoster API** responses with **ODS API** responses.
  - Validate that synthesized data in **OneRoster API** matches the source data in **ODS API**, for both SQL Server and PostgreSQL backends.
  - Parameterize environment variables (e.g., base URLs, schema names) to
    support different DataStandard versions and database types.
  - Use collection-level environment variables and bearer authentication for
    secrets management.
  - Automate tests in CI using GitHub Actions, running all required containers
    (PostgreSQL, SQL Server, ODS API, OneRoster API) and
    publishing assertion summaries.

The following define the state of the art of the current **OneRoster API** implementation and provide next steps, considerations, and recommendations for adding automated tests to ensure data integrity and consistency.

## Context

**OneRoster API** is straightforward and it does not handle business logic itself. The business logic is implemented in database artifacts — materialized views (PostgreSQL) and tables (MSSQL). Periodic scripts (Cron Jobs) update those views and tables: they extract and synthesize data from the **ODS database** and transform it into a simpler format the OneRoster ecosystem consumes. The OneRoster API then reads that processed data; a parameter controls whether it reads from PostgreSQL or MSSQL.

**DataStandard Versions**: Both **OneRoster API** and **ODS API** support two DataStandard versions:

- **DataStandard 4.x (DS4)**: Legacy version for backward compatibility
- **DataStandard 5.x (DS5)**: Current version with latest schema improvements

Each DataStandard version can use either PostgreSQL or MSSQL as the database backend. The **OneRoster API** must correctly transform data from both versions, ensuring consistency across all combinations.

> This investigation explored whether to implement automation at the database level (using scripts) or at the API level (using an API tester such as Bruno). The implications of each approach are described in the next sections.

**Critical Requirement**: Each **OneRoster API** endpoint must correctly transform data from both DataStandard _versions_ and ODS _providers_, which may have schema differences, field mappings, and descriptor variations. The validation strategy includes:

- **DS4 Testing**: OneRoster API (DS4) vs ODS API (DS4) (both PostgreSQL and MSSQL)
- **DS5 Testing**:  OneRoster API (DS5) vs ODS API (DS5) (both PostgreSQL and MSSQL)
- **Database Parity**: Verify PostgreSQL and MSSQL backends produce identical results within each DataStandard version

## Automation Testing

Next you will find the considerations and recommendations for implementing automated testing in the different layers of the application (API layer and database layer).

### How to infer what should be tested?

Since **OneRoster API** endpoints synthesize data from different sources, each endpoint should be validated against its counterpart in the **ODS API**.

The synthesized data is stored under the `oneroster12` schema, and the original data resides under the `edfi` schema, both in the **ODS database**.

Therefore, when evaluating the [academicSessions](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L12) (PostgreSQL script), consider which `edfi` tables supply the data that populate `oneroster12`.`academicSessions` records.

```sql
create materialized view if not exists oneroster12.academicsessions as
with sessions as (
    select ses.*, sch.localEducationAgencyid
    from edfi.session ses
        join edfi.school sch
            on ses.schoolid = sch.schoolid
),
```

The `oneroster12`.`academicSessions` view data is being originated from the `edfi`.`Session` table, and then other tables are being used to format the retrieved data (check the link above for more details).

Now take a look to the results from `oneroster12`.`academicSessions` view and `edfi`.`Session` table for the same record:

Record from `oneroster12`.`academicSessions`:

```sql
SELECT *
    FROM [EdFi_Ods_Populated_Template_Test].[oneroster12].[academicsessions]
    WHERE JSON_VALUE(metadata, '$.edfi.naturalKey.schoolId') = 255901107 AND
          JSON_VALUE(metadata, '$.edfi.naturalKey.sessionName') = '2021-2022 Spring Semester'
```

| sourcedId | status | dateLastModified | title | type | startDate | endDate | parent | schoolYear | metadata |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| _UUID_ | active | 2025-09-09 15:15:47 | Spring Semester | semester | 2022-01-04 | 2022-05-27 | _JSON reference_ | 2022 | ```{"edfi":{"resource":"sessions","naturalKey":{"schoolId":255901107,"sessionName":"2021-2022 Spring Semester"}}}``` |

Record from `edfi`.`Session`:

```sql
SELECT *
    FROM [edfi].Session
    WHERE schoolId= 255901107 and
          sessionName = '2021-2022 Spring Semester'
```

| SchoolId | SchoolYear | SessionName | BeginDate | EndDate | TermDescriptorId | TotalInstructionalDays | Discriminator | CreateDate | LastModifiedDate | Id | ChangeVersion |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| 255901107 | 2022 | 2021-2022 Spring Semester | 2022-01-04 | 2022-05-27 | 564 | 88 | _NULL_ | 2025-09-09 15:15:47 | 2025-09-09 15:15:47 | _UUID_ | 12053 |

> The `metadata` column in the `oneroster12`.`academicSessions` stores the _primary key_ (also known as _natural key_) used to get the data, in this scenario, `schoolId` and `sessionName` values were extracted from `edfi`.`Session` _primary key_.

As a result of the investigation, we are interested in validating the columns that match each other; some columns values are extracted directly from `edfi`.`Session`, and others are formated using other tables to get their descriptions.

For example, the _termDescriptorId_ column in `edfi`.`Session` is used to get the _codeValue_ from `edfi`.`termDescriptors` and then returned as the _title_ column for `oneroster12`.`academicSessions`.

#### Database comparisons and validations

|OneRoster (`oneroster12`)|ODS (`edfi`)|Considerations|
|--|--|--|
|title|[codeValue](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L94)|Validate `title` against `codeValue`. Using the `termDescriptorId` as filter for the [edfi.descriptors](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L114) table|
|type|[mappedValue](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L95)|Validate `type` against `mappedValue`. Filtering the [descriptormapping](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L116) table by the `termDescriptor` values|
|startDate|[BeginDate](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L96)|Validate `startDate` against `BeginDate` from `ed-fi`.`sessions`.|
|endDate|[EndDate](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L97)|Validate `endDate` against `EndDate` from `ed-fi`.`sessions`|
|schoolYear|[SchoolYear](../../standard/5.2.0/artifacts/pgsql/core/academic_sessions.sql#L103)|Validate `schoolYear` against `SchoolYear` from `ed-fi`.`sessions`|

Now, let's review the actual API responses from **OneRoster API** and **ODS API** for _academicSessions_ and _sessions_ respectively.

**Record from OneRoster API _academicSessions_ (/ims/oneroster/rostering/v1p2/academicSessions):**

``` json
{
   "sourcedId": "0243cfa25025105e72437e7a972d057c",
   "status": "active",
   "dateLastModified": "2025-09-09T15:13:32.387Z",
   "title": "Spring Semester",
   "type": "semester",
   "startDate": "2022-01-04",
   "endDate": "2022-05-27",
   "parent": {
      ...
   },
   "schoolYear": "2022",
   "metadata": {
      "edfi": {
         "resource": "sessions",
         "naturalKey": {
            "schoolId": 255901107,
            "sessionName": "2021-2022 Spring Semester"
         }
      }
   }
},
```

**Record from ODs API _sessions_ (/ed-fi/sessions):**

``` json
{
   "id": "aaded431629041cbbf669bf618f19c4c",
   "schoolReference": {
      "schoolId": 255901107,
       ...
   },
   "schoolYearTypeReference": {
      "schoolYear": 2022,
       ...
   },
   "sessionName": "2021-2022 Spring Semester",
   "beginDate": "2022-01-04",
   "endDate": "2022-05-27",
   "termDescriptor": "uri://ed-fi.org/TermDescriptor#Spring Semester",
   "totalInstructionalDays": 88,
   "academicWeeks": [],
   "gradingPeriods": [
      ...
   ]
}
```

In this example, the **ODS API** included a property called _termDescriptor_ that, as per the previous review, corresponds to the _title property_ returned by the **OneRoster API** and should be compared properly to validate that they are the same (but with a different format).

#### API comparison and validations

|OneRoster API|ODS API|Considerations|
|--|--|--|
|[title](./oneroster-automated-testing.md#L128)|[termDescriptor](./oneroster-automated-testing.md#L164)|Different format|
|[type](./oneroster-automated-testing.md#L129)|_N/A_|Since it is not part of _sessions_ response, the `termDescriptor` from _sessions_ must be validated against `ed-fi/descriptorMappings` and assure it is same as `type`.|
|[startDate](./oneroster-automated-testing.md#L130)|[BeginDate](./oneroster-automated-testing.md#L162)|Same value.|
|[endDate](./oneroster-automated-testing.md#L131)|[endDate](./oneroster-automated-testing.md#L163)|Same value.|
|[schoolYear](./oneroster-automated-testing.md#L135)|[schoolYear](./oneroster-automated-testing.md#L158)|Same value, different types.|

> As shown above, each case is different and must be reviewed in the corresponding SQL scripts to understand how the data is populated and related.

### API layer

This is the **recommended** approach since it will perform a holistic validation, ensuring integrity and data consistency as experienced by an end user. It will use [Bruno](https://www.usebruno.com/) (preferred option) to implement E2E tests. The tests will compare the final results from **OneRoster API** and **ODS API**.

| Pros                                              | Cons                                  |
| ------------------------------------------------- | ------------------------------------- |
| End to End testing (full application validation)  | More complex implementation           |
| Comparison between different database engines     | Will require sandbox credentials      |
| One single language (JavaScript scripts)          | Complex data caching for comparisons  |
| Bruno Reports                                     |                                       |
| Bruno CLI features for CI implementation          |                                       |
| Easier code reviews                               |                                       |

#### Steps to validate each scenario

The following are the pseudo steps to consider for validating each endpoint, we'll continue with the *academicSessions* example:

1) Create a new Bruno folder for `academicSessions`
2) Create a new request to `GET` the **OneRoster API** `academicSessions` data and cache it.
3) Create a new request to `GET` the **ODS API** `sessions` data. Then, compare its values against the OneRoster response using [Assertions](https://docs.usebruno.com/testing/tests/assertions).
4) Create a new request to `GET` the **ODS** `term descriptor` data and cache it.
5) Create a new request to `GET` the **ODS** `descriptor mapping` data. Then, compare it against the OneRoster response using [Assertions](https://docs.usebruno.com/testing/tests/assertions).

#### OneRoster Endpoints to validate

``` javascript
GET {{baseUrl}} /ims/rostering/v1p2/academicSessions
GET {{baseUrl}} /ims/rostering/v1p2/gradingPeriods
GET {{baseUrl}} /ims/rostering/v1p2/terms
GET {{baseUrl}} /ims/rostering/v1p2/classes
GET {{baseUrl}} /ims/rostering/v1p2/courses
GET {{baseUrl}} /ims/rostering/v1p2/demographics
GET {{baseUrl}} /ims/rostering/v1p2/enrollments
GET {{baseUrl}} /ims/rostering/v1p2/orgs
GET {{baseUrl}} /ims/rostering/v1p2/schools
GET {{baseUrl}} /ims/rostering/v1p2/users
GET {{baseUrl}} /ims/rostering/v1p2/students
GET {{baseUrl}} /ims/rostering/v1p2/teachers
```

## Investigation Results

### Endpoint Mappings Discovery

Through analysis of the OneRoster controller (`src/controllers/unified/oneRosterController.js`), the following endpoint mappings were identified:

| OneRoster Endpoint | Underlying Table/View | Filter Applied | Ed-Fi Source Resources |
| -------------------- | ---------------------- | ---------------- | ------------------------ |
| `/academicSessions` | `oneroster12.academicsessions` | None | `edfi.session`, `edfi.descriptor`, `edfi.descriptorMapping`, `edfi.calendarDate` |
| `/gradingPeriods` | `oneroster12.academicsessions` | `type='gradingPeriod'` | Same as academicSessions |
| `/terms` | `oneroster12.academicsessions` | `type='term'` | Same as academicSessions |
| `/classes` | `oneroster12.classes` | None | `edfi.section`, `edfi.courseOffering`, `edfi.sectionClassPeriod` |
| `/courses` | `oneroster12.courses` | None | `edfi.course`, `edfi.courseOffering` |
| `/demographics` | `oneroster12.demographics` | None | `edfi.student`, `edfi.studentEducationOrganizationAssociation`, `edfi.studentEducationOrganizationAssociationRace`, `edfi.descriptor` |
| `/enrollments` | `oneroster12.enrollments` | None | `edfi.staffSectionAssociation`, `edfi.studentSectionAssociation`, `edfi.staff`, `edfi.student`, `edfi.section` |
| `/orgs` | `oneroster12.orgs` | None | `edfi.school`, `edfi.localEducationAgency`, `edfi.stateEducationAgency`, `edfi.educationOrganization` |
| `/schools` | `oneroster12.orgs` | `type='school'` | Same as orgs |
| `/users` | `oneroster12.users` | None | `edfi.student`, `edfi.staff`, `edfi.studentSchoolAssociation`, `edfi.staffSchoolAssociation`, various identification and classification tables |
| `/students` | `oneroster12.users` | `role='student'` | Same as users |
| `/teachers` | `oneroster12.users` | `role='teacher'` | Same as users |

### Key Findings

1. **Filtered Endpoints**: Six **OneRoster API** endpoints (`gradingPeriods`, `terms`, `schools`, `students`, `teachers`) are filtered views of three base tables (`academicsessions`, `orgs`, `users`). The controller applies WHERE clauses at query time.

2. **DataStandard Version Support**: The **OneRoster API** must support both DataStandard 4.x (DS4) and 5.x (DS5). Each version may have schema differences, field mappings, and descriptor variations that must be validated independently. All validation tests must be executed against both DS4 and DS5 instances.

3. **Database Backend Support**: Each DataStandard version supports both PostgreSQL and MSSQL backends. While the API abstracts database differences, validation should ensure consistency across:
   - **DS4 + PostgreSQL**
   - **DS4 + MSSQL**
   - **DS5 + PostgreSQL**
   - **DS5 + MSSQL**

4. **Metadata Natural Keys**: Each OneRoster record includes a `metadata` JSON object containing Ed-Fi resource information and natural keys required to query the corresponding **ODS API** endpoints. This metadata is essential for validation testing.

5. **Descriptor Mappings**: Several OneRoster fields are populated through Ed-Fi descriptors that are mapped to OneRoster vocabulary via the `edfi.descriptorMapping` table with OneRoster-specific `mappedNamespace` values (e.g., `uri://1edtech.org/oneroster12/TermDescriptor`).

6. **Complex Aggregations**: Some endpoints aggregate data from multiple Ed-Fi tables:
   - `classes` combines sections, courseOfferings, and class periods
   - `enrollments` unions staff and student section associations
   - `orgs` unions schools, LEAs, and SEAs
   - `users` unions students and staff with different role classifications
   - `demographics` aggregates student data with race descriptors and associations

7. **ODS API Endpoints**: The following **ODS API** endpoints are required for validation (available in both DS4 and DS5 versions):
   - `/ed-fi/sessions`
   - `/ed-fi/descriptors/{id}`
   - `/ed-fi/descriptorMappings`
   - `/ed-fi/termDescriptors`
   - `/ed-fi/sections`
   - `/ed-fi/courseOfferings`
   - `/ed-fi/courses`
   - `/ed-fi/students`
   - `/ed-fi/studentEducationOrganizationAssociations`
   - `/ed-fi/studentEducationOrganizationAssociationRaces`
   - `/ed-fi/studentSchoolAssociations`
   - `/ed-fi/staffSectionAssociations`
   - `/ed-fi/studentSectionAssociations`
   - `/ed-fi/staff`
   - `/ed-fi/staffSchoolAssociations`
   - `/ed-fi/schools`
   - `/ed-fi/localEducationAgencies`
   - `/ed-fi/stateEducationAgencies`

### External Resources

- [Bruno Documentation](https://docs.usebruno.com/) - API testing tool documentation
- [Bruno CLI](https://docs.usebruno.com/bru-cli/overview) - Command-line interface for CI/CD integration
- [Bruno Assertions](https://docs.usebruno.com/testing/tests/assertions) - Test assertion syntax
- [Bruno Collections](https://docs.usebruno.com/bruno-basics/create-a-collection) - Collection structure and organization
- [ODS API v6.2 Documentation](https://edfi.atlassian.net/wiki/spaces/ODSAPIS3V62/overview) - Ed-Fi DataStandard 5.x API documentation
- [ODS API v5.3 Documentation](https://edfi.atlassian.net/wiki/spaces/ODSAPIS3V53/overview) - Ed-Fi DataStandard 4.x API documentation
- [Ed-Fi DataStandard 5.x](https://edfi.atlassian.net/wiki/spaces/EFDS5X/overview) - DataStandard 5.x specification
- [Ed-Fi DataStandard 4.x](https://edfi.atlassian.net/wiki/spaces/EFDS4X/overview) - DataStandard 4.x specification
- [Ed-Fi API Swagger Sandbox](https://api.ed-fi.org/v6.2/docs/) - Interactive API documentation (DS5)
- [OneRoster v1.2 Specification](https://www.imsglobal.org/spec/oneroster/v1p2) - OneRoster standard specification
- [deploy-dual.sh](../deploy-dual.sh) - Reference deployment script showing DS4 and DS5 container configuration

#### General requirements

The following items are needed to create a base where to start coding the validation items

- Create a Bruno collection:
    1) Create a [Collection environment](https://docs.usebruno.com/variables/collection-variables) and its `.env` file ([secrets manager](https://docs.usebruno.com/secrets-management/dotenv-file))
    2) Configure [Bearer authentication](https://docs.usebruno.com/auth/bearer) at Collection level. Use the [certification auth](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/bruno/SIS/collection.bru) implementation as a reference if needed.
    3) Set up environment variables for both DataStandard versions:
        - **OneRoster API URLs:**
          - `oneRosterBaseUrlDS5Postgres`: DS5 PostgreSQL instance (e.g., `http://localhost:3000`)
          - `oneRosterBaseUrlDS5MSSQL`: DS5 MSSQL instance (e.g., `http://localhost:3001`)
          - `oneRosterBaseUrlDS4Postgres`: DS4 PostgreSQL instance (port varies)
          - `oneRosterBaseUrlDS4MSSQL`: DS4 MSSQL instance (port varies)
        - **ODS API URLs:**
          - `edfiBaseUrlDS5`: ODS API DS5 endpoint (e.g., `https://api.ed-fi.org/v6.2/api`)
          - `edfiBaseUrlDS4`: ODS API DS4 endpoint (e.g., `https://api.ed-fi.org/v5.3/api`)
        - **Authentication:**
          - `edfiClientIdDS5`: OAuth client ID for Ed-Fi DS5 API
          - `edfiClientSecretDS5`: OAuth client secret for Ed-Fi DS5 API
          - `edfiClientIdDS4`: OAuth client ID for Ed-Fi DS4 API
          - `edfiClientSecretDS4`: OAuth client secret for Ed-Fi DS4 API
          - `oneRosterClientId`: OAuth client ID for OneRoster API (if authentication is enabled)
          - `oneRosterClientSecret`: OAuth client secret for OneRoster API (if authentication is enabled)
        - **Test Configuration:**
          - `dataStandardVersion`: Current test version (`DS4` or `DS5`)
          - `databaseBackend`: Current test backend (`PostgreSQL` or `MSSQL`)
- Create the automation workflow:
    1) Create a comprehensive GitHub Actions workflow to run all Bruno requests sequentially for both DataStandard versions using Docker containers:
        - **DS4 Instances**: PostgreSQL and MSSQL OneRoster APIs, DS4 ODS API
        - **DS5 Instances**: PostgreSQL and MSSQL OneRoster APIs, DS5 ODS API
    2) The workflow should execute the test matrix:
        - OneRoster DS4 (PostgreSQL) vs ODS DS4
        - OneRoster DS4 (MSSQL) vs ODS DS4
        - OneRoster DS4 (MSSQL) vs OneRoster DS4 (PostgreSQL)
        - OneRoster DS5 (PostgreSQL) vs ODS DS5
        - OneRoster DS5 (MSSQL) vs ODS DS5
        - OneRoster DS4 (MSSQL) vs OneRoster DS5 (PostgreSQL)
    3) Report a summary of assertions passed/failed for each DataStandard version and database backend combination
    4) Use [certification tests automation script](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/scripts/run-scenarios.cjs#L299) as a reference if needed, but expect differences
    5) Reference the [deploy-dual.sh](../deploy-dual.sh) script for container configuration examples

#### Validation requirements

The following are the requirements to validate each of the **OneRoster API** endpoints.

**Critical**: Each endpoint must be validated against **both DataStandard versions (DS4 and DS5)**. While PostgreSQL and MSSQL scripts should return identical results for the same DataStandard version, schema differences between DS4 and DS5 require separate validation:

- **DS4 Validation**: OneRoster data derived from DataStandard 4.x schema
- **DS5 Validation**: OneRoster data derived from DataStandard 5.x schema

Validation must ensure that the **OneRoster API** correctly handles schema differences, field mappings, and descriptor variations between DataStandard versions.

##### academicSessions

**Source Data**: `edfi.session`, `edfi.descriptor` (termDescriptor), `edfi.descriptorMapping`, `edfi.school`, `edfi.calendarDate`

**Metadata Natural Keys**: `schoolId`, `sessionName`, `schoolYear`

**DataStandard Versions**: Must validate against both DS4 and DS5. Execute the following steps for each version.

1) Create a new Bruno folder for `academicSessions` with subfolders for `DS4` and `DS5`
2) Create a new request to `GET` the **OneRoster** `academic sessions` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/academicSessions`. Then, select a random item from the list results where `type='term'` or `type='semester'` (not `schoolYear` or `gradingPeriod`) and cache it.
3) Extract from the `metadata` property the query parameters for ODS APIs and cache them:
   - `metadata.edfi.naturalKey.schoolId`
   - `metadata.edfi.naturalKey.sessionName`
4) Create a new request to `GET` the **ODS** `sessions` data from `{{edfiBaseUrl}}/ed-fi/sessions?schoolId={schoolId}&sessionName={sessionName}` using the parameters from `metadata` (step 3). Then, cache its value and assert:
   - `BeginDate` matches OneRoster `startDate`
   - `EndDate` matches OneRoster `endDate`
   - `SchoolYear` matches OneRoster `schoolYear`
5) Extract `TermDescriptorId` from the session response and create a new request to `GET` `{{edfiBaseUrl}}/ed-fi/descriptors/{termDescriptorId}`. Assert that the descriptor's `codeValue` matches the OneRoster `title`.
6) Using the descriptor `namespace` and `codeValue`, create a request to `GET` `{{edfiBaseUrl}}/ed-fi/descriptorMappings?namespace={namespace}&value={codeValue}` and filter for `mappedNamespace='uri://1edtech.org/oneroster12/TermDescriptor'`. Assert the `mappedValue` matches the OneRoster `type` field.

##### gradingPeriods

**Endpoint Mapping**: Filtered view of `academicSessions` where `type='gradingPeriod'`

**Source Data**: Same as `academicSessions`

**Note**: This endpoint filters `oneroster12.academicsessions` table with `type='gradingPeriod'`. GradingPeriods are derived from calendar dates with specific event descriptors.

1) Create a new Bruno folder for `gradingPeriods`
2) Create a new request to `GET` the **OneRoster** `grading periods` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/gradingPeriods`. Select a random item and cache it.
3) Verify that the `type` field is `'gradingPeriod'`
4) Follow the same validation steps as `academicSessions` above (steps 3-6)

##### terms

**Endpoint Mapping**: Filtered view of `academicSessions` where `type='term'`

**Source Data**: Same as `academicSessions`

**Note**: This endpoint filters `oneroster12.academicsessions` table with `type='term'`.

1) Create a new Bruno folder for `terms`
2) Create a new request to `GET` the **OneRoster** `terms` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/terms`. Select a random item and cache it.
3) Verify that the `type` field is `'term'`
4) Follow the same validation steps as `academicSessions` above (steps 3-6)

##### classes

**Source Data**: `edfi.section`, `edfi.courseOffering`, `edfi.school`, `edfi.sectionClassPeriod`

**Metadata Natural Keys**: `localCourseCode`, `schoolId`, `sectionIdentifier`, `sessionName`

1) Create a new Bruno folder for `classes`
2) Create a new request to `GET` the **OneRoster** `classes` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/classes`. Select a random item and cache it.
3) Extract metadata natural keys from `metadata.edfi.naturalKey`:
   - `localCourseCode`
   - `schoolId`
   - `sectionIdentifier`
   - `sessionName`
4) Create a new request to `GET` the **ODS** `sections` data from `{{edfiBaseUrl}}/ed-fi/sections?localCourseCode={localCourseCode}&schoolId={schoolId}&sectionIdentifier={sectionIdentifier}&sessionName={sessionName}`. Assert:
   - Section exists
   - `LocationClassroomIdentificationCode` matches OneRoster `location`
5) Extract `LocalCourseCode`, `SchoolId`, `SchoolYear`, and `SessionName` from the section response
6) Create a request to `GET` the **ODS** `courseOfferings` data from `{{edfiBaseUrl}}/ed-fi/courseOfferings?localCourseCode={localCourseCode}&schoolId={schoolId}&schoolYear={schoolYear}&sessionName={sessionName}`. Assert:
   - `LocalCourseTitle` matches OneRoster `title`
   - The course reference matches the OneRoster `course.sourcedId` pattern
7) Create a request to `GET` `{{edfiBaseUrl}}/ed-fi/sections/{sectionId}/sectionClassPeriods` to retrieve class periods. Assert that the returned `ClassPeriodName` values match the OneRoster `periods` array.
8) Verify the `school.sourcedId` in OneRoster matches the Ed-Fi `SchoolId` pattern
9) Verify the `terms` array in OneRoster references sessions that exist

##### courses

**Source Data**: `edfi.course`, `edfi.courseOffering`, `edfi.school`

**Metadata Natural Keys**: `localEducationAgencyId`, `courseCode`

1) Create a new Bruno folder for `courses`
2) Create a new request to `GET` the **OneRoster** `courses` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/courses`. Select a random item and cache it.
3) Extract metadata natural keys from `metadata.edfi.naturalKey`:
   - `localEducationAgencyId`
   - `courseCode`
4) Create a new request to `GET` the **ODS** `courses` data from `{{edfiBaseUrl}}/ed-fi/courses?educationOrganizationId={localEducationAgencyId}&courseCode={courseCode}`. Assert:
   - Course exists
   - `CourseTitle` matches OneRoster `title`
   - `CourseCode` matches OneRoster `courseCode`
5) Verify the `org.sourcedId` in OneRoster matches the Ed-Fi `LocalEducationAgencyId` pattern
6) Verify the `schoolYear.sourcedId` in OneRoster references a valid academic session

##### demographics

**Source Data**: `edfi.student`, `edfi.studentEducationOrganizationAssociation`, `edfi.studentEducationOrganizationAssociationRace`, `edfi.descriptor` (sex, race, country, state), `edfi.descriptorMapping`

**Metadata Natural Keys**: `studentUniqueId`

1) Create a new Bruno folder for `demographics`
2) Create a new request to `GET` the **OneRoster** `demographics` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/demographics`. Select a random item and cache it.
3) Extract `metadata.edfi.naturalKey.studentUniqueId`
4) Create a new request to `GET` the **ODS** `students` data from `{{edfiBaseUrl}}/ed-fi/students?studentUniqueId={studentUniqueId}`. Assert:
   - Student exists
   - `BirthDate` matches OneRoster `birthDate`
   - `BirthCity` matches OneRoster `cityOfBirth`
5) Extract `StudentUSI` from the student response
6) Create a request to `GET` `{{edfiBaseUrl}}/ed-fi/studentEducationOrganizationAssociations?studentUniqueId={studentUniqueId}` and retrieve the first association. Assert:
   - `HispanicLatinoEthnicity` boolean matches OneRoster `hispanicOrLatinoEthnicity` (convert boolean to "true"/"false" string)
7) From the association, extract `BirthSexDescriptorId` and get the descriptor from `{{edfiBaseUrl}}/ed-fi/descriptors/{descriptorId}`. Verify the `codeValue` mapped through `descriptorMappings` with `mappedNamespace='uri://1edtech.org/oneroster12/SexDescriptor'` matches OneRoster `sex`.
8) Create a request to `GET` `{{edfiBaseUrl}}/ed-fi/students/{studentId}/studentEducationOrganizationAssociationRaces` to retrieve race data. For each race descriptor, verify the mapped values match the OneRoster race boolean fields:
   - `americanIndianOrAlaskaNative`
   - `asian`
   - `blackOrAfricanAmerican`
   - `nativeHawaiianOrOtherPacificIslander`
   - `white`
   - `demographicRaceTwoOrMoreRaces` (true if multiple races)
9) Verify birth country and state descriptors if present

##### enrollments

**Source Data**: `edfi.staffSectionAssociation`, `edfi.studentSectionAssociation`, `edfi.staff`, `edfi.student`, `edfi.section`

**Metadata Natural Keys** (Staff): `staffUniqueId`, `localCourseCode`, `schoolId`, `sectionIdentifier`, `sessionName`, `beginDate`

**Metadata Natural Keys** (Student): `studentUniqueId`, `localCourseCode`, `schoolId`, `sectionIdentifier`, `sessionName`, `beginDate`

1) Create a new Bruno folder for `enrollments`
2) Create a new request to `GET` the **OneRoster** `enrollments` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/enrollments`. Select a random teacher enrollment (`role='teacher'`) and cache it.
3) Extract metadata natural keys from `metadata.edfi.naturalKey`:
   - `staffUniqueId` (for teacher enrollments)
   - `localCourseCode`
   - `schoolId`
   - `sectionIdentifier`
   - `sessionName`
   - `beginDate`
4) Create a new request to `GET` the **ODS** `staffSectionAssociations` data from `{{edfiBaseUrl}}/ed-fi/staffSectionAssociations?staffUniqueId={staffUniqueId}&localCourseCode={localCourseCode}&schoolId={schoolId}&sectionIdentifier={sectionIdentifier}&sessionName={sessionName}`. Assert:
   - Association exists
   - `BeginDate` matches OneRoster `beginDate`
   - `EndDate` matches OneRoster `endDate` (if present)
5) Verify the `class.sourcedId` references a valid section
6) Verify the `user.sourcedId` references a valid staff member
7) Verify the `school.sourcedId` references a valid school
8) Select a random student enrollment (`role='student'`) and repeat steps 3-7 using `studentSectionAssociations` endpoint with `studentUniqueId` instead

##### orgs

**Source Data**: `edfi.school`, `edfi.localEducationAgency`, `edfi.stateEducationAgency`, `edfi.educationOrganization`

**Metadata Natural Keys**:

- Schools: `schoolId`
- LEAs: `localEducationAgencyId`
- SEAs: `stateEducationAgencyId`

1) Create a new Bruno folder for `orgs`
2) Create a new request to `GET` the **OneRoster** `orgs` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/orgs`. Select a random school (`type='school'`) and cache it.
3) Extract `metadata.edfi.naturalKey.schoolId`
4) Create a new request to `GET` the **ODS** `schools` data from `{{edfiBaseUrl}}/ed-fi/schools?schoolId={schoolId}`. Assert:
   - School exists
   - `NameOfInstitution` matches OneRoster `name`
   - `SchoolId` matches OneRoster `identifier`
5) Verify the `parent.sourcedId` references the school's LEA if present
6) Select a random district (`type='district'`) and extract `metadata.edfi.naturalKey.localEducationAgencyId`
7) Create a request to `GET` `{{edfiBaseUrl}}/ed-fi/localEducationAgencies?localEducationAgencyId={localEducationAgencyId}`. Assert:
   - LEA exists
   - `NameOfInstitution` matches OneRoster `name`
   - `LocalEducationAgencyId` matches OneRoster `identifier`
8) Verify the `children` array references valid schools within the LEA
9) If a state org (`type='state'`) exists, verify it using `stateEducationAgencies` endpoint

##### schools

**Endpoint Mapping**: Filtered view of `orgs` where `type='school'`

**Source Data**: Same as `orgs`

**Note**: This endpoint filters `oneroster12.orgs` table with `type='school'`.

1) Create a new Bruno folder for `schools`
2) Create a new request to `GET` the **OneRoster** `schools` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/schools`. Select a random item and cache it.
3) Verify that the `type` field is `'school'`
4) Follow the same validation steps as `orgs` for school records (steps 3-5 above)

##### users

**Source Data**: `edfi.student`, `edfi.staff`, `edfi.studentSchoolAssociation`, `edfi.staffSchoolAssociation`, `edfi.studentEducationOrganizationAssociationElectronicMail`, `edfi.studentEducationOrganizationAssociationStudentIdentification`, `edfi.staffIdentificationCode`, `edfi.descriptor` (gradeLevel)

**Metadata Natural Keys**:

- Students: `studentUniqueId`
- Staff: `staffUniqueId`

1) Create a new Bruno folder for `users`
2) Create a new request to `GET` the **OneRoster** `users` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/users`. Select a random student user (`role='student'`) and cache it.
3) Extract `metadata.edfi.naturalKey.studentUniqueId`
4) Create a new request to `GET` the **ODS** `students` data from `{{edfiBaseUrl}}/ed-fi/students?studentUniqueId={studentUniqueId}`. Assert:
   - Student exists
   - `FirstName` matches OneRoster `givenName`
   - `LastSurname` matches OneRoster `familyName`
   - `MiddleName` matches OneRoster `middleName`
   - `PreferredFirstName` matches OneRoster `preferredFirstName`
   - `PreferredLastSurname` matches OneRoster `preferredLastName`
   - `StudentUniqueId` matches OneRoster `identifier`
5) Create a request to `GET` `{{edfiBaseUrl}}/ed-fi/studentEducationOrganizationAssociations?studentUniqueId={studentUniqueId}/electronicMails` to retrieve email. Assert the primary email matches OneRoster `email` and `username`.
6) Create a request to `GET` `{{edfiBaseUrl}}/ed-fi/studentSchoolAssociations?studentUniqueId={studentUniqueId}` to retrieve school associations. Assert:
   - The `roles` array in OneRoster contains corresponding org references
   - The primary school flag is correctly set
   - Grade levels match the OneRoster `grades` array
7) Retrieve `userIds` array and validate against `studentEducationOrganizationAssociationStudentIdentifications`
8) Select a random staff user (`role='teacher'` or `role='administrator'`) and repeat validation using:
   - `{{edfiBaseUrl}}/ed-fi/staff?staffUniqueId={staffUniqueId}`
   - `{{edfiBaseUrl}}/ed-fi/staffSchoolAssociations?staffUniqueId={staffUniqueId}`
   - `{{edfiBaseUrl}}/ed-fi/staffIdentificationCodes?staffUniqueId={staffUniqueId}`
   - Verify staff classification descriptors match the OneRoster `role` via descriptor mappings

##### students

**Endpoint Mapping**: Filtered view of `users` where `role='student'`

**Source Data**: Same as `users`

**Note**: This endpoint filters `oneroster12.users` table with `role='student'`.

1) Create a new Bruno folder for `students`
2) Create a new request to `GET` the **OneRoster** `students` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/students`. Select a random item and cache it.
3) Verify that the `role` field is `'student'`
4) Follow the same validation steps as `users` for student records (steps 3-7 above)

##### teachers

**Endpoint Mapping**: Filtered view of `users` where `role='teacher'`

**Source Data**: Same as `users`

**Note**: This endpoint filters `oneroster12.users` table with `role='teacher'`.

1) Create a new Bruno folder for `teachers`
2) Create a new request to `GET` the **OneRoster** `teachers` data from `{{oneRosterBaseUrl}}/ims/rostering/v1p2/teachers`. Select a random item and cache it.
3) Verify that the `role` field is `'teacher'`
4) Follow the same validation steps as `users` for staff/teacher records (step 8 above)

### Database layer

The database approach was considered. Even though it is simpler, this is not the recommended option because it only validates data at the database level instead of the whole application flow; bugs in higher layers could be missed.

| Pros                                                  | Cons                                  |
| ----------------------------------------------------- | ------------------------------------- |
| Simpler implementation (direct database comparison)   | Won't test the whole data flow        |
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

- Create the automation workflow:
    1) Create a basic automation GitHub Actions workflow to run all validation scripts using Docker PostgreSQL. It should report a summary of successful tests.

#### Validation requirements (database layer)

The following are the requirements to validate each of the **OneRoster** API endpoints.


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

### Foundation Tickets

- **Ticket 1 — Create Bruno collection and environment**: Create a Bruno collection for OneRoster validations and add a collection `.env` for secrets. Set up collection-level authentication and base URL variables for both OneRoster and Ed-Fi APIs. Acceptance: Bruno collection exists in the repo with proper folder structure, and an example `.env.example` file is added with placeholders for all required variables (oneRosterBaseUrl, edfiBaseUrl, OAuth credentials).

- **Ticket 2 — CI workflow for Bruno tests**: Add a GitHub Actions workflow that starts Docker containers for both DS4 and DS5 (PostgreSQL, MSSQL, ODS, OneRoster API) and runs Bruno tests using Bruno CLI with a test matrix covering all DataStandard and database combinations. The workflow should report a summary of assertions for each combination. Acceptance: Workflow runs on push/pull requests, properly initializes all containers (DS4 + DS5, PostgreSQL + MSSQL), executes Bruno collection with environment switching for each test matrix cell, and reports test results in the Actions UI with pass/fail counts broken down by DataStandard version and database backend.

- **Ticket 3 — Authentication helper**: Implement a Bruno pre-request script or collection-level script to handle OAuth 2.0 authentication for both OneRoster and Ed-Fi APIs, caching tokens and refreshing them as needed. Acceptance: All requests can authenticate successfully without manual token management, and token refresh is handled automatically when tokens expire.

### Core Endpoint Validation Tickets

- **Ticket 4 — Implement academicSessions validation**: Implement the Bruno folder and requests for `academicSessions` with separate test sets for DS4 and DS5: fetch OneRoster data, extract metadata natural keys, query Ed-Fi sessions/descriptors/descriptorMappings, and add assertions comparing dates, titles, and types. Acceptance: Bruno tests run successfully for academicSessions endpoint against both DS4 and DS5 instances with all assertions passing for at least 5 random samples per version. Tests must handle any schema differences between DS4 and DS5.

- **Ticket 5 — Implement classes validation**: Implement Bruno validation for `classes` endpoint for both DS4 and DS5: fetch OneRoster classes, query Ed-Fi sections/courseOfferings/sectionClassPeriods, validate title, location, periods, course references, school references, and terms. Acceptance: Bruno tests validate classes data against Ed-Fi sources with assertions for all mapped fields across both DataStandard versions.

- **Ticket 6 — Implement courses validation**: Implement Bruno validation for `courses` endpoint for both DS4 and DS5: fetch OneRoster courses, query Ed-Fi courses by LEA and courseCode, validate title, courseCode, org reference, and schoolYear reference. Acceptance: Bruno tests successfully validate course mappings with proper Ed-Fi course lookups for both DataStandard versions.

- **Ticket 7 — Implement demographics validation**: Implement Bruno validation for `demographics` endpoint for both DS4 and DS5: fetch OneRoster demographics, query Ed-Fi students/studentEducationOrganizationAssociations/race data, validate birth data, sex descriptor mappings, race boolean fields, and ethnicity. Handle any descriptor vocabulary differences between DS4 and DS5. Acceptance: Bruno tests validate all demographic fields including descriptor mappings for sex and race against Ed-Fi sources for both DataStandard versions.

- **Ticket 8 — Implement enrollments validation**: Implement Bruno validation for `enrollments` endpoint for both DS4 and DS5: fetch both staff and student enrollments, query Ed-Fi staffSectionAssociations/studentSectionAssociations, validate role, dates, class/user/school references for both teacher and student enrollments. Acceptance: Bruno tests validate both staff and student enrollment types with proper natural key extraction and association lookups across both DataStandard versions.

- **Ticket 9 — Implement orgs validation**: Implement Bruno validation for `orgs` endpoint for both DS4 and DS5: fetch OneRoster orgs (schools, districts, states), query Ed-Fi schools/localEducationAgencies/stateEducationAgencies, validate names, identifiers, types, parent/children relationships across all organization types. Acceptance: Bruno tests validate all three org types (school, district, state) with proper hierarchical relationship validation for both DataStandard versions.

- **Ticket 10 — Implement users validation**: Implement Bruno validation for `users` endpoint for both DS4 and DS5: fetch both student and staff users, query Ed-Fi students/staff/associations/identifications, validate names, identifiers, roles, email, school associations, grades, and userIds arrays for both user types. Handle any field differences between DS4 and DS5 schemas. Acceptance: Bruno tests validate both student and staff user records with comprehensive field mappings including nested arrays and associations across both DataStandard versions.

### Filtered Endpoint Validation Tickets

- **Ticket 11 — Implement gradingPeriods and terms validation**: Implement Bruno validation for filtered academic session endpoints (`gradingPeriods` with type='gradingPeriod', `terms` with type='term') for both DS4 and DS5, reusing academicSessions validation logic with filter verification. Acceptance: Bruno tests validate filtered endpoints return only correct types and data matches base academicSessions validation for both DataStandard versions.

- **Ticket 12 — Implement schools validation**: Implement Bruno validation for `schools` endpoint (filtered orgs where type='school') for both DS4 and DS5, reusing orgs validation logic with type filter verification. Acceptance: Bruno tests validate schools endpoint returns only school-type organizations and data matches base orgs validation for both DataStandard versions.

- **Ticket 13 — Implement students and teachers validation**: Implement Bruno validation for filtered user endpoints (`students` with role='student', `teachers` with role='teacher') for both DS4 and DS5, reusing users validation logic with role filter verification. Acceptance: Bruno tests validate filtered user endpoints return only correct roles and data matches base users validation for both DataStandard versions.

### Enhancement & Documentation Tickets (optional)

- **Ticket 14 — Random sampling strategy**: Implement a robust random sampling strategy in Bruno scripts to select diverse test records from large datasets, ensuring tests cover edge cases (records with/without optional fields, various descriptor values, etc.). Acceptance: Tests sample at least 1 random record per endpoint with criteria ensuring diverse coverage.

- **Ticket 15 — Error handling and reporting**: Enhance Bruno tests with detailed error messages that include the specific natural keys, expected vs actual values, and relevant context when assertions fail. Acceptance: Test failures include actionable error messages with natural keys and field-level comparison details.

- **Ticket 16 — Documentation & runbook**: Add a comprehensive README showing how to run Bruno tests locally and in CI, how to interpret results, how to add new validations, and troubleshooting guide for common issues. Include environment setup, Docker commands, and Bruno CLI usage. Acceptance: README added with complete setup instructions, examples, and team members can run tests successfully following the documentation.
