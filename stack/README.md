# Full Stack Docker Setup

This directory provides **sample Docker Compose configuration files** to
demonstrate setting up Ed‑Fi OneRoster and the supporting Ed‑Fi ODS/API stack in
containers. **These files are intended for demo purposes only and are not
intended for production use.**
It contains:

- Compose definitions that describe the database tier, the Ed-Fi v7 API, NGINX,
  and the OneRoster Node.js service.
- PowerShell helpers that standardize how the stack is started and stopped.
- Version-specific `.env` files that capture the image tags, credentials, and
  OneRoster-specific configuration.

For lightweight dev workflows that run only the OneRoster API against a
pre-existing database, see `docker-compose.dev.yml` and
`docker-compose.dev-dual.yml` in the repo root.

## PowerShell entry points

### `start-services.ps1`

```powershell
pwsh ./start-services.ps1 [-Rebuild] [-EnvFile <path>] [-GenerateSigningKeys] [-InitializeAdminClients]
```

- Provisions the shared `edfioneroster-network` (if missing) and runs `docker
  compose up -d` across all compose files.
- `-Rebuild` forces a rebuild of the local OneRoster image before containers
  start.
- `-EnvFile` lets you point at any dotenv file (defaults to `.env` inside this
  folder). Relative paths are resolved from `stack/`.
- `-GenerateSigningKeys` creates ephemeral RSA keys via
  `public-private-key-pair.psm1` and injects them into the process environment.
  Use this for quick trials when you do not have `SECURITY__JWT__PRIVATEKEY` and
  `SECURITY__JWT__PUBLICKEY` set.
- `-InitializeAdminClients` copies `settings/bootstrap.sh` into the running
  `db-admin` container and executes it with `LEA_KEY`, `LEA_SECRET`,
  `SCHOOL_KEY`, and `SCHOOL_SECRET` taken from the selected `.env`. Use this to
  seed the test vendors/clients without recreating containers.
- The script validates that JWT signing keys exist either in the environment,
  the chosen `.env`, or via `-GenerateSigningKeys` before invoking Docker
  Compose.

### `stop-services.ps1`

```powershell
pwsh ./stop-services.ps1 [-Purge] [-EnvFile <path>]
```

- Runs `docker compose down --remove-orphans` across every compose file listed
  below using the provided env file.
- `-Purge` adds `--volumes --rmi all`, removing database volumes, named volumes,
  and images created by the stack (helpful when switching data standards or
  templates).
- `-EnvFile` mirrors the flag in `start-services.ps1` so you can stop the exact
  stack you started.

## Compose files

These three files are loaded together by the helper scripts (via repeated `-f`
flags) so they behave as a single logical stack.

| File | Purpose | Key services |
| --- | --- | --- |
| `edfi-services.yml` | Core Ed-Fi ODS/API dependencies. | `db-ods`, `db-admin`, `v7-single-api`, `swagger`, `pgadmin4` |
| `nginx-compose.yml` | HTTPS reverse proxy that fronts all APIs and terminates TLS using the templates under `stack/ssl`. | `nginx` |
| `oneroster-service.yml` | Builds and runs the OneRoster Node.js API, wiring it to the Ed-Fi ODS database and JWT issuer. | `oneroster-api` |

## Security baseline for custom compose files

If you replace or extend these sample compose files with your own, apply the
same least-privilege controls before running in shared, staging, or production
environments.

- Drop Linux capabilities by default (`cap_drop: [ALL]`) and add back only
  capabilities your container actually needs.
- Run workload containers as non-root users. Set `USER` in the Dockerfile and,
  when practical, enforce it in Compose with `user:`.
- Enable `security_opt: ["no-new-privileges:true"]` to prevent privilege
  escalation through setuid/setgid binaries.
- Apply restrictive runtime security profiles (seccomp, AppArmor, or SELinux)
  according to your host platform policy.
- Do not use `privileged: true`, avoid host namespaces (`pid: host`,
  `ipc: host`, `network_mode: host`), and avoid device mounts unless required.

Example service hardening (Node.js app):

```yaml
services:
  oneroster-api:
    build: ../
    user: appuser
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

For third-party images (database, reverse proxy, admin tools), validate vendor
guidance before dropping all capabilities to avoid startup regressions.

### Service highlights

- **db-ods** / **db-admin** – PostgreSQL containers seeded by
  `settings/init-databases.sh` and `settings/bootstrap.sh`. Credentials are
  sourced from `POSTGRES_USER` and `POSTGRES_PASSWORD`.
- **v7-single-api** – The Ed-Fi v7 Web API container. JWT details
  (`Security__Jwt__*`), feature flags, and health checks rely on the `.env`
  values.
- **swagger** – Bundled Swagger UI that points at the v7 API.
- **pgadmin4** – Optional DBA cockpit available on `127.0.0.1:5050` for local
  troubleshooting.
- **nginx** – Terminates TLS on `https://localhost:443` and routes traffic to
  the v7 API, OneRoster API, and Swagger virtual hosts using
  `settings/default.conf.template`.
- **oneroster-api** – Builds from the repo root (via the local Dockerfile),
  exposing `/health-check` for readiness and consuming OAuth/JWT settings listed
  below.

## Environment files

### Picking an env file

- `stack/.env.5.2.0.example` – Defaults for Ed-Fi Data Standard 5.2.0.
- `stack/.env.4.0.0.example` – Defaults for Data Standard 4.0.0.
- Rename a copy to `.env` or pass the file directly to the scripts using
  `-EnvFile`. Version-numbered files (`.env.5.2.0`, `.env.4.0.0`) are
  git-ignored working copies.

### Key sections and variables

| Section | Representative variables | Notes |
| --- | --- | --- |
| **Common DB credentials** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Shared across ODS, Admin, and the Node service. Match whatever is baked into the Ed-Fi images. |
| **Database engine options** | `DB_ENGINE`, `DB_SSL`, `DB_TRUST_CERTIFICATE`, `DB_TTL_IN_MINUTES` | Control whether OneRoster speaks to PostgreSQL or MSSQL and how SSL is negotiated. |
| **Pooling & TPDM** | `NPG_POOLING_ENABLED`, `NPG_API_MAX_POOL_SIZE_*`, `TPDM_ENABLED` | Tune Npgsql pooling and enable TPDM support in the Ed-Fi API images. |
| **Image tags & templates** | `ODS_DB_IMAGE_7X`, `ODS_DB_TAG_7X`, `ODS_API_TAG_7X`, `SWAGGER_TAG_7X`, `ADMIN_DB_TAG_7X` | Pin the Docker images for the Ed-Fi stack. Switch between populated/minimal templates by swapping values. |
| **URLs and hostnames** | `BASE_URL`, `V7_SINGLE_API_VIRTUAL_NAME`, `ONEROSTER_API_VIRTUAL_NAME`, `DOCS_VIRTUAL_NAME` | Must stay aligned with the NGINX template so that TLS certificates and reverse-proxy routes resolve correctly. |
| **Database names** | `TARGET_DB`, `TEMPLATE_DB` | Used by the bootstrap scripts to clone populated templates into the working ODS. |
| **Ed-Fi API health checks** | `V7_SINGLE_API_HEALTHCHECK`, `SWAGGER_HEALTHCHECK_TEST` | Executed by Docker to mark containers healthy before dependent services start. |
| **JWT & OAuth** | `SECURITY__JWT__PRIVATEKEY`, `SECURITY__JWT__PUBLICKEY`, `OAUTH2_ISSUERBASEURL`, `OAUTH2_AUDIENCE`, `OAUTH2_PUBLIC_KEY_PEM` | Required for OneRoster to validate JWTs issued by the Ed-Fi API. Populate with PEM-formatted keys (newline-escaped). |
| **OneRoster app settings** | `PORT`, `DB_TYPE`, `API_BASE_PATH`, `PGBOSS_CRON`, `CORS_ORIGINS`, `ONEROSTER_ARTIFACT_VERSION` | Tailor the Node service runtime, health-check cadence, and artifact set mounted from `/standard`. |
| **Logging & TLS trust** | `LOGS_FOLDER`, `NODE_EXTRA_CA_CERTS`, `TRUST_PROXY` | `LOGS_FOLDER` is bind-mounted into `v7-single-api`; `NODE_EXTRA_CA_CERTS` points at the self-signed CA bundled under `stack/ssl`. |

>[!NOTE]
> The `start-services.ps1` check ensures
> `SECURITY__JWT__PRIVATEKEY`/`PUBLICKEY` exist before containers start. Either
> set them in the env file or run with `-GenerateSigningKeys` for a temporary
> pair.

### Workflow

1. Copy the example env file that matches your target data standard and edit the
   values you care about (credentials, BASE_URL, image tags, keys).
2. Ensure the required `.crt`, `.key`, and `.pem` files exist under
   `stack/ssl`; run `./generate-certificate.sh` in that folder to create fresh
   self-signed certificates when needed.
3. Run `pwsh ./start-services.ps1 -EnvFile .env.5.2.0` (or your variant).
   Include `-Rebuild` whenever you change OneRoster source.
4. Access the stack:
   - Ed-Fi API: `https://localhost/<V7_SINGLE_API_VIRTUAL_NAME>`
   - OneRoster API: `https://localhost/<ONEROSTER_API_VIRTUAL_NAME>`
   - Swagger UI: `https://localhost/<DOCS_VIRTUAL_NAME>`
   - PGAdmin: `http://localhost:5050`
5. Stop the stack with `pwsh ./stop-services.ps1 [-Purge] -EnvFile .env.5.2.0`.
