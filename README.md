This app serves a OneRoster 1.2 API from data in an Ed-Fi ODS (Data Standard 5.0+).

### Architecture
* materialized views on ODS tables (see `/sql` - these queries must be run on the ODS manually)
* express-js API connected to Ed-Fi ODS (Postgres) database
* [pg-boss](https://timgit.github.io/pg-boss/#/./api/scheduling) to schedule refresh of the materialized views
* Swagger documentation with OAS2.0
* OAuth2 authentication with [OneRoster 1.2 scopes](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#OpenAPI_Security)

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

### Possible future work
- [ ] implement nested OneRoster API endpoints (like `/classes/{id}/students` - see "convenience"-tagged endpoints in Swagger)? (not required for OneRoster certification)
- [ ] implement OneRoster API optional recommendations:
    - [ ] HTTP header: X-Total-Count should report the total record count.
    - [ ] HTTP Link Header. should give next, previous, first and last links.

### Deployment
The SQL in `/sql/*.sql` must be manually run on your Ed-Fi ODS Postgres database first before this app can work.

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

To start the app:
```bash
# install node_modules:
npm install

# run via Docker:
docker compose up --build

# OR run natively:
node server.js

# test a OneRoster endpoint:
curl -i http://localhost:3000/ims/oneroster/rostering/v1p2/orgs -H "Authorization: Bearer MYTOKEN"
# "MYTOKEN" should be obtained via a request to the OAuth2 issuer base URL and must contain one or
# more of the OneRoster 1.2 scopes: `roster.readonly`, `roster-core.readonly`, and
# `roster-demographics.readonly`.
```

### About
Built by [Tom Reitz](https://github.com/tomreitz) of [Education Analytics](https://www.edanalytics.org/) for [1EdTech](https://www.1edtech.org/) in support of its [partnership](https://www.1edtech.org/about/partners/ed-fi) with the [Ed-Fi Alliance](https://www.ed-fi.org/).

### Performance testing
To test the performance of this solution, I loaded a fair amount of synthetic Ed-Fi data (1 LEA, 6 schools, ~500 staffs, ~5k students, ~1500 courses, 1 school year - a total of ~160k records across 23 Ed-Fi resources, 62MB of JSON) to an Ed-Fi ODS (7.1, DS 5.0) running locally in Docker. I then timed the initial creation of each materialized view in Postgres, and the refresh of each materialized view; results are shown in the table below:
| view | create time | refresh time |
| --- | --- | --- |
| academicSessions | 0.089s | 0.075s |
| classes | 0.341s | 0.428s |
| courses | 0.107s | 0.117s |
| demographics | 0.219s | 0.169s |
| enrollments | 6.598s | 6.814s |
| orgs | 0.081s | 0.075s |
| users | 7.885s | 8.025s |

(times reported above are averages of 5 runs, Postgres 16 in Docker on a Lenovo laptop with Intel i-5 2.6GHz processor, 16GB RAM, and 500GB SSD)

Enrollments and users are the slowest views, which makes some sense - enrollments is large (produces many thousands of rows) and users is complex (many joins).

I then stress-tested the OneRoster API with [vegeta](https://github.com/tsenart/vegeta) via commands like
```bash
vegeta attack -duration=60s -targets=courses.txt -header 'authorization: Bearer [TOKEN_GOES_HERE]]' --rate 0 -max-workers 20 | tee results.bin | vegeta report
```
and `targets` file like
```
GET http://localhost:3000/ims/oneroster/rostering/v1p2/courses?limit=100&offset=0
GET http://localhost:3000/ims/oneroster/rostering/v1p2/courses?limit=100&offset=100
GET http://localhost:3000/ims/oneroster/rostering/v1p2/courses?limit=100&offset=200
...
```
(and for `{id}` endpoints, 100 different `id`s from the database)

Results for each endpoint are below:
| endpoint | total requests in 60s | rate (requests/second) | mean latency/req (ms) | success rate |
| --- | --- | --- | --- | --- |
| `/ims/oneroster/rostering/v1p2/academicSessions` | 7731 | 129 | 155 | 100% |
| `/ims/oneroster/rostering/v1p2/academicSessions/{id}` | 11608 | 193 | 103 | 100% |
| `/ims/oneroster/rostering/v1p2/classes` | 3299 | 55 | 142 | 100% |
| `/ims/oneroster/rostering/v1p2/classes/{id}` | 14748 | 246 | 81 | 100% |
| `/ims/oneroster/rostering/v1p2/courses` | 5466 | 91 | 199 | 100% |
| `/ims/oneroster/rostering/v1p2/courses/{id}` | 10027 | 167 | 120 | 100% |
| `/ims/oneroster/rostering/v1p2/demographics` | 4312 | 72 | 199 | 100% |
| `/ims/oneroster/rostering/v1p2/demographics/{id}` | 14712 | 245 | 82 | 100% |
| `/ims/oneroster/rostering/v1p2/enrollments` | 3828 | 64 | 185 | 100% |
| `/ims/oneroster/rostering/v1p2/enrollments/{id}` | 10745 | 179 | 112 | 100% |
| `/ims/oneroster/rostering/v1p2/orgs` | 8599 | 143 | 139 | 100% |
| `/ims/oneroster/rostering/v1p2/orgs/{id}` | 8021 | 134 | 150 | 100% |
| `/ims/oneroster/rostering/v1p2/users` | 5358 | 89 | 154 | 100% |
| `/ims/oneroster/rostering/v1p2/users/{id}` | 13011 | 217 | 92 | 100% |
