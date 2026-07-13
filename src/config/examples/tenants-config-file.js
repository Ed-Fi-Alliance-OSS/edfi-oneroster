// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Example tenant-configuration plugin (reference/documentation only).
 *
 * Demonstrates the TENANTS_CONFIG_MODULE contract (see docs/tenants-config-plugin.md)
 * with no external dependency: it reads the tenant map from a JSON file whose path is
 * given by the TENANTS_CONFIG_FILE environment variable. A production plugin would
 * instead fetch tenant names and credentials from a secrets manager or directory
 * service rather than from a file on disk.
 *
 * Enable with:
 *   MULTITENANCY_ENABLED=true
 *   TENANTS_CONFIG_MODULE=./src/config/examples/tenants-config-file.js
 *   TENANTS_CONFIG_FILE=/secure/path/tenants.json
 *
 * The file uses the same shape as TENANTS_CONNECTION_CONFIG, e.g.:
 *   {
 *     "Tenant1": { "adminConnection": "host=...;database=EdFi_Admin_Tenant1;username=...;password=..." }
 *   }
 * Each value may also carry an optional `OdsInstances` map (same shape as
 * TENANTS_CONNECTION_CONFIG) to resolve ODS connections directly instead of querying
 * the tenant's EdFi_Admin database.
 *
 * The file is re-read on every call, so SIGUSR2 (`kill -USR2 <pid>`) reloads edits without a restart.
 */

import { readFile } from 'node:fs/promises';

const ENV_VAR = 'TENANTS_CONFIG_FILE';

/**
 * @returns {Promise<Record<string, { adminConnection: string, OdsInstances?: object }>>}
 */
export async function loadTenantsConfig() {
  const filePath = (process.env[ENV_VAR] || '').trim();
  if (!filePath) {
    throw new Error(`${ENV_VAR} must be set for the example tenant configuration plugin`);
  }

  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${ENV_VAR} (${filePath}): ${error.message}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${ENV_VAR} (${filePath}) must contain valid JSON: ${error.message}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${ENV_VAR} (${filePath}) must contain a JSON object mapping tenant IDs to { adminConnection }`);
  }

  return config;
}
