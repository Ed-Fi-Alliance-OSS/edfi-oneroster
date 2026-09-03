# Ed-Fi Data Standard 6.1 Support

## Summary

This document records every schema difference between Ed-Fi Data Standard **5.2.0** and
**6.1.0** that affects the OneRoster projections in `standard/5.2.0/artifacts/{mssql,pgsql}/core/`,
and what each difference requires in order to **add 6.1.0 support** to the service.

The work is to derive a new `standard/6.1.0/`
tree from the 5.2.0 artifacts and apply the deltas below to that copy. Everything in this
document therefore describes an edit to the _new_ 6.1.0 files.

Scope for the schema tiers below is deliberately narrow: only the Ed-Fi entities the ten
core SQL files actually read. Thirty entities are reached across both engines; **nine
require an edit**, the rest are additive-only or change in ways the projections never
touch. [Tooling changes for 6.1.0 support](#tooling-changes-for-610-support) covers the
rest of the work — deploy scripts, comparison tests, Bruno, Docker and the stack scripts.

| Tier | What happens at deploy time | Count |
| --- | --- | --- |
| **1 — Hard break** | Table or column no longer exists; the refresh procedure / materialized view fails to create | 6 |
| **2 — Silent duplication** | Object still exists, but its grain changed; queries compile and emit duplicate rows | 1 |
| **3 — Widened source column** | `edfi.Course.CourseCode` 60 → 120 outgrows two MSSQL-only targets in `courses.sql` — one hard insert failure, one silent `sourcedId` collision | 2 |
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
| `Course` | mssql `courses.sql:118`<br>pgsql `courses.sql:11` | `CourseCode` 60 → **120** · `CourseTitle` 60 → **120** | Widen, MSSQL only — see [detail](#tier-3--coursecode-outgrows-its-mssql-targets) |

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

## Tier 3 — CourseCode outgrows its MSSQL targets

DS 6.1 doubled a family of natural-key and title columns from `NVARCHAR(60)` to
`NVARCHAR(120)`: `SessionName`, `CalendarCode`, `CourseCode`, `CourseTitle`,
`LocalCourseTitle`, `LoginId`, `CredentialIdentifier`, `IdentificationCode`. Almost all of
them land in `NVARCHAR(256)` or `NVARCHAR(MAX)` targets and need nothing. `CourseCode` is
the exception, and it lands in two different places in `courses.sql`.

Both are **MSSQL-only**. The PostgreSQL artifact is a materialized view that projects
`crs.coursecode` directly (`pgsql/core/courses.sql:39`) and casts it with an unbounded
`::varchar` in the sourcedId hash (`:25`), so it inherits whatever width the ODS defines
and has neither problem.

Three widths are in play here and they are easy to conflate — only the first is a DS 6.1
change, the other two are numbers this repository chose:

| Width | Where it comes from | Status |
| --- | --- | --- |
| `NVARCHAR(60)` → `NVARCHAR(120)` | `edfi.Course.CourseCode` — **the Ed-Fi source column**, widened by DS 6.1 | The change being absorbed |
| `NVARCHAR(64)` | `oneroster12.courses.courseCode` — **our own target column**, `courses.sql:30` and `:107` | Was comfortably above 60; is now below 120 |
| `VARCHAR(50)` | **Our own** `CAST` inside the sourcedId MD5 input, `courses.sql:131` | Was already below 60 |

### 3a — Target column narrower than its source (hard failure, not silent)

| Location | Current | Required |
| --- | --- | --- |
| `courses.sql:30` — `oneroster12.courses` | `courseCode NVARCHAR(64)` | `NVARCHAR(120)` |
| `courses.sql:107` — `#staging_courses` | `courseCode NVARCHAR(64)` | `NVARCHAR(120)` |

Both declarations must move together. SQL Server raises *String or binary data would be
truncated* and `sp_refresh_courses` fails outright the first time an ODS holds a course
code longer than 64 characters — so this surfaces loudly rather than corrupting data.

### 3b — sourcedId hash input truncates (silent)

| Location | Current | Required |
| --- | --- | --- |
| `courses.sql:131` — sourcedId MD5 input | `CAST(crs.CourseCode AS VARCHAR(50))` | `VARCHAR(120)` |

Two courses in the same organization that differ only past character 50 hash to the same
`sourcedId`, and one silently overwrites the other on the primary key.

> [!NOTE]
> This is a **pre-existing 5.2 defect**, not something 6.1 introduces. The cast is already
> narrower than the 5.2 source column, so codes of 51–60 characters collide today. DS 6.1
> widens the exposed range from 10 characters to 70.

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

## Tooling changes for 6.1.0 support

The SQL deltas above are only half the work. Every entry point that selects a data
standard is currently a **two-value switch** — `ds4` or `ds5` — and in each case `ds5` is
the *unguarded else branch* rather than an explicit case. Adding a third value means
touching each one, and the shape of the existing code makes a partial change dangerous:

```javascript
// standard/deploy-mssql.js:70 — same shape in deploy-pgsql.js:66 and deploy-postgres.sh:94
function versionBasedDirectory(ds) {
    if (ds === 'ds4') { return path.join(__dirname, './4.0.0/artifacts/mssql'); }
    else              { return path.join(__dirname, './5.2.0/artifacts/mssql'); }
}
```

Today an unrecognised `ds6` is caught by the argument whitelist, so it fails cleanly. Once
`ds6` is added to that whitelist but a `versionBasedDirectory` is missed, the script
**silently deploys 5.2.0 SQL against a 6.1 ODS** and fails later with confusing errors.

> [!TIP]
> Replace each `if/else` with a single lookup keyed by data standard —
> `{ ds4: '4.0.0', ds5: '5.2.0', ds6: '6.1.0' }` — so the version-to-folder mapping exists
> in exactly one place per script and a missing entry throws instead of defaulting.

### Deploy scripts

| File | Lines to change | What |
| --- | --- | --- |
| `standard/deploy-mssql.js` | `:33` · `:70–75` · `:11–14`, `:36–41` | Argument whitelist · `versionBasedDirectory()` · usage text |
| `standard/deploy-pgsql.js` | `:32` · `:66–69` · `:11–13`, `:36–39` | Same three |
| `standard/refresh-data-mssql.js` | `:36` · `:10–12`, `:40–43` | Whitelist · usage text (it forwards `dataStandard` to the deploy path) |
| `standard/deploy-postgres.sh` | `:13` · `:57–73` · `:94–100` · `:17–20` | Argument guard · env-file selection · `container_name` + `ds_folder` · usage text |

`deploy-postgres.sh` needs two extra decisions the JS scripts do not: which **env file**
6.1 loads (`.env.ds6.postgres`, alongside the existing `.env.ds4.postgres` /
`.env.postgres`) and which **container name** it targets (`:95` hardcodes `edfi-ds4-ods`
for DS4 and `ed-fi-db-ods` otherwise).

> [!NOTE]
> Unrelated pre-existing cruft, worth not copying forward: the
> `materialized_view_files` array at `deploy-postgres.sh:126–127` lists `users_ds4.sql`
> and `enrollments_ds4.sql`, which do not exist in `standard/4.0.0/artifacts/pgsql/core/`.
> The 4.0.0 and 5.2.0 trees have identical file names, and 6.1.0 will too.

### tests/compare-database.js

This file needs the most care — it has **six** version-dependent points, two of which are
not obvious:

| Lines | What | Change |
| --- | --- | --- |
| `:26–32` | Argument parse (`ds4`/`ds5`, else treat arg as endpoint) | Accept `ds6` |
| `:36–38` | Env-file pair selection | Add `{ pg: '.env.ds6.postgres', mssql: '.env.ds6.mssql' }` |
| `:41–44` | "Using Ed-Fi Data Standard N configuration" log | Add the 6 case |
| `:74` | Default PostgreSQL port — `ds4 ? 5435 : 5434` | 6.1 needs its own port so all three stacks can run side by side |
| `:718` | `const expectedDS = dataStandard === 'ds4' ? '4' : '5'` | Becomes a map; drives the version-mismatch warning |
| `:604`, `:661` | `DeployJournal` probes: `LIKE '%Standard.4.%' OR LIKE '%Standard.5.%'` | Add `'%Standard.6.%'`, or the detected version reports `Unknown` for every 6.1 database |

The sixth is the **fallback heuristic** at `:622–641`, which runs when `DeployJournal` is
absent:

```javascript
if (pgContactCheck.rows[0].has_contact === true)      { pgEdFiVersion = 'Data Standard 5.x'; }
else if (pgParentCheck.rows[0].has_parent === true)   { pgEdFiVersion = 'Data Standard 4.x'; }
```

`edfi.contact` exists in **both** 5.2 and 6.1, so a 6.1 database is silently reported as
"Data Standard 5.x". Probe a table that only 6.1 has — `edfi.studentdemographic` is the
natural choice, since it is the entity Tier 1 already forces us to reason about. The same
fix is needed on the MSSQL branch.

`tests/compare-api.js` needs the smaller equivalent: argument parse `:35`, env loading
`:45–48`, and the port map at `:56–57` (`ds4 ? 3002 : 3000` / `ds4 ? 3003 : 3001`).

### Bruno tests

**Summary: four new environment files, one `ValidateSet`, and CI steps. The `.bru`
collection itself needs no changes** — a scan of every request file found zero
version-conditional assertions.

**1. New environment files** in `tests/bruno/environments/`, copied from their 5.2.0
counterparts:

```text
6.1.0.env                      (pgsql, single-tenant)
6.1.0-mssql.env                (mssql, single-tenant)
6.1.0-multi-tenant.env         (pgsql, multi-tenant)
6.1.0-mssql-multi-tenant.env   (mssql, multi-tenant)
```

Keys to change in each:

| Key | 5.2.0 value | 6.1.0 |
| --- | --- | --- |
| `STANDARD_VERSION` | `5.2.0` | `6.1.0` |
| `ONEROSTER_ARTIFACT_VERSION` | `5.2.0` | `6.1.0` — `ONEROSTER_ARTIFACT_DIR` interpolates it, so it needs no separate edit |
| `TPDM_ENABLED` | `true` | `false` — see below |
| MSSQL package versions | `API_VERSION`, `MSSQL_ADMIN_VERSION`, `MSSQL_SECURITY_VERSION`, `MSSQL_ODS_POPULATED_VERSION`, `MSSQL_ODS_MINIMAL_VERSION`, `SWAGGER_TAG_7X` | Upstream — see [open item](#open-item-upstream-package-and-image-versions) |
| PgSQL image tags | `ODS_DB_TAG_7X`, `ODS_API_TAG_7X`, `SWAGGER_TAG_7X`, `ADMIN_DB_TAG_7X` | Upstream — same |

On **TPDM**: DS 6.0 folded the TPDM extension into the core model, so the separate TPDM
templates no longer exist. `stack/mssql/db-ods/Dockerfile:50` already anticipates this —

```dockerfile
if semver -r "<6.0.0" "$STANDARD_VERSION"; then \
    # download TPDM populated/minimal templates
fi
```

— so the download is skipped automatically for 6.1.0 and no Dockerfile change is needed.
Drop `MSSQL_TPDM_POPULATED_VERSION`, `MSSQL_TPDM_MINIMAL_VERSION` and `EXTENSION_VERSION`
from the 6.1.0 env files; they are only read inside that gate.

**2. Runner** — `tests/bruno/run-bruno-e2e.ps1:4`:

```powershell
[ValidateSet('4.0.0','5.2.0','6.1.0')]
```

Nothing else in the runner is version-aware: `Get-EnvFileName` (`:25–37`) derives the
filename from `$Version` plus the `-InstallType` / `-DbType` switches, so the four new
files are picked up automatically.

**3. CI** — `.github/workflows/on-pullrequest.yml:188–234` currently runs eight explicit
steps (2 engines × 2 tenancy models × 2 versions). Adding 6.1.0 makes twelve. The same
pattern repeats in `on-prerelease.yml`. Worth converting to a matrix at the same time
rather than pasting four more near-identical blocks.

> [!WARNING]
> Do not assume Bruno assertion parity. The collection has no version conditionals, but
> two Tier 1/2 changes alter **response content** for the same seeded data: the
> `StudentIdentificationCode` PK narrowing removes duplicate `userIds` entries, and the
> `StaffIdentificationCode` org fan-out adds them. Any assertion counting or matching
> `userIds` must be re-baselined against the 6.1 populated template, not carried over.

### Docker and compose

Mostly parameterized already — this is the lightest area.

| File | Change |
| --- | --- |
| `stack/mssql/db-ods/Dockerfile` | **None.** Takes `STANDARD_VERSION` as an `ARG` and builds every NuGet feed URL from it; already gates TPDM on `<6.0.0` |
| `stack/mssql/db-admin/Dockerfile` | **None.** Same `STANDARD_VERSION`-driven URL construction |
| `stack/mssql/ods-api/Dockerfile` | **None.** Same |
| Compose files (4) | Optional: the `${ONEROSTER_ARTIFACT_VERSION:-5.2.0}` fallback appears at `mssql/single-tenant/docker-compose-mssql.yml:184–185`, `mssql/multi-tenant/docker-compose-multi-tenant-mssql.yml:245–246`, `pgsql/single-tenant/oneroster-service.yml:29–30`, `pgsql/multi-tenant/compose-multi-tenant-env.yml:205–206` |

The compose default is harmless while the env files always set the variable, but it means
a typo in a 6.1.0 env file mounts the 5.2.0 artifact directory instead of failing. Consider
dropping the `:-5.2.0` fallback so the variable becomes required.

PostgreSQL has **no Dockerfile** — it pulls published images
(`edfialliance/ods-api-db-ods-sandbox:<tag>`, `ods-api-web-api:<tag>`). A 6.1.0 tag must
exist upstream; this is the one hard external dependency in the whole port.

### stack/*.ps1

**No functional change required.** Both scripts are already version-agnostic:

- `start-services.ps1:299` and `:379` read `ONEROSTER_ARTIFACT_VERSION` from the env file
  and throw if it is missing, then pass it to `setup-oneroster-data.psm1`
- `setup-oneroster-data.psm1:332` and `:420` build
  `standard/$ArtifactVersion/artifacts/<engine>/core` from that parameter

Only documentation strings name a version — the `.EXAMPLE` blocks at
`start-services.ps1:6,10,14` and `stop-services.ps1:6,10`. Update those for consistency.

### New environment files to create

| Path | Consumed by |
| --- | --- |
| `stack/mssql/.env.6.1.0.example` | `start-services.ps1 -EnvFile` |
| `stack/pgsql/.env.6.1.0.example` | `start-services.ps1 -EnvFile` |
| `tests/.env.ds6.postgres`, `tests/.env.ds6.mssql` | `compare-database.js`, `compare-api.js` |
| `.env.ds6.postgres` (repo root) | `deploy-postgres.sh` |

The root `.env.example` and `standard/.env.deploy.example` hold no version-specific keys
and need no change.

### Open item: upstream package and image versions

Every value in the table below has to come from the Ed-Fi release that actually publishes
DS 6.1 packages — none of them can be derived from this repository:

```text
API_VERSION                    MSSQL_ODS_POPULATED_VERSION    ODS_DB_TAG_7X
MSSQL_ADMIN_VERSION            MSSQL_ODS_MINIMAL_VERSION      ODS_API_TAG_7X
MSSQL_SECURITY_VERSION         SWAGGER_TAG_7X                 ADMIN_DB_TAG_7X
```

The local `Ed-Fi-ODS` clone carries `Standard/6.1.0` on an unreleased `main`, and the
newest `Ed-Fi-ODS-Implementation` tag is `v7.3.2`, which ships DS 5.2. **Confirm which
ODS/API release publishes the DS 6.1 NuGet packages and Docker images before filling in
the 6.1.0 env files** — the Bruno and stack work is blocked on that answer, while all the
SQL work in the tiers above is not.

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
