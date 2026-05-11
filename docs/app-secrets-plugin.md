# App secrets plugin

The ODS connection string encryption key and OAuth2 JWT public PEM are normally read from **`ODS_CONNECTION_STRING_ENCRYPTION_KEY`** and **`OAUTH2_PUBLIC_KEY_PEM`** in the environment.

Alternatively, you can load them from an ESM module before the rest of the app starts:

- **Default**: use `.env` / process environment when **`APP_SECRETS_MODULE`** is unset or empty.  
- **Plugin**: set **`APP_SECRETS_MODULE`** to a non-empty module specifier; core loads it and assigns **`process.env`** so validation and `app.js` behavior stay unchanged.

Bootstrap runs immediately after `dotenv.config()` in `server.js`, **before** environment validation and **before** `app.js` is imported (JWT middleware reads the PEM at load time).

## Plugin module contract

Export a single async function:

```javascript
/**
 * @returns {Promise<{
 *   odsConnectionStringEncryptionKey: string,
 *   oauth2PublicKeyPem: string,
 *   pgBossConnectionConfig?: { adminConnection: string }
 * }>}
 */
export async function loadAppSecrets() {
  // ...
}
```

Core assigns:

- `process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY` ← `odsConnectionStringEncryptionKey`
- `process.env.OAUTH2_PUBLIC_KEY_PEM` ← `oauth2PublicKeyPem`
- Optionally **`process.env.PG_BOSS_CONNECTION_CONFIG`** ← `JSON.stringify(pgBossConnectionConfig)` when the plugin returns **`pgBossConnectionConfig`** with a non-empty **`adminConnection`** string (same JSON shape as manual env: `{ "adminConnection": "..." }`).

When the plugin runs, values returned **overwrite** any literals already in the environment for predictable deployments (including **`PG_BOSS_CONNECTION_CONFIG`** when `pgBossConnectionConfig` is returned).

If the plugin **omits** `pgBossConnectionConfig`, core does not set `PG_BOSS_CONNECTION_CONFIG`; with **`DB_TYPE=postgres`**, validation still requires it unless another source populated it earlier.

## `APP_SECRETS_MODULE` specifier

Same rules as **`TENANTS_CONFIG_MODULE`** (see [Tenant configuration plugin](./tenants-config-plugin.md)): resolved relative to the process current working directory for `./` and `../`; absolute paths and `file:` URLs are supported; bare specifiers resolve as npm packages.

## Reference implementation (Starting Blocks)

See [`src/config/startingblocks-app-secrets-aws.js`](../src/config/startingblocks-app-secrets-aws.js). It uses `@aws-sdk/client-secrets-manager` (`GetSecretValue`) with secret IDs derived from **`ENV_LABEL`** or **`ENVLABEL`**:

| Secret id | Shape | Mapping |
|-----------|--------|---------|
| `{ENV_LABEL}-AdminApiSecret` | Plain `SecretString` | `odsConnectionStringEncryptionKey` (verbatim) |
| `{ENV_LABEL}-JwtKeyPair` | JSON object | `oauth2PublicKeyPem` ← string field **`publicKey`** |

### Optional pg-boss from Aurora (same deployment as tenants)

When **`DB_TYPE=postgres`** and **`PG_BOSS_DATABASE`** is set to the PostgreSQL database name used for pg-boss metadata (single DB for the deployment), the reference module also loads **`AURORA_MASTER_SECRET`** or **`{ENV_LABEL}-AuroraMasterSecret`** (same id rules as [`startingblocks-tenants-aws.js`](../src/config/startingblocks-tenants-aws.js)) and returns **`pgBossConnectionConfig`** built from [`startingblocks-aws-aurora.js`](../src/config/startingblocks-aws-aurora.js) **`buildPostgresAdminConnection`**.

Plugin-local environment variables (not validated by core):

| Variable | Purpose |
|----------|---------|
| **`PG_BOSS_DATABASE`** | Database name segment for the shared pg-boss store (required to trigger Aurora-backed pg-boss in the reference plugin). |
| **`PG_BOSS_APPLICATION_NAME`** | Overrides **`TENANTS_APPLICATION_NAME`** only when building the pg-boss connection string. |
| **`PG_BOSS_CONNECTION_STRING_SUFFIX`** | Overrides **`TENANTS_CONNECTION_STRING_SUFFIX`** only for that connection string. |

Aurora secret JSON shape (`host`, `port`, `username`, `password`) matches the tenant plugin. Naming stays in this reference section, not in the core validator.
