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
 *   statement).
 *
 * The standard deployment scripts configure their own independent timeouts
 * (`MSSQL_REQUEST_TIMEOUT` and `PG_STATEMENT_TIMEOUT`) with separate defaults;
 * they are not governed by `DB_REQUEST_TIMEOUT`.
 *
 * Both engines get the same default so a query that is fatal on one is fatal on
 * the other. Leaving PostgreSQL unbounded pins a pool connection for as long as
 * the query runs, and the pool caps at DB_POOL_MAX (10 by default), so a handful
 * of runaway queries can stall the service. Deployments that genuinely need
 * unbounded queries set DB_REQUEST_TIMEOUT=0.
 */

import { getLogger } from '../utils/logger.js';

const logger = getLogger('DbTimeouts');

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
    logger.warn(
      `DB_REQUEST_TIMEOUT '${raw}' is not a non-negative integer - ` +
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
  const timeoutMs = getDbRequestTimeoutMs();

  if (dbType === 'mssql') {
    return { requestTimeout: timeoutMs };
  }

  // node-postgres skips a falsy statement_timeout, so 0 leaves the session at
  // the server's own statement_timeout - which is unlimited by default. That is
  // the intended meaning of 0, so it needs no special case here.
  return { statement_timeout: timeoutMs };
}
