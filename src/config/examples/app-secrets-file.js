// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Example app-secrets plugin (reference/documentation only).
 *
 * Demonstrates the APP_SECRETS_MODULE contract (see docs/app-secrets-plugin.md) with no
 * external dependency: it reads secrets from a JSON file whose path is given by the
 * APP_SECRETS_FILE environment variable. A production plugin would instead fetch these
 * from a secrets manager / vault rather than from a file on disk.
 *
 * Enable with:
 *   APP_SECRETS_MODULE=./src/config/examples/app-secrets-file.js
 *   APP_SECRETS_FILE=/secure/path/app-secrets.json
 *
 * The file is a JSON object matching the loadAppSecrets() return shape:
 *   {
 *     "odsConnectionStringEncryptionKey": "<base64 32-byte key>",
 *     "oauth2PublicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
 *     "pgBossConnectionConfig": { "adminConnection": "host=...;database=...;..." }
 *   }
 * `pgBossConnectionConfig` is optional; include it (with DB_TYPE=postgres) to supply
 * PG_BOSS_CONNECTION_CONFIG from the plugin. Core trims and assigns the returned values.
 */

import { readFile } from 'node:fs/promises';

const ENV_VAR = 'APP_SECRETS_FILE';

/**
 * @returns {Promise<{
 *   odsConnectionStringEncryptionKey: string,
 *   oauth2PublicKeyPem: string,
 *   pgBossConnectionConfig?: { adminConnection: string }
 * }>}
 */
export async function loadAppSecrets() {
  const filePath = (process.env[ENV_VAR] || '').trim();
  if (!filePath) {
    throw new Error(`${ENV_VAR} must be set for the example app secrets plugin`);
  }

  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${ENV_VAR} (${filePath}): ${error.message}`);
  }

  let secrets;
  try {
    secrets = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${ENV_VAR} (${filePath}) must contain valid JSON: ${error.message}`);
  }

  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
    throw new Error(`${ENV_VAR} (${filePath}) must contain a JSON object`);
  }

  const { odsConnectionStringEncryptionKey, oauth2PublicKeyPem, pgBossConnectionConfig } = secrets;

  if (typeof odsConnectionStringEncryptionKey !== 'string' || !odsConnectionStringEncryptionKey.trim()) {
    throw new Error(`${ENV_VAR} (${filePath}) must include a non-empty string odsConnectionStringEncryptionKey`);
  }
  if (typeof oauth2PublicKeyPem !== 'string' || !oauth2PublicKeyPem.trim()) {
    throw new Error(`${ENV_VAR} (${filePath}) must include a non-empty string oauth2PublicKeyPem`);
  }

  const result = { odsConnectionStringEncryptionKey, oauth2PublicKeyPem };

  // pgBossConnectionConfig is optional; validate it only when present so callers get a
  // file-aware error instead of a generic one from core.
  if (pgBossConnectionConfig !== undefined && pgBossConnectionConfig !== null) {
    const adminConnection = pgBossConnectionConfig?.adminConnection;
    if (typeof adminConnection !== 'string' || !adminConnection.trim()) {
      throw new Error(`${ENV_VAR} (${filePath}) pgBossConnectionConfig.adminConnection must be a non-empty string when pgBossConnectionConfig is present`);
    }
    result.pgBossConnectionConfig = { adminConnection };
  }

  // No success log here: core (bootstrapAppSecretsIfNeeded) already logs "[AppSecrets] Loaded via plugin".
  return result;
}
