# Tenant configuration plugin

When `MULTITENANCY_ENABLED=true`, tenant database connection strings can be supplied either:

- **JSON in `TENANTS_CONNECTION_CONFIG`** when **`TENANTS_CONFIG_MODULE`** is unset or empty (default), or  
- **Dynamic module**: set **`TENANTS_CONFIG_MODULE`** to a non-empty specifier; core loads **`loadTenantsConfig()`** before serving traffic.

## Plugin module contract

The module must export exactly one async function:

```javascript
/**
 * @returns {Promise<Record<string, { adminConnection: string }>>}
 */
export async function loadTenantsConfig() {
  // ...
}
```

Keys are tenant identifiers as used in routes/JWT (matching is case-insensitive in the core app). Each value must include a PostgreSQL or MSSQL-style `adminConnection` string compatible with this service’s parser.

Plugin-specific environment variables belong in that module’s documentation, not in the core validator.

## `TENANTS_CONFIG_MODULE` specifier

Resolved relative to the process current working directory when the path starts with `./`, `../`, `.\` or `..\`; absolute filesystem paths and `file:` URLs are supported; bare specifiers resolve as npm packages (e.g. `@scope/tenant-loader`).

## Example implementation

[`src/config/examples/tenants-config-file.js`](../src/config/examples/tenants-config-file.js) is a minimal, dependency-free reference that reads the tenant map from a JSON file. It exists to demonstrate the contract — a production plugin should fetch tenants and credentials from a secrets manager or directory service rather than from a file on disk.

Enable it with:

```bash
MULTITENANCY_ENABLED=true
TENANTS_CONFIG_MODULE=./src/config/examples/tenants-config-file.js
TENANTS_CONFIG_FILE=/secure/path/tenants.json
```

`TENANTS_CONFIG_FILE` is specific to this example plugin (not read by core). The JSON file uses the same shape as `TENANTS_CONNECTION_CONFIG`:

```json
{
  "Tenant1": { "adminConnection": "host=...;database=EdFi_Admin_Tenant1;username=...;password=..." },
  "Tenant2": { "adminConnection": "host=...;database=EdFi_Admin_Tenant2;username=...;password=..." }
}
```

Each value may also include an optional `OdsInstances` map (same shape as in `TENANTS_CONNECTION_CONFIG`) to resolve ODS connections directly. The file is re-read on every call, so combined with **SIGUSR2** (below) you can edit it and reload tenants without a restart.

## Reload without restart

When **`TENANTS_CONFIG_MODULE`** is set, send **SIGUSR2** to the Node process to reload tenants via the same module (e.g. `kill -USR2 <pid>` on Linux).

> **Windows:** Node.js does not support `SIGUSR2` on native Windows, so there is no in-place reload there — restart the process to pick up tenant changes. The signal-based reload works on Linux/macOS (including Linux containers), but not on IIS-based deployments on Windows.
