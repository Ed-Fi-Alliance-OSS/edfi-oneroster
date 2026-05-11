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

## `TENANTS_CONFIG_MODULE` specifier

Resolved relative to the process current working directory when the path starts with `./` or `../`; absolute filesystem paths and `file:` URLs are supported; bare specifiers resolve as npm packages (e.g. `@scope/tenant-loader`).

## Reference implementation

See [`src/config/startingblocks-tenants-aws.js`](../src/config/startingblocks-tenants-aws.js) for an example that reads tenant names from DynamoDB and credentials from Secrets Manager. It requires the optional AWS SDK packages (`npm install` installs `optionalDependencies` by default).

Plugin-specific environment variables (for example `ENV_LABEL`) belong in that module’s documentation, not in the core validator.

## Reload without restart

When **`TENANTS_CONFIG_MODULE`** is set, send **SIGUSR2** to the Node process to reload tenants via the same module (e.g. `kill -USR2 <pid>` on Linux).
