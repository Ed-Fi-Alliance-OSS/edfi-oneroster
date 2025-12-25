# Ed-Fi OneRoster Automated Testing: Summary & Next Steps

## Overview

The Ed-Fi OneRoster API exposes data synthesized from Ed-Fi ODS database
views/tables. To ensure data integrity and consistency, automated validation is
needed. The recommended approach is API-level end-to-end testing using Bruno,
with optional database-layer scripts for fast checks.

## Supporting Multiple Data Standards and Database Engines

The Ed-Fi OneRoster implementation can be configured to use different Ed-Fi
DataStandard versions and either SQL Server or PostgreSQL as the backend.
Automated validation must:

- Support both PostgreSQL and SQL Server deployments.
- Validate against the correct Ed-Fi DataStandard version/schema in use.
- Ensure that tests and scripts are portable and parameterized for both database
  types and schema differences.

This ensures that data integrity is maintained regardless of the underlying
database or DataStandard version.

## Recommended Testing Approach

- **API Layer (Preferred):**
  - Use Bruno to create end-to-end tests that compare OneRoster API responses
    with Ed-Fi DataStandard API responses.
  - Validate that synthesized data in OneRoster matches the source data in
    Ed-Fi, for both SQL Server and PostgreSQL backends.
  - Parameterize environment variables (e.g., base URLs, schema names) to
    support different DataStandard versions and database types.
  - Use collection-level environment variables and bearer authentication for
    secrets management.
  - Automate tests in CI using GitHub Actions, running all required containers
    (PostgreSQL, SQL Server, Ed-Fi DataStandard API, OneRoster API) and
    publishing assertion summaries.
  - **Reference:** See [Ed-Fi Certification Bruno
    Collection](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/bruno/SIS/collection.bru)
    for collection structure and [Bruno environment/secrets
    management](https://docs.usebruno.com/secrets-management/dotenv-file).

- **Database Layer (Optional):**
  - Write SQL scripts to directly compare materialized view rows (`oneroster12`
    schema) with Ed-Fi source tables.
  - Provide scripts for both PostgreSQL and SQL Server, accounting for syntax
    and schema differences.
  - Use as fast smoke checks, but note this does not validate the full
    application flow.

## Actionable Tickets

### Foundation

1. **Bruno Collection & Environment**  
     - Create a Bruno collection for OneRoster validations.
     - Add a `.env.example` with all required variables (base URLs, tokens,
       schema names, database type).
     - Configure collection-level bearer authentication.
     - _Reference:_ [Certification Bruno Auth
       Example](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/bruno/SIS/collection.bru)

2. **CI Workflow (Bruno)**
     - Set up a GitHub Actions workflow that launches the necessary Docker
       containers (PostgreSQL/SQL Server, Ed-Fi DataStandard database, and
       OneRoster API) and executes Bruno tests.
     - Ensure the workflow can run tests against both database engines and
       DataStandard versions.
     - Publish a summary of assertions.
     - _Reference:_ [Certification CI Script
       Example](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/scripts/run-scenarios.cjs#L299)

3. **Test Data & Secrets**
   - Document and manage credentials and test data.
   - Store secrets in GitHub Actions; add README notes for local runs.

### API-Layer Validation

For each endpoint, create a Bruno folder and implement tests that:

- GET OneRoster data, cache a record, and extract natural keys.
- GET corresponding Ed-Fi DataStandard data using extracted keys.
- Assert that key fields (dates, codes, links, etc.) match between OneRoster and Ed-Fi.
- Parameterize tests to run against both PostgreSQL and SQL Server, and for different DataStandard versions.
- Example endpoints: `academicSessions`, `classes`, `courses`, `demographics`, `orgs`, `users` (students, staff, parents).

### Database-Layer Validation Scripts (Optional)

For each endpoint, create SQL scripts for both PostgreSQL and SQL Server that:

- Select a random record from the OneRoster view.
- Join or query Ed-Fi source tables using natural keys.
- Assert that all relevant fields match (`count = 1` on success).
- Account for differences in SQL dialect and schema between database engines and DataStandard versions.

### Additional

- **Endpoint Coverage Expansion:** Add Bruno tests for all OneRoster endpoints
  (gradingPeriods, terms, enrollments, schools, students, teachers, etc.).
- **Reporting & Trends:** Add a CI report artifact summarizing assertion counts
  and historical trends.
- **Documentation & Runbook:** Add a README with instructions for running Bruno
  tests locally and in CI, including environment setup and interpreting results.

## References & Examples

- [Ed-Fi Certification Bruno Collection Example](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/bruno/SIS/collection.bru)
- [Bruno Environment & Secrets Management](https://docs.usebruno.com/secrets-management/dotenv-file)
- [Certification CI Automation Script](https://github.com/Ed-Fi-Alliance-OSS/certification-testing/blob/main/scripts/run-scenarios.cjs#L299)
- [Bruno Assertions Documentation](https://docs.usebruno.com/testing/tests/assertions)

---

This summary provides a clear roadmap for implementing and automating data
validation for Ed-Fi OneRoster, combining the detailed findings and actionable
steps from both original documents, and leveraging proven patterns from the
Ed-Fi certification project.
