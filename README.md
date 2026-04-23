# Ed-Fi OneRoster

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Ed-Fi-Alliance-OSS/edfi-oneroster/badge)](https://securityscorecards.dev/viewer/?uri=https://github.com/Ed-Fi-Alliance-OSS/edfi-oneroster)

This app serves a OneRoster 1.2 API from data in an Ed-Fi ODS (Data Standard 4.0 and 5.x).

## About

**Built by** [Tom Reitz](https://github.com/tomreitz) of [Education Analytics](https://www.edanalytics.org/) for [1EdTech](https://www.1edtech.org/) in support of its [partnership](https://www.1edtech.org/about/partners/ed-fi) with the [Ed-Fi Alliance](https://www.ed-fi.org/).

## Data Standard Support

* **Ed-Fi Data Standard 5.x (5.0, 5.1, 5.2)**: Full support
* **Ed-Fi Data Standard 4.0**: Full support with separate SQL implementations

## Documentation

* [Docker testing](stack/README.md) - Full stack docker deployment guide
* [Testing Guide](tests/README.md) - Performance and compatibility testing
* [Database Design](docs/database_abstraction_design_knex.md) - Knex.js abstraction layer
* [IIS Deployment](docs/IIS_Installation_Guide.md) - Windows/IIS hosting guide
* [Local Development Guide](docs/local-development-guide.md) - Environment setup, database schema deployment, running natively, and API validation

### Implemented OneRoster 1.2 Endpoints

The following GET endpoints are fully implemented:

| Endpoint | Ed-Fi Source |
|---|---|
| `/ims/oneroster/rostering/v1p2/academicSessions` | `sessions`, `schools`, `schoolCalendars` |
| `/ims/oneroster/rostering/v1p2/academicSessions/{id}` | — |
| `/ims/oneroster/rostering/v1p2/classes` | `sections`, `courseOfferings`, `schools` |
| `/ims/oneroster/rostering/v1p2/classes/{id}` | — |
| `/ims/oneroster/rostering/v1p2/courses` | `courses`, `courseOfferings`, `schools` |
| `/ims/oneroster/rostering/v1p2/courses/{id}` | — |
| `/ims/oneroster/rostering/v1p2/demographics` | `students`, `studentEdOrgAssn` |
| `/ims/oneroster/rostering/v1p2/demographics/{id}` | — |
| `/ims/oneroster/rostering/v1p2/enrollments` | `staffSectionAssn`, `studentSectionAssn`, `sections` |
| `/ims/oneroster/rostering/v1p2/enrollments/{id}` | — |
| `/ims/oneroster/rostering/v1p2/orgs` | `schools`, `localEducationAgencies`, `stateEducationAgencies` |
| `/ims/oneroster/rostering/v1p2/orgs/{id}` | — |
| `/ims/oneroster/rostering/v1p2/users` | `staffs`, `students`, `contacts`, section/school associations |
| `/ims/oneroster/rostering/v1p2/users/{id}` | — |
| `/ims/oneroster/rostering/v1p2/schools` | Subset of `orgs` |
| `/ims/oneroster/rostering/v1p2/schools/{id}` | — |
| `/ims/oneroster/rostering/v1p2/students` | Subset of `users` |
| `/ims/oneroster/rostering/v1p2/students/{id}` | — |
| `/ims/oneroster/rostering/v1p2/teachers` | Subset of `users` |
| `/ims/oneroster/rostering/v1p2/teachers/{id}` | — |
| `/ims/oneroster/rostering/v1p2/gradingPeriods` | Subset of `academicSessions` |
| `/ims/oneroster/rostering/v1p2/gradingPeriods/{id}` | — |
| `/ims/oneroster/rostering/v1p2/terms` | Subset of `academicSessions` |
| `/ims/oneroster/rostering/v1p2/terms/{id}` | — |

See the [OneRoster 1.2 specification](https://www.imsglobal.org/spec/oneroster/v1p2) for field definitions and filter syntax.

**Supported query parameters on all list endpoints:**

| Parameter | Example | Description |
|---|---|---|
| `limit` / `offset` | `?limit=100&offset=0` | Pagination |
| `sort` / `orderBy` | `?sort=familyName&orderBy=asc` | Sorting |
| `filter` | `?filter=familyName='jones'` | Server-side filtering |
| `fields` | `?fields=givenName,familyName` | Field selection |

## Legal Information

Copyright (c) 2025 1EdTech Consortium, Inc. and contributors.

Licensed under the [Apache License, Version 2.0](LICENSE) (the "License").

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

See [NOTICES](NOTICES.md) for additional copyright and license notifications.
