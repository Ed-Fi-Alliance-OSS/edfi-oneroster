This app serves a OneRoster 1.2 API from data in an Ed-Fi ODS (Data Standard 5.0+).

### Architecture
* materialized views on ODS tables (see `/sql` - these queries must be run on the ODS manually)
* express-js API connected to Ed-Fi ODS (Postgres) database
* [pg-boss](https://timgit.github.io/pg-boss/#/./api/scheduling) to schedule refresh of the materialized views
* Swagger documentation with OAS2.0
* OAuth2 authentication

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
- [x] `/ims/oneroster/rostering/v1p2/users` (from Ed-Fi `staffs`, `schools`, `staffSectionAssn`, `staffSchoolAssn`, `students`, `studentSchoolAssn`, `studentEdOrgAssn`, `)
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

OneRoster API recommendations:
- [ ] HTTP header: X-Total-Count should report the total record count.
- [ ] HTTP Link Header. should give next, previous, first and last links.

### To-do
- [x] create default `descriptorMappings.jsonl` mapping Ed-Fi default descriptor values to 1EdTech OneRoster values
- [x] populate local ODS with descriptorMappings using lightbeam
- [x] update `*.sql` files to use descriptorMappings
- [x] implement basic OneRoster API endpoints
- [x] implement OAuth 2.0 for API (mostly)
- [x] implement pg-boss to schedule refresh of materialized views from app server(s)
- [ ] finish implementing/testing `users.sql`, especially `roles`
- [ ] implement [OneRoster 1.2 auth scopes](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#OpenAPI_Security)
- [ ] implement nested OneRoster API endpoints (like `/classes/{id}/students` - see "convenience"-tagged endpoints in Swagger)? (not required for OneRoster certification)
- [ ] test with more synthetic Ed-Fi data

### Deployment
The SQL in `/sql/*.sql` must be manually run on your Ed-Fi ODS Postgres database first before this app can work.

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
# "MYTOKEN" should be obtained via a request to the OAuth2 issuer base URL.
```

### About
Built by [Tom Reitz](https://github.com/tomreitz) of [Education Analytics](https://www.edanalytics.org/) for [1EdTech](https://www.1edtech.org/) in support of its [partnership](https://www.1edtech.org/about/partners/ed-fi) with the [Ed-Fi Alliance](https://www.ed-fi.org/).