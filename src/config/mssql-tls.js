// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Single source of truth for MSSQL transport security options.
 *
 * Secure by default: encryption is on unless a connection string explicitly
 * disables it, and the server certificate is validated unless a connection
 * string explicitly opts out.
 *
 * Both options must be set explicitly rather than left to the driver. Knex's
 * MSSQL dialect defaults `encrypt` to false before merging
 * `connection.options`, so omitting them yields a cleartext connection with no
 * test failure to catch it.
 *
 * Local development against SQL Server with a self-signed certificate should
 * set `TrustServerCertificate=True` (preferred, keeps traffic encrypted) or
 * `Encrypt=False`. See docs/local-development-guide.md.
 */

import fs from 'node:fs';

// SqlClient accepts more than "true"/"false": also yes/no, 1/0, and
// Mandatory/Optional/Strict since Microsoft.Data.SqlClient 5.0. Treating an
// unrecognised spelling as `false` would fail open — `Encrypt=Mandatory` would
// silently connect in cleartext — so unknown values are reported as unspecified
// and the secure default applies. `strict` (TDS 8.0) counts as "encryption
// required"; tedious cannot honour the certificate validation it implies, so
// unlike SqlClient this path still applies TrustServerCertificate.
const TRUTHY = new Set(['true', 'yes', '1', 'mandatory', 'strict']);
const FALSY = new Set(['false', 'no', '0', 'optional']);

const readCaFile = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(
      `[Config] MSSQL: failed to read DB_SSL_CA '${filePath}' - ${error.message}. ` +
      "Falling back to Node's default certificate store."
    );
    return undefined;
  }
};

/**
 * Interpret an MSSQL boolean from a connection string or environment variable.
 *
 * @param {string} value - raw value as configured
 * @param {string} keyword - the setting being parsed, e.g. 'Encrypt'
 * @returns {boolean|undefined} undefined when the value is not recognised
 */
export function parseMssqlBoolean(value, keyword) {
  const normalized = String(value).trim().toLowerCase();

  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;

  console.warn(
    `[Config] MSSQL: unrecognised value '${value}' for '${keyword}'. ` +
    'Ignoring it and applying the secure default. Expected one of: ' +
    `${[...TRUTHY, ...FALSY].join(', ')}.`
  );
  return undefined;
}

/**
 * Build the transport-security portion of an mssql `connection.options` object.
 *
 * @param {Object} connectionConfig - parsed connection configuration
 * @returns {{ encrypt: boolean, trustServerCertificate: boolean }}
 */
export function buildMssqlTlsOptions(connectionConfig = {}) {
  const encrypt = connectionConfig.encrypt ?? true;
  const trustServerCertificate = connectionConfig.trustServerCertificate ?? false;
  const options = { encrypt, trustServerCertificate };

  const target = connectionConfig.database ? `'${connectionConfig.database}'` : 'connection';

  // Validation uses Node's bundled root store, which excludes internal and
  // enterprise CAs. caFilePath comes only from DB_SSL_CA (standard/ tooling);
  // the service uses NODE_EXTRA_CA_CERTS. Not a connection-string keyword —
  // see parseConnectionString() for why.
  if (encrypt && connectionConfig.caFilePath) {
    const ca = readCaFile(connectionConfig.caFilePath);
    if (ca) {
      options.cryptoCredentialsDetails = { ca };

      if (trustServerCertificate) {
        console.warn(
          `[Config] MSSQL ${target}: a CA was supplied via DB_SSL_CA but ` +
          'TrustServerCertificate=True disables validation, so the CA is unused. ' +
          'Set TrustServerCertificate=False to validate against it.'
        );
      }
    }
  }

  if (!encrypt) {
    console.warn(
      `[Config] MSSQL ${target}: transport encryption is DISABLED (Encrypt=False). ` +
      'Data crosses the network in cleartext. Intended for local development only.'
    );
  } else if (trustServerCertificate) {
    console.warn(
      `[Config] MSSQL ${target}: encryption is enabled but server certificate validation ` +
      'is DISABLED (TrustServerCertificate=True). The connection is not protected against ' +
      'man-in-the-middle attacks. Intended for local development only.'
    );
  }

  return options;
}

/**
 * Same policy, for tooling configured by environment variables rather than a
 * connection string — see standard/deploy-mssql.js and
 * standard/refresh-data-mssql.js. An unset or empty variable means
 * "unspecified", so the secure default applies.
 *
 * @param {Object} env - environment object, defaults to process.env
 * @returns {{ encrypt: boolean, trustServerCertificate: boolean }}
 */
export function buildMssqlTlsOptionsFromEnv(env = process.env) {
  const read = (name, keyword) =>
    env[name] == null || env[name] === '' ? undefined : parseMssqlBoolean(env[name], keyword);

  return buildMssqlTlsOptions({
    database: env.DB_NAME,
    caFilePath: env.DB_SSL_CA || undefined,
    encrypt: read('DB_ENCRYPT', 'Encrypt'),
    trustServerCertificate: read('DB_TRUST_SERVER_CERTIFICATE', 'TrustServerCertificate')
  });
}
