// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Single source of truth for the per-query database timeout.
 *
 * `DB_REQUEST_TIMEOUT` (milliseconds) lets a deployment size the query timeout
 * to its dataset and infrastructure without a code change. `0` disables the
 * timeout on both engines.
 *
 * Engine mapping:
 * - MSSQL: `connection.requestTimeout` (tedious aborts the request client-side).
 * - PostgreSQL: `connection.statement_timeout` (the server cancels the
 *   statement). This is applied only when DB_REQUEST_TIMEOUT is set explicitly,
 *   because PostgreSQL connections have never carried a statement timeout here
 *   and silently capping queries on upgrade would break existing deployments.
 */

export const DEFAULT_DB_REQUEST_TIMEOUT_MS = 30000;

function readConfiguredTimeout() {
  return (process.env.DB_REQUEST_TIMEOUT || '').trim();
}

/**
 * Resolve the configured request timeout in milliseconds.
 * Falls back to DEFAULT_DB_REQUEST_TIMEOUT_MS when unset or unusable.
 * @returns {number}
 */
export function getDbRequestTimeoutMs() {
  const raw = readConfiguredTimeout();
  if (raw === '') {
    return DEFAULT_DB_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    // envValidator rejects this at startup; this guard covers connections
    // created by tooling that bypasses validation.
    console.error(
      `[Config] DB_REQUEST_TIMEOUT '${raw}' is not a non-negative integer - ` +
      `using ${DEFAULT_DB_REQUEST_TIMEOUT_MS}ms`
    );
    return DEFAULT_DB_REQUEST_TIMEOUT_MS;
  }

  return parsed;
}

/**
 * Build the engine-specific connection properties that carry the query timeout.
 * Spread into a Knex `connection` object.
 * @param {string} dbType - 'mssql' or 'postgres'
 * @returns {Object}
 */
export function buildRequestTimeoutOptions(dbType) {
  if (dbType === 'mssql') {
    return { requestTimeout: getDbRequestTimeoutMs() };
  }

  if (readConfiguredTimeout() === '') {
    return {};
  }

  return { statement_timeout: getDbRequestTimeoutMs() };
}
