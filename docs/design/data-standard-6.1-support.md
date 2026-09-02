# Ed-Fi Data Standard 6.1 Support

## Summary

This document records every schema difference between Ed-Fi Data Standard **5.2.0** and
**6.1.0** that affects the OneRoster projections in `standard/5.2.0/artifacts/{mssql,pgsql}/core/`,
and what each difference requires in order to **add 6.1.0 support** to the service.

The work is to derive a new `standard/6.1.0/`
tree from the 5.2.0 artifacts and apply the deltas below to that copy. Everything in this
document therefore describes an edit to the _new_ 6.1.0 files.

Scope is deliberately narrow: only the Ed-Fi entities the ten core SQL files actually read.
Thirty entities are reached across both engines; **nine require an edit**, the rest are
additive-only or change in ways the projections never touch.

| Tier | What happens at deploy time | Count |
| --- | --- | --- |
| **1 — Hard break** | Table or column no longer exists; the refresh procedure / materialized view fails to create | 6 |
| **2 — Silent duplication** | Object still exists, but its grain changed; queries compile and emit duplicate rows | 1 |
| **3 — Silent truncation** | Source column widened past the width of a target column or a `CAST` | 2 |
| **No action** | Additive columns, or removed columns the projections never referenced | 21 |

> [!IMPORTANT]
> Two Tier 1 items are **not** simple renames. `StaffElectronicMail` and
> `StaffEducationOrganizationContactAssociation` both fold into a single new org-scoped
> table, and `StudentEducationOrganizationAssociation` loses the demographic columns
> `demographics.sql` depends on. See [Tier 1 detail](#tier-1--hard-breaks).

### How this was derived

Both DDL artifacts were parsed into `{table -> {column -> type, nullability}, primary key}`
maps and diffed, restricted to the entities resolved from `FROM` / `JOIN` clauses in the
core files (with alias binding, so `ssa` correctly resolves to `StudentSchoolAssociation`
in one CTE and `StaffSchoolAssociation` in another).

| Side | Artifact |
| --- | --- |
| 5.2 baseline | `Ed-Fi-ODS/Application/EdFi.Ods.Standard/Standard/5.2.0/Artifacts/MsSql/Structure/Ods/0020-Tables.sql` — 613 tables |
| 6.1 target | `standard/6.1.0/artifacts/mssql/0020-Tables.sql` — 829 tables (byte-identical to the ODS 6.1.0 artifact) |

Line numbers throughout refer to `standard/5.2.0/artifacts/` at commit `97396af`.

---

## Full entity diff, 5.2.0 → 6.1.0

Entities are ordered by the work they require, then alphabetically. "Read by" lists the
core files that reference the entity, with the line of the `FROM` / `JOIN` clause.

### Requires an edit

| Entity | Read by | 5.2 → 6.1 delta | Action |
| --- | --- | --- | --- |
| `StudentEducationOrganizationAssociationRace` | mssql `demographics.sql:176`<br>pgsql `demographics.sql:40` | **Table dropped.** Replaced by `StudentDemographicRace` with an identical column list and PK `(EducationOrganizationId, StudentUSI, RaceDescriptorId)` | Rename |
| `StudentEducationOrganizationAssociationElectronicMail` | mssql `users.sql:302`<br>pgsql `users.sql:56` | **Table dropped.** Replaced by `StudentDirectoryElectronicMail`; identical columns and identical 4-part PK | Rename |
| `StudentEducationOrganizationAssociationStudentIdentificationCode`<br><sub>pgsql name is truncated to `…studentidentifica_c15030`</sub> | mssql `users.sql:211`, `:218`<br>pgsql `users.sql:40` | **Table dropped.** Replaced by `StudentIdentificationCode`. PK narrowed: `AssigningOrganizationIdentificationCode` left the key and is now nullable. Gained `Discriminator`, `LastModifiedDate`, `Id`. `IdentificationCode` 60 → 120 | Rename + expect fewer `userIds` entries |
| `StaffElectronicMail` | mssql `users.sql:325`<br>pgsql `users.sql:348` | **Table dropped.** Replaced by `StaffDirectoryElectronicMail`, which **prepends `EducationOrganizationId BIGINT NOT NULL` to the PK** | Rework — see [detail](#staff-email-consolidates-into-one-org-scoped-table) |
| `StaffEducationOrganizationContactAssociation` | pgsql `users.sql:359` <sub>(pgsql only)</sub> | **Table dropped, no direct successor.** Its org-scoped staff email is now covered by `StaffDirectoryElectronicMail` | Rework — collapses the `stacked_emails` union |
| `StudentEducationOrganizationAssociation` | mssql `demographics.sql:162`<br>pgsql `demographics.sql:31`, `users.sql:95` | **−`HispanicLatinoEthnicity`, −`SexDescriptorId`, −`GenderIdentity`, −`LimitedEnglishProficiencyDescriptorId`, −`SupporterMilitaryConnectionDescriptorId`** (all moved to `StudentDemographic`) · `LoginId` 60 → 120 | Rework — see [detail](#ethnicity-moves-off-seoa) |
| `StaffIdentificationCode` | mssql `users.sql:348`<br>pgsql `users.sql:293` | **+`EducationOrganizationId BIGINT NOT NULL` into the PK** · +`Discriminator`, +`LastModifiedDate`, +`Id` · `IdentificationCode` 60 → 120 | Dedupe — see [detail](#staffidentificationcode-becomes-org-scoped) |
| `Course` | mssql `courses.sql:118`<br>pgsql `courses.sql:11` | `CourseCode` 60 → **120** · `CourseTitle` 60 → **120** | Widen — see [detail](#coursecode-outgrows-its-target-and-its-hash-input) |

### No action required

| Entity | Read by | 5.2 → 6.1 delta | Why it is safe |
| --- | --- | --- | --- |
| `CourseOffering` | `classes.sql`, `courses.sql` | `CourseCode` 60 → 120 · `SessionName` 60 → 120 · `LocalCourseTitle` 60 → 120 | Only joined on, or projected into `NVARCHAR(256)` / `NVARCHAR(MAX)` targets |
| `Session` | `academic_sessions.sql` | `SessionName` 60 → 120 | Feeds the sourcedId hash uncast and `title` from the term descriptor |
| `Section` | `classes.sql`, `enrollments.sql` | `SessionName` 60 → 120 | Join key only |
| `SectionClassPeriod` | `classes.sql` | `SessionName` 60 → 120 | Join key only; `periods` target is `NVARCHAR(MAX)` |
| `StudentSectionAssociation` | `enrollments.sql` | `SessionName` 60 → 120 | Join key only |
| `StaffSectionAssociation` | `enrollments.sql`, `users.sql` | `SessionName` 60 → 120 | Join key only |
| `CalendarDate` | `academic_sessions.sql` | `CalendarCode` 60 → 120 | Grouped on, never projected |
| `CalendarDateCalendarEvent` | `academic_sessions.sql` | `CalendarCode` 60 → 120 | Join key only |
| `StudentSchoolAssociation` | `demographics.sql`, `users.sql` | `CalendarCode` 60 → 120 | `CalendarCode` is never read |
| `StaffSchoolAssociation` | `users.sql` | `CalendarCode` 60 → 120 | `CalendarCode` is never read |
| `Staff` | `enrollments.sql`, `users.sql` | +`EducationOrganizationId BIGINT NULL`, +`RequisitionNumber` · −`CitizenshipStatusDescriptorId`, −`GenderIdentity`, −`HispanicLatinoEthnicity`, −`SexDescriptorId` · `LoginId` 60 → 120 | None of the removed columns are referenced |
| `Student` | `demographics.sql`, `enrollments.sql`, `users.sql` | −`CitizenshipStatusDescriptorId` | Not referenced. `BirthSexDescriptorId` is retained, so the `demographics.sex` mapping is untouched |
| `School` | 6 files | +`AccreditationStatusDescriptorId`, +`FederalLocaleCodeDescriptorId`, +`ImprovingSchool`, +`PostSecondaryInstitutionId` | Additive |
| `LocalEducationAgency` | `orgs.sql`, pgsql `users.sql` | +`FederalLocaleCodeDescriptorId` | Additive |
| `StateEducationAgency` | `orgs.sql` | +`FederalLocaleCodeDescriptorId` | Additive |
| `StaffEducationOrganizationAssignmentAssociation` | `users.sql` | +`YearsOfExperienceAtCurrentEducationOrganization` · `CredentialIdentifier` 60 → 120 | Additive; only `StaffClassificationDescriptorId` and the ids are read |
| `Contact` | `users.sql` | `LoginId` 60 → 120 | Not referenced; name fields land in `NVARCHAR(256)` |
| `EducationOrganization` | `orgs.sql` | unchanged | — |
| `ContactElectronicMail` | `users.sql` | unchanged | — |
| `StudentContactAssociation` | `users.sql` | unchanged | — |
| `Descriptor` | 5 files | unchanged | — |
| `DescriptorMapping` | 5 files | unchanged | — |

---

## Tier 1 — hard breaks

Five tables were dropped in 6.1 and one column moved off its table. Until each is
repointed, `sp_refresh_demographics` and `sp_refresh_users` fail at `CREATE PROCEDURE`
time on MSSQL, and the `demographics` / `users` materialized views fail to create on
PostgreSQL.

### Race collection renamed

```text
edfi.StudentEducationOrganizationAssociationRace  ->  edfi.StudentDemographicRace
```

Identical column list (`EducationOrganizationId`, `StudentUSI`, `RaceDescriptorId`,
`CreateDate`) and identical PK. Change the table name and nothing else — the `seoar` alias
and its joins to `edfi.Descriptor` / `edfi.DescriptorMapping` keep working.

- MSSQL: `demographics.sql:176`, CTE `student_race`
- PgSQL: `demographics.sql:40`, CTE `student_race`

### Ethnicity moves off SEOA

```text
edfi.StudentEducationOrganizationAssociation.HispanicLatinoEthnicity
  ->  edfi.StudentDemographic.HispanicLatinoEthnicity
```

DS 6.1 strips five demographic columns off `StudentEducationOrganizationAssociation` into
the new `edfi.StudentDemographic`, keyed identically on `(EducationOrganizationId,
StudentUSI)`. The `student_hispanic` / `student_edorg` CTE has to be repointed at that
table.

Two things to carry across with the rename:

1. `MAX(seoa.LastModifiedDate) AS edorg_lmdate` must also come from
   `StudentDemographic.LastModifiedDate`. Left on SEOA it still compiles, but
   `dateLastModified` stops reflecting demographic edits — a silent staleness bug.
2. The `GROUP BY StudentUSI` roll-up across all org levels stays correct. The new table
   is org-scoped exactly as SEOA was, so aggregating person-level facts across school,
   LEA, ESC and SEA rows still behaves as documented in
   [oneroster-view-mappings.md](oneroster-view-mappings.md).

- MSSQL: `demographics.sql:157–163`
- PgSQL: `demographics.sql:26–33`

### Student identification codes promoted to a first-class entity

```text
edfi.StudentEducationOrganizationAssociationStudentIdentificationCode
  ->  edfi.StudentIdentificationCode
```

On MSSQL both the outer `FROM` (`users.sql:218`) and the correlated `FOR JSON PATH`
subquery (`users.sql:211`) need the new name. On PostgreSQL this also retires the
63-character-truncated identifier `edfi.studenteducationorganizationassociationstudentidentifica_c15030`
(`users.sql:40`) — the 6.1 name is short enough that the hashed suffix disappears.

The PK narrowed from four parts to three: `AssigningOrganizationIdentificationCode`
dropped out of the key and is now a nullable attribute, so there is at most one row per
`(EducationOrganizationId, StudentIdentificationSystemDescriptorId, StudentUSI)`. This
**strictly reduces** the `userIds` JSON array — a student who previously emitted one entry
per assigning organization now emits one per identification system. Expect an output diff,
not an error.

### Student email moved to the directory family

```text
edfi.StudentEducationOrganizationAssociationElectronicMail
  ->  edfi.StudentDirectoryElectronicMail
```

Identical columns and identical four-part PK. The `ROW_NUMBER() … PARTITION BY StudentUSI
ORDER BY CASE WHEN CodeValue = 'Home/Personal' …` preference logic is unaffected.

- MSSQL: `users.sql:302`
- PgSQL: `users.sql:56`

### Staff email consolidates into one org-scoped table

```text
edfi.StaffElectronicMail                          ─┐
                                                   ├─>  edfi.StaffDirectoryElectronicMail
edfi.StaffEducationOrganizationContactAssociation ─┘
```

This is the one structural change rather than a rename. In 5.2 staff email had two
sources: the person-level `StaffElectronicMail`, keyed `(StaffUSI, ElectronicMailAddress,
ElectronicMailTypeDescriptorId)`, and the org-level
`StaffEducationOrganizationContactAssociation`. 6.1 drops both and provides a single
`StaffDirectoryElectronicMail` that **prepends `EducationOrganizationId BIGINT NOT NULL`
to the PK**.

**MSSQL** (`users.sql:325`, temp table `#staff_email`) — a staff member whose work address
is recorded at three organizations now produces three rows. The existing
`ROW_NUMBER() … PARTITION BY seo.StaffUSI ORDER BY CASE WHEN d.CodeValue = 'Work' THEN 1
ELSE 2 END, d.CodeValue` has no tiebreaker between them, so the winner becomes
nondeterministic across refreshes. Either add `EducationOrganizationId` to the `ORDER BY`,
or narrow the existing `SELECT DISTINCT` to `(StaffUSI, ElectronicMailAddress)` so the org
fan-out collapses before ranking.

**PgSQL** (`users.sql:348` and `:359`) — the `staff_email` and `staff_edorg_email` CTEs
both now read from the same table, so the `stacked_emails` union collapses to a single
select. The `null::boolean as donotpublishindicator` placeholder in `staff_edorg_email`
can become the real `donotpublishindicator` column, which makes the downstream
do-not-publish filter apply consistently to both former sources for the first time.

---

## Tier 2 — silent duplication

### StaffIdentificationCode becomes org-scoped

```text
5.2  PK (StaffUSI, StaffIdentificationSystemDescriptorId)
6.1  PK (EducationOrganizationId, StaffIdentificationSystemDescriptorId, StaffUSI)
```

The table keeps its name, so nothing errors — but its grain changed. Both engines
aggregate identification codes by `StaffUSI` alone:

- MSSQL `users.sql:340–356` — correlated subquery filtered on
  `WHERE sic.StaffUSI = staff_main.StaffUSI`
- PgSQL `users.sql:283–296` — `json_agg(...) ... group by 1` over `edfi.staffidentificationcode`

Under 6.1 a staff member with a State ID recorded at both their school and their LEA emits
the same `{type, identifier}` object twice into the `userIds` array. Add a `DISTINCT` over
`(CodeValue, IdentificationCode)`, or scope the aggregate to the organization the user row
is being emitted for.

---

## Tier 3 — silent truncation

DS 6.1 doubled a family of natural-key and title columns from `NVARCHAR(60)` to
`NVARCHAR(120)`: `SessionName`, `CalendarCode`, `CourseCode`, `CourseTitle`,
`LocalCourseTitle`, `LoginId`, `CredentialIdentifier`, `IdentificationCode`. Almost all of
them land in `NVARCHAR(256)` or `NVARCHAR(MAX)` targets and need nothing. `CourseCode` is
the exception.

### CourseCode outgrows its target and its hash input

Two edits, both in `courses.sql`, which must land together:

| Location | Current | Required |
| --- | --- | --- |
| MSSQL `courses.sql:131` — sourcedId hash input | `CAST(crs.CourseCode AS VARCHAR(50))` | `VARCHAR(120)` |
| MSSQL `courses.sql:30` and `:107` — target table and `#staging_courses` | `courseCode NVARCHAR(64)` | `NVARCHAR(120)` |

The staging column is the loud failure: any code past 64 characters throws a
string-truncation error on insert.

The hash input is the quiet one. `edfi.Course.CourseCode` is now `NVARCHAR(120)`, but the
MD5 input truncates it at 50 — so two courses in the same organization that differ only
past character 50 hash to the same `sourcedId`, and one silently overwrites the other on
the primary key.

> [!WARNING]
> Widening the hash cast is correct, but it **rewrites every `sourcedId`** for courses
> whose code exceeds 50 characters. Treat it as a breaking identifier change for API
> consumers, not a quiet fix — the same consideration applies to any other sourcedId
> input touched while deriving the 6.1.0 artifacts.

---

## Not affected

**Descriptor seed files.** `01_descriptors.sql` and `02_descriptorMappings.sql` only write
to `edfi.Descriptor` and `edfi.DescriptorMapping`, both unchanged in 6.1, and the six
descriptor tables they name — `CalendarEventDescriptor`, `ClassroomPositionDescriptor`,
`RaceDescriptor`, `SexDescriptor`, `StaffClassificationDescriptor`, `TermDescriptor` — all
still exist. No edits on either engine.

**Sex and race mapping.** `demographics.sql` reads sex from `Student.BirthSexDescriptorId`,
not from the SEOA `SexDescriptorId` that 6.1 removed, so the mapping added in
[#142](https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/pull/142) carries over intact.

**Organization id widths.** `SchoolId`, `EducationOrganizationId`, `LocalEducationAgencyId`
and `StateEducationAgencyId` were already `BIGINT` in 5.2 — 6.1 does not change them.

---

## Pre-existing gap worth folding in

All fourteen declarations of `educationOrganizationId` across the six `oneroster12` target
and staging tables are typed `INT`:

```text
academic_sessions.sql:33,110   classes.sql:41,124   courses.sql:36,113
demographics.sql:42,136        enrollments.sql:31,124
orgs.sql:33,115                users.sql:49,167
```

Ed-Fi education organization ids have been `BIGINT` since 5.2, so these have been narrow
for two data standard versions. Nothing about 6.1 makes this worse, and the surrounding
`CONVERT(VARCHAR(20), …)` casts already hold a full 19-digit `BIGINT`. It is a
pre-existing gap rather than a 6.1 finding, but standing up a new version tree is a natural
moment to close it in that copy — the change also reaches the knex query services and
the swagger type declarations, not just the SQL.
