
# OneRoster 1.2 Postgresql Server Implementation

>[!NOTE]
The script files are organized under the `standard/{data standard version}/pgsql`
directory structure.

This directory contains the SQL needed to create OneRoster 1.2 materialized views on Ed-Fi DS5.0 ODS tables.
* `00_setup.sql` creates a `oneroster12` schema
* `01_descriptors.sql` inserts OneRoster-namespaced descriptor values for those Ed-Fi descriptors used for the OneRoster data
* `02_descriptorMappings.sql` inserts descriptorMappings from Ed-Fi default descriptor values to OneRoster-namespaced values
* `academic_sessions.sql` builds OneRoster 1.2 `academicSessions` from Ed-Fi `sessions`, `schools`, and `schoolCalendars`
* `classes.sql` builds OneRoster 1.2 `classes` from Ed-Fi `sections`, `courseOfferings`, and `schools`
* `courses.sql` builds OneRoster 1.2 `courses` from Ed-Fi `courses`, `courseOfferings`, and `schools`
* `demographics.sql` builds OneRoster 1.2 `demographics` from Ed-Fi `students`, and `studentEdOrgAssn`
* `enrollments.sql` builds OneRoster 1.2 `enrollments` from Ed-Fi `staffSectionAssn`, `studentSectionAssn`, and `sections`
* `orgs.sql` builds OneRoster 1.2 `orgs` from Ed-Fi `schools`, `localEducationAgencies`, and `stateEducationAgencies`
* `users.sql` builds OneRoster 1.2 `users` from Ed-Fi `staffs`, `schools`, `staffSectionAssociations`, `staffSchoolAssociations`, `students`, `studentSchoolAssociations`, and `studentEducationOrganizationAssociations`

This OneRoster 1.2 PostgreSQL is based on the [OneRoster 1.1 Snowflake implementation](https://github.com/edanalytics/edu_ext_oneroster/tree/main/models/oneroster_1_1) in [EDU](https://enabledataunion.org/).

You can merge all the files into one SQL script (to be run on an Ed-Fi ODS database) with
```bash
cat *.sql > oneroster12.sql
```
Then run the SQL with
```bash
psql -U <username> -d <dbname> -f oneroster12.sql
```
