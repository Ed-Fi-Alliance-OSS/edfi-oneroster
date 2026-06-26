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

Same rules as **`TENANTS_CONFIG_MODULE`** (see [Tenant configuration plugin](./tenants-config-plugin.md)): resolved relative to the process current working directory for `./`, `../`, `.\` or `..\`; absolute paths and `file:` URLs are supported; bare specifiers resolve as npm packages.

## Example implementation

[`src/config/examples/app-secrets-file.js`](../src/config/examples/app-secrets-file.js) is a minimal, dependency-free reference that reads the secrets from a JSON file. It exists to demonstrate the contract — a production plugin should fetch these from a secrets manager or vault rather than from a file on disk.

Enable it with:

```bash
APP_SECRETS_MODULE=./src/config/examples/app-secrets-file.js
APP_SECRETS_FILE=/secure/path/app-secrets.json
```

`APP_SECRETS_FILE` is specific to this example plugin (not read by core). The JSON file matches the `loadAppSecrets()` return shape:

```json
{
  "odsConnectionStringEncryptionKey": "<base64 32-byte key>",
  "oauth2PublicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "pgBossConnectionConfig": { "adminConnection": "host=...;database=...;username=...;password=..." }
}
```

`pgBossConnectionConfig` is optional — include it (with `DB_TYPE=postgres`) to supply `PG_BOSS_CONNECTION_CONFIG` from the plugin; otherwise it must come from the environment.
