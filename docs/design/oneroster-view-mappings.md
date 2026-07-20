# OneRoster View Mappings

## Summary

The Ed-Fi → OneRoster transformation is implemented entirely in SQL artifacts, not in
application code. Artifacts are organized by Ed-Fi Data Standard version and database
engine:

```plaintext
standard/<version>/artifacts/<pgsql|mssql>/core/
  00_setup.sql              -- creates the `oneroster12` schema
  01_descriptors.sql        -- OneRoster descriptor definitions
  02_descriptorMappings.sql -- maps Ed-Fi descriptors -> OneRoster enumerations
  academic_sessions.sql, classes.sql, courses.sql, demographics.sql,
  enrollments.sql, orgs.sql, users.sql  -- one projection per OneRoster resource
```

Key mapping characteristics:

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
- **Refresh:** On PostgreSQL pg-boss can schedule refresh jobs when `PGBOSS_CRON`
  is configured (repository examples commonly use `*/15 * * * *`); on SQL Server
  a SQL Agent job invokes the master refresh script.

> [!TIP]
> The PostgreSQL files are the most readable expression of the logic (one
> `create materialized view` with CTEs per entity). MSSQL implements the _same_
> logic as physical tables populated by stored procedures (see [Engines &
> refresh](#engines--refresh)). When you change a mapping, change both engines
> and keep them in sync.

## Architecture overview

The Ed-Fi ODS is the system of record. This service never queries Ed-Fi tables at request time; instead a separate **`oneroster12`** schema holds one object per OneRoster entity, pre-shaped into the OneRoster 1.2 JSON structure. The API layer (`src/services/database/*QueryService.js`) issues simple `SELECT … WHERE … LIMIT` queries against these objects via knex.

```plaintext
edfi.* (ODS, system of record)
   │  SQL in standard/<version>/artifacts/<engine>/core/*.sql
   ▼
oneroster12.{academicsessions, classes, courses, demographics, enrollments, orgs, users}
   │  knex (filter / page / field-select / authorize)
   ▼
OneRoster 1.2 REST endpoints
```

There are **seven** stored objects. The remaining endpoints in the README are _subsets_ served from these same objects by adding a `WHERE` filter at the API layer (see [Subset endpoints](#subset-endpoints)).

## Cross-cutting conventions

These apply to every view; per-entity sections below only call out deviations.

- **`sourcedId` = `md5(<Ed-Fi natural key>)`.** Every entity's primary identifier is an MD5 hash of its Ed-Fi natural key (e.g. `md5(schoolId)` for a school). This makes IDs deterministic and stable across refreshes, and lets one view reference another (via `href`/`sourcedId`) by recomputing the hash rather than storing foreign keys. **Any change to a `sourcedId` formula must be mirrored everywhere that entity is referenced** — e.g. the class `sourcedId` formula appears in `classes`, `enrollments`, and the `terms` href.
- **Case-folding in keys.** Section-derived keys lowercase the free-text parts (`lower(localcoursecode)`, `lower(sectionidentifier)`, `lower(sessionname)`) so case variants of the same section collapse to one ID. Numeric keys (schoolId, schoolYear) are not folded.
- **`status` is hard-coded `'active'`** and `dateLastModified` comes from the source row's `lastmodifieddate` (sometimes `greatest()` of several joined rows).
- **`metadata.edfi`** carries provenance back to the ODS: the Ed-Fi `resource`, its `naturalKey`, and often `educationOrganizationId`. Consumers use this to trace a OneRoster record to its Ed-Fi origin.
- **References** between entities are emitted as `{ href, sourcedId, type }` JSON objects, where `href` is a relative API path and `sourcedId` is the recomputed MD5 of the target's key.
- **Authorization indexes.** Each object is indexed on `educationOrganizationId` (and `participantUSI` on `enrollments`/`users`, `studentUSI` on `demographics`). `AuthorizationQueryService` filters by these columns to restrict results to the ed-org IDs the caller's token permits.

### Descriptor mapping engine

Ed-Fi uses site-configurable _descriptors_ (e.g. `uri://ed-fi.org/TermDescriptor` value `Fall Semester`) where OneRoster expects fixed enums (e.g. `semester`). The translation is data-driven, not hard-coded in the views:

1. **`01_descriptors.sql`** inserts synthetic descriptors under `uri://1edtech.org/oneroster12/*` namespaces — one per OneRoster enum value (e.g. the `TermDescriptor` values `semester`, `term`, `gradingPeriod`, `schoolYear`).
2. **`02_descriptorMappings.sql`** inserts `edfi.descriptormapping` rows linking each Ed-Fi descriptor value to its OneRoster enum value.
3. Each view joins `edfi.descriptor → edfi.descriptormapping` filtered on `mappednamespace = 'uri://1edtech.org/oneroster12/<Type>'` and reads `mappedvalue`.

Mapped descriptor types: `CalendarEventDescriptor` (instructional-day TRUE/FALSE), `TermDescriptor` (session type), `RaceDescriptor`, `SexDescriptor`, `StaffClassificationDescriptor` (OneRoster role), `ClassroomPositionDescriptor` (primary-teacher TRUE/FALSE).

**To support site-specific descriptor values, add rows to `02_descriptorMappings.sql`** — no view change needed. Unmapped values produce `NULL` (several Ed-Fi staff classifications are intentionally left unmapped — see the commented `?` entries at the bottom of `02_descriptorMappings.sql`).

## Per-view mappings

### `academicsessions` ← `sessions`, `schools`, `schoolCalendars`

Two row types are `UNION ALL`-ed:

1. **Synthesized school-year rows** (`type='schoolYear'`). OneRoster treats a school year as one global session, but real-world calendars vary by school. The view computes instructional-day windows from `edfi.calendardate` joined to `calendardatecalendarevent`, keeping only days whose `CalendarEventDescriptor` maps to `TRUE`. Because schools within a district disagree on exact start/end, it groups by district (`localEducationAgencyId`) and takes the **modal** (`mode() within group`) first/last instructional day. `sourcedId = md5(localEducationAgencyId-schoolYear)`; `title = "{year-1}-{year}"`.
2. **Ed-Fi session rows** (`type` from `TermDescriptor` mapping → `term`/`semester`/`gradingPeriod`). `sourcedId = md5(schoolId-schoolYear-sessionName)`; `parent` points to the synthesized school-year session.

Nuance: `calendar_windows` uses `grouping sets` to compute both school-level and school+calendar-code windows; `summarize_school_year` keeps only the school-level aggregate (`calendarcode is null`).

### `classes` ← `sections`, `courseOfferings`, `schools`

One row per Ed-Fi `section`. `sourcedId = md5(lower(localCourseCode)-schoolId-schoolYear-lower(sectionIdentifier)-lower(sessionName))`. Joins `courseoffering` on the full natural key for the title and course reference; left-joins `sectionclassperiod` aggregated into a `periods` JSON array. `classType` is hard-coded `'scheduled'`; `grades`, `subjects`, `subjectCodes` are `NULL` (not derivable). Emits references to its `course`, `school` (org), and `terms` (academic session).

### `courses` ← `courses`, `courseOfferings`, `schools`

One row per Ed-Fi `course`. `sourcedId = md5(educationOrganizationId-courseCode)`. The `course_offerings` CTE collapses offerings to `max(schoolyear)` per `courseCode` so a course offered in multiple years still yields a single row. The `schoolYear` reference is built only when an offering exists, using `COALESCE(school.localEducationAgencyId, educationOrganizationId)` so the hash matches the `academicsessions` school-year key. `subjects`/`subjectCodes`/`grades` are `NULL` (SCED codes not generally available).

### `demographics` ← `students`, `studentSchoolAssociation`, `studentEducationOrganizationAssociation`

One row per `(student, school)`, mirroring the `users` view's school-scoped anchor: `sourcedId = md5('STU-'+studentUniqueId[-schoolId])`, where `schoolId` comes from `studentSchoolAssociation`. This is intentional and is what the OneRoster spec requires — every `demographics` `sourcedId` must match a `user` `sourcedId`, so demographics must use the exact same school-keyed formula, row-for-row, as the student rows in `users`. `student_school` (driven by `studentSchoolAssociation`) is the row driver, so the two views produce the identical set of student `sourcedId`s.

**Race/ethnicity is resolved per-*student*, not per-org.** Race and hispanic/latino data lives in `studentEducationOrganizationAssociation` / `studentEducationOrganizationAssociationRace`, which are education organization-scoped. But in Ed-Fi the `educationOrganizationId` on those records only reflects *where a district chose to record the data* (school, LEA, ESC, or SEA) — it is not a claim that a student's race differs by org. OneRoster's `demographics` object has no per-org dimension: race/ethnicity/sex/birth are properties of the person. So the view computes **one canonical demographic set per `studentUSI`**, aggregating across *all* of that student's SEOA records regardless of org level (`student_edorg`/`student_race` group by `studentUSI` alone), and joins it onto each `(student, school)` row by `studentUSI`. The same values are therefore replicated onto every school row a student has.

Consequences of this design:

- **The org level of the SEOA record is irrelevant.** School-, LEA-, ESC-, and SEA-level records are all picked up uniformly. There is no need to walk the org hierarchy (school → LEA → ESC → SEA), and no student's demographics are dropped just because a district records them above the school level. This is why `student_school` no longer needs to carry `localEducationAgencyId`.
- **No ghost rows.** Because rows are keyed only by `schoolId` (never by the SEOA org id), every `sourcedId` resolves to a `user`. A student with no `studentSchoolAssociation` still gets a single row keyed `md5('STU-'+studentUniqueId)`, matching that student's single `users` row.
- **Values are internally consistent per student.** The same student reports identical race/ethnicity at every school they attend.
- **Dual enrollment produces one row per school, all carrying the same values.** A student enrolled at more than one school has multiple `student_school` rows, so `student` fans out to one demographics row per `(student, school)` — each with a distinct `schoolId`-keyed `sourcedId` that matches that school's `users` row, and each carrying the student's single canonical demographic set. This is the case the earlier org-scoped approach got wrong: a student enrolled at School A (whose LEA recorded the SEOA) and School B (whose LEA did not) got demographics on the School A row and blanks on the School B row; person-level resolution gives both rows the same values. Because `educationOrganizationId` differs per row, `AuthorizationQueryService` still scopes each caller to only the school(s) they may see. (Re-enrollments at the *same* school collapse via `select distinct` in `student_school`, so they do not duplicate a row.)
- **Conflict resolution is union-based.** When a student's SEOA records genuinely disagree (a source data-quality issue) — most visibly across a dual enrollment where two different LEAs recorded different race — the values are unioned: `bool_or` on Hispanic/Latino (any `true` wins) and `MAX CASE` on each race flag independently, with `demographicRaceTwoOrMoreRaces` derived from the distinct mapped-race count. A student can therefore show more race flags than any single SEOA record held, and both of a dual-enrolled student's rows show the same unioned set. This is a deliberate, deterministic resolution; if a deployment needs a "nearest org wins" rule instead (no cross-org union), the `student_edorg`/`student_race` CTEs would need per-org selection logic and the org-hierarchy joins that this design otherwise avoids.

Race flags come from `studenteducationorganizationassociationrace` mapped via `RaceDescriptor`, aggregated to an array; each OneRoster race flag is `array @> [...]` membership. **Race/ethnicity flags are emitted as the literal strings `'true'`/`'false'`, not JSON booleans**, per the OneRoster spec. `demographicRaceTwoOrMoreRaces` is true when the mapped-race array length > 1; `hispanicOrLatinoEthnicity` from `bool_or` over associations. `sex` via `SexDescriptor` mapping; `countryOfBirthCode`/`stateOfBirthAbbreviation` read the descriptor `codevalue` directly (no mapping). `dateLastModified = greatest(student, edorg lastmodified)`.

### `enrollments` ← `staffSectionAssociation`, `studentSectionAssociation`, `sections`

Staff and student section associations are `UNION ALL`-ed. `sourcedId = md5(personUniqueId-<section natural key>-beginDate)` — **`beginDate` is included so re-enrollments produce distinct rows**. `role` is `'teacher'` (staff) or `'student'`. For staff, `primary` is derived from the Ed-Fi `ClassroomPositionDescriptor` via the `oneroster12/ClassroomPositionDescriptor` crosswalk (`'Teacher of Record'` → `TRUE`; other positions → `FALSE`), defaulting to `'false'` when the position is missing or unmapped; for students it is always `'false'`. The `user` href is keyed `md5('STA-'/'STU-'+uniqueId-schoolId)` to match the `users` view's school-scoped `sourcedId`.

### `orgs` ← `schools`, `localEducationAgencies`, `stateEducationAgencies`

Three levels `UNION ALL`-ed with `type` = `'school'` / `'district'` / `'state'`. `sourcedId = md5(id::text)` for each level. `parent` points up the hierarchy (school→LEA→SEA); `children` is a JSON aggregate pointing down (schools under an LEA, LEAs under an SEA). `name` from `nameOfInstitution`.

### `users` ← `staffs`, `students`, `contacts`, school/section associations

The most complex view — students, staff, and parents (`edfi.contact`) `UNION ALL`-ed. Key nuances:

- **`sourcedId`** is school-scoped where possible: `md5('STU-'/'STA-'/'PAR-'+uniqueId[-schoolId])`.
- **Per-school rows / primary-org tagging.** A person can associate with many schools. Students and staff emit `one row per associated school` (`distinct (studentusi, schoolid)` / `distinct (staffusi, schoolid)`), so the school-scoped `sourcedId` resolves for every school they are enrolled or assigned at — and re-associations don't duplicate the row. Contacts emit a single row keyed to their primary org. The `*_primary_org` CTEs no longer key the staff/student row; they tag each org `primary`/`secondary` in the `roles` array (and key the single contact row).
- **`roles` are deduped per org.** The `roles` array carries one entry per distinct associated org — the `*_orgs`/`contact_orgs` sources are deduped to `distinct (person, school)` before aggregation, so a re-enrollment (or a contact linked to two students at the same school) does not emit duplicate org entries. On **MSSQL** the `roles` array is built set-based (`STRING_AGG` over the deduped orgs, with the primary school precomputed in a CTE) — the earlier per-row correlated `FOR JSON` subquery with a nested `TOP 1` caused a catastrophic cardinality mis-estimate (a ~10¹² -row plan that spilled tempdb and never completed) on large ODSs; the PostgreSQL `json_agg` was already set-based.
- **Staff role** = mapped `StaffClassificationDescriptor`, taking the school-level assignment first then the LEA-level (`COALESCE`), defaulting to `'teacher'` when the staff member has any section association (`teaching_staff`).
- **`userIds`** prepends the canonical `{studentUniqueId|staffUniqueId|contactUniqueId}` to the array of Ed-Fi identification codes.
- **Email / `username`.** Students prefer `Home/Personal`, staff prefer `Work`; staff emails are additionally regex-validated and de-duplicated. Rows with `donotpublishindicator` are excluded. `username` falls back to `''` when no email exists.
- **Grade level** (students) = latest by `entryDate` via `row_number()`.

## Subset endpoints

These are not separate objects — `oneRosterController.js` serves them from a base object with a fixed `extraWhere` filter:

| Endpoint | Source object | Filter |
|---|---|---|
| `schools` | `orgs` | `type='school'` |
| `students` | `users` | `role='student'` |
| `teachers` | `users` | `role='teacher'` |
| `terms` | `academicsessions` | `type='term'` |
| `gradingPeriods` | `academicsessions` | `type='gradingPeriod'` |

## Engines & refresh

- **PostgreSQL** — each entity is a `materialized view`. A `UNIQUE` index on `sourcedId` is required so the view can be refreshed `CONCURRENTLY`; additional indexes back authorization filters. Refresh is scheduled via `cronService.js` (pg-boss).
- **MSSQL** — each entity is a physical **table** populated by a `sp_refresh_<entity>` stored procedure (same logic as the pg view). `oneroster12.sp_refresh_all` (`orchestration/master_refresh.sql`) runs them in dependency order — `academicsessions, orgs, courses, classes, demographics, users, enrollments` — logging to `refresh_history`/`refresh_errors`, with a 10-minute debounce (`@ForceRefresh`/`@SkipOnError` flags). Scheduled via SQL Agent (`orchestration/sql_agent.sql`).

## Data Standard versions

Artifacts are versioned (`standard/4.0.0`, `standard/5.2.0`). The mapping _shape_ is the same across versions, but source table/column availability differs by Data Standard. Edit the artifacts under the version(s) you support; the deploy scripts (`standard/deploy-{mssql,pgsql}.js`) target a chosen version.

## When changing a mapping

1. Edit the entity file under **both** `pgsql/core/` and `mssql/core/` (the MSSQL change is in the `sp_refresh_<entity>` procedure body).
2. If it involves a descriptor enum, prefer adding rows to `02_descriptorMappings.sql` over view logic.
3. If you change a `sourcedId` formula, update every place that references that entity (other views' `href`/`sourcedId` builders).
4. Update the matching QueryService config and the README endpoint/source table.
5. Re-deploy and refresh; verify with the comparison tests in `tests/`.
