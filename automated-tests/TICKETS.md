# Next Steps / Tickets

This file enumerates actionable tickets derived from the spike and SQL view implementations. Each ticket includes a short description and acceptance criteria. Use these as GitHub issue bodies.

## Foundation

- Ticket: Bruno Collection & Environment
  - Description: Create a Bruno collection for OneRoster validations and add a collection `.env` for secrets; configure bearer auth at collection level.
  - Acceptance:
    - Bruno collection exists (checked into repo or export attached).
    - `.env.example` includes all required variables (base URLs, tokens).
    - Collection-level bearer auth configured and reusable by requests.

- Ticket: CI Workflow (Bruno)
  - Description: Add a GitHub Actions workflow that starts Docker containers (PostgreSQL, DataStandard, OneRoster API) and runs Bruno tests.
  - Acceptance:
    - Workflow runs on push and PR.
    - Starts required services, runs Bruno CLI, and publishes a summary of assertions.

- Ticket: Test Data & Secrets
  - Description: Document/manage sandbox credentials and test data needed for DataStandard and OneRoster.
  - Acceptance:
    - Secrets stored in GitHub Actions and referenced in workflow.
    - README notes for local runs with placeholder values.

## API-Layer Validation (PostgreSQL first)

- Ticket: academicSessions API Tests
  - Description: Implement Bruno folder for `academicSessions`.
  - Acceptance:
    - GET OneRoster `academicSessions`, cache one record.
    - Extract `metadata.edfi.naturalKey` (`schoolId`, `sessionName`).
    - GET DataStandard `sessions` and assert `BeginDate`, `EndDate`, `SchoolYear` match OneRoster.
    - GET DataStandard `termDescriptors` and assert OneRoster `title` corresponds to descriptor code value.
    - GET DataStandard `descriptorMappings` and assert OneRoster `type` corresponds to mapped term descriptor.

- Ticket: classes API Tests
  - Description: Implement Bruno tests for `classes` validating mapping to Ed-Fi `section`, `courseOffering`, and `orgs`.
  - Acceptance:
    - GET OneRoster `classes`, cache one record.
    - Parse `metadata.edfi.naturalKey` (localCourseCode, schoolId, sectionIdentifier, sessionName).
    - GET Ed-Fi `sections` and assert `dateLastModified`, `classCode` (localCourseCode), `location` (locationClassroomIdentificationCode), `terms` link to academicSession (constructed from schoolId + sessionName) are consistent.
    - GET Ed-Fi `courseOfferings` using section natural keys and assert `course` link constructed from `educationOrganizationId` + `courseCode` matches.
    - Assert `school` link sourcedId is md5(schoolId) and type `org`.

- Ticket: courses API Tests
  - Description: Validate OneRoster `courses` against Ed-Fi `course` and derived LEA.
  - Acceptance:
    - GET OneRoster `courses`, cache one record.
    - Using `metadata.edfi.naturalKey` (localEducationAgencyId, courseCode), GET Ed-Fi `courses` and assert `title` and `courseCode`.
    - Assert `schoolYear` link sourcedId is md5(schoolYear) and `org` link sourcedId is md5(localEducationAgencyId).

- Ticket: demographics API Tests
  - Description: Validate OneRoster `demographics` against Ed-Fi `student` and descriptor mappings.
  - Acceptance:
    - GET OneRoster `demographics`, cache one record.
    - Using `metadata.edfi.naturalKey.studentUniqueId`, GET Ed-Fi `students`.
    - Assert `birthDate`, `sex` mapped via `SexDescriptor` mapping to OneRoster value.
    - Assert race booleans reflect presence in mapped `RaceDescriptor` array.
    - Assert `hispanicOrLatinoEthnicity` reflects Ed-Fi student edorg associations.

- Ticket: orgs API Tests
  - Description: Validate OneRoster `orgs` for `school`, `district`, `state` types.
  - Acceptance:
    - GET OneRoster `orgs`, sample records of each type.
    - For `school`: assert `name` from `educationOrganization`, parent `district` link exists when LEA present.
    - For `district`: assert children include related schools; parent `state` link exists when SEA present.
    - For `state`: assert children include related districts.
    - Validate `metadata.edfi.resource` and natural keys per type.

- Ticket: users API Tests (students)
  - Description: Validate OneRoster `users` (student subset).
  - Acceptance:
    - GET OneRoster `users?role=student`, cache one record.
    - Assert `sourcedId` = md5(`STU-` + studentUniqueId) in PostgreSQL build.
    - Validate roles/org relationships align with school associations.
    - Validate email presence/format if provided; ensure mapping respects do-not-publish indicators.

- Ticket: users API Tests (staff)
  - Description: Validate OneRoster `users` (staff subset) including role selection logic.
  - Acceptance:
    - GET OneRoster `users?role=teacher` and `users?role=administrator` (as available), cache records.
    - Validate single-role selection (prefer admin over teacher when multiple).
    - Validate org roles built from staff-school associations and teaching assignments.

- Ticket: users API Tests (parents)
  - Description: Validate OneRoster `users` (parents subset) for basic fields and associations.
  - Acceptance:
    - GET OneRoster `users?role=parent`, cache one record.
    - Validate association to student(s), email selection rules, and `sourcedId` format.

## Database-Layer Validation Scripts (Optional, PostgreSQL)

- Ticket: academicSessions DB Script
  - Description: Create SQL script to validate view rows against Ed-Fi tables as per spike.
  - Acceptance:
    - Randomly select OneRoster view record.
    - Verify Ed-Fi `sessions`, `descriptors`, and `descriptorMappings` match respective OneRoster fields.
    - Returns `count = 1` on success.

- Ticket: classes DB Script
  - Description: Validate `oneroster12.classes` against Ed-Fi `section` and `courseOffering`.
  - Acceptance:
    - Query by `metadata.naturalKey`.
    - Assert title, classCode, location, course and school links are consistent.

- Ticket: courses DB Script
  - Description: Validate `oneroster12.courses` against Ed-Fi `course`.
  - Acceptance:
    - Query by `metadata.naturalKey`.
    - Assert title, courseCode, org link and schoolYear link consistency.

- Ticket: demographics DB Script
  - Description: Validate `oneroster12.demographics` against Ed-Fi `student` and descriptor mappings.
  - Acceptance:
    - Query by `metadata.naturalKey.studentUniqueId`.
    - Assert birthDate, sex, race flags, hispanic indicator consistency.

- Ticket: orgs DB Script
  - Description: Validate `oneroster12.orgs` hierarchy against Ed-Fi organizations.
  - Acceptance:
    - Sample each type; assert parent/children relationships and names.

- Ticket: users DB Script
  - Description: Validate `oneroster12.users` subsets for students/staff/parents.
  - Acceptance:
    - Query by `sourcedId`; assert role selection, org relationships, and metadata keys.

## Additional

- Ticket: Endpoint Coverage Expansion
  - Description: Create Bruno tests for remaining OneRoster endpoints (gradingPeriods, terms, enrollments, schools, students, teachers) following the same pattern.
  - Acceptance:
    - Each endpoint has a Bruno folder with cached OneRoster response and assertions against appropriate Ed-Fi resources.

- Ticket: Reporting & Trends
  - Description: Add a simple report artifact in CI summarizing assertion counts per endpoint and historical trends.
  - Acceptance:
    - CI uploads JSON/HTML summary; past runs are viewable.
