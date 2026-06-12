# CLAUDE.md

Read-only microservice serving the OneRoster 1.2 rostering API over an Ed-Fi ODS (Data Standard 4.0, 5.0–5.2). Node ≥22.12, ESM, Express 5.

## Architecture
- `server.js` — entry: dotenv → `envValidator.validateAndExit()` → dynamic-imports `app.js`/cron/services. HTTPS + graceful shutdown.
- `src/app.js` — Express wiring: CORS, rate limit, dynamic route prefix (tenant/context), then `jwtCheck → extractTenant → validateOdsInstanceFlow → oneRosterRoutes`.
- Flow: `src/routes/` → `controllers/unified/oneRosterController.js` → `services/database/*QueryService.js` (knex against the `oneroster12` schema/views in the ODS).
- `standard/<version>/artifacts/{mssql,pgsql}/core/*.sql` build the `oneroster12` views; deployed via `standard/deploy-{mssql,pgsql}.js`. Edit per-engine for API. Keep mssql/pgsql in sync. Mapping rules/nuances per view: `docs/design/oneroster-view-mappings.md`.

## Multi-tenancy
JWT claims (`tenantId`, `odsInstanceId`, `odsInstances`) → look up encrypted ODS connection string in `EdFi_Admin.dbo.OdsInstances` (AES-256-CBC, HMAC-verified) → query that ODS. Env config: `CONNECTION_CONFIG`/`TENANTS_CONNECTION_CONFIG`, `ODS_CONTEXT_ROUTE_TEMPLATE`. Admin tables (`dbo.odsinstances`, `dbo.odsinstancecontexts`) use `dbo` schema on both engines.

## Conventions
- Supports MSSQL and PostgreSQL — every DB change must cover both.
- Errors use the OneRoster `imsx_*` envelope; never leak stack traces, tenant IDs, or raw DB errors.
- Start new files with the SPDX/Apache-2.0 header (copy from any source file).
- Match local style: 2-space indent, `[Component]`-prefixed `console.log`.

## Commands
- `npm test` (Jest, ESM). Single: `npm test -- tests/unit-tests/<file>.test.js`. Tests in `tests/unit-tests/`.
- `npm start` · `npm run build` (build check) · Docker/local: `stack/README.md`, `docs/local-development-guide.md`.

## Changing things
- New endpoint/field: update per-engine `core/*.sql` + the QueryService config + a unit test.
- Preserve `OneRosterQueryService` filter/field guards (`MAX_FILTER_*` limits).

## End-user docs (separate repo)
Authoritative docs live in `Ed-Fi-Alliance-OSS/ed-fi-alliance-oss.github.io` under `docs/reference/3-oneroster/` (sibling clone locally). Do not edit that repo as part of a code change — flag affected files and ask first:
- `configuration/environment-variables.md` — env var reference (sync with `envValidator.js`).
- `configuration/{oauth-and-jwt,cors-rate-limit-proxy,performance}.md` — auth, CORS/rate-limit/proxy, perf.
- `data-model/{endpoint-source-mapping,descriptor-mappings,organization-mapping}.md` — OneRoster↔Ed-Fi mappings; update alongside `core/*.sql`.
- `getting-started/deploy-{mssql,postgres,iis}.md`, `docker-compose.md` — deployment.
