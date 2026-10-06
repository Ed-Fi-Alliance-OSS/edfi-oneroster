// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Single source of truth for database connection configuration.
 *
 * Every DB access path (Knex factory, ODS instances, EdFi_Admin lookups, ODS
 * context validation, pg-boss) builds its driver options here from a config
 * produced by parseConnectionString(), so transport security is applied the
 * same way everywhere:
 * - MSSQL: buildMssqlTlsOptions() (encrypt / trustServerCertificate / CA).
 * - PostgreSQL: the `ssl` value parseConnectionString() derived from the
 *   connection string's sslmode/sslrootcert/sslcert/sslkey.
 */

import { buildMssqlTlsOptions } from './mssql-tls.js';
import { buildRequestTimeoutOptions } from './db-timeouts.js';

/** Pool for the default (non-ODS) Knex instances. */
export const DEFAULT_POOL_OPTIONS = Object.freeze({
  min: 0,
  max: 10,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 30000,
  destroyTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 200
});

/** Small pool for EdFi_Admin lookups (OdsInstances, OdsInstanceContexts). */
export const ADMIN_POOL_OPTIONS = Object.freeze({
  min: 0,
  max: 5,
  acquireTimeoutMillis: 30000,
  idleTimeoutMillis: 30000
});

/** Pool for ODS connections, sized by DB_POOL_MAX / DB_POOL_IDLE_TIMEOUT_MS. */
export function getOdsPoolOptions() {
  return {
    min: 0,
    max: parseInt(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30000
  };
}

/** Acquire timeout for ODS connections, from DB_CONNECTION_TIMEOUT_MS. */
export function getOdsAcquireConnectionTimeout() {
  return parseInt(process.env.DB_CONNECTION_TIMEOUT_MS) || 60000;
}

function assertConnectionConfig(connectionConfig) {
  if (!connectionConfig || typeof connectionConfig !== 'object') {
    throw new Error('Database connection configuration is missing or invalid');
  }
}

/**
 * Plain node-postgres client options (no Knex-specific settings).
 * Used directly by pg-boss and as the base of the Knex pg connection.
 *
 * `ssl` is passed through whenever it was resolved, including an explicit
 * `false` (sslmode=disable/prefer/allow) so PGSSLMODE cannot re-enable TLS
 * behind the connection string's back.
 *
 * @param {Object} connectionConfig - output of parseConnectionString(..., 'postgres')
 */
export function buildPostgresClientOptions(connectionConfig) {
  assertConnectionConfig(connectionConfig);

  return {
    host: connectionConfig.host,
    port: connectionConfig.port,
    database: connectionConfig.database,
    user: connectionConfig.user,
    password: connectionConfig.password,
    ...(connectionConfig.ssl !== undefined && { ssl: connectionConfig.ssl })
  };
}

/**
 * Knex `connection` object for the given engine.
 *
 * @param {string} dbType - 'mssql' or 'postgres'
 * @param {Object} connectionConfig - output of parseConnectionString()
 */
export function buildKnexConnection(dbType, connectionConfig) {
  assertConnectionConfig(connectionConfig);

  if (dbType === 'mssql') {
    return {
      server: connectionConfig.server,
      database: connectionConfig.database,
      user: connectionConfig.user,
      password: connectionConfig.password,
      port: connectionConfig.port,
      options: {
        ...buildMssqlTlsOptions(connectionConfig),
        enableArithAbort: true,
        useUTC: false
      },
      connectionTimeout: 30000,
      ...buildRequestTimeoutOptions('mssql')
    };
  }

  return {
    ...buildPostgresClientOptions(connectionConfig),
    ...buildRequestTimeoutOptions('postgres')
  };
}

/**
 * Complete Knex configuration for the given engine.
 *
 * @param {string} dbType - 'mssql' or 'postgres'
 * @param {Object} connectionConfig - output of parseConnectionString()
 * @param {Object} [options]
 * @param {Object} [options.pool] - Knex pool settings (default DEFAULT_POOL_OPTIONS)
 * @param {number} [options.acquireConnectionTimeout] - default 30000
 * @param {Object} [options.extra] - additional top-level Knex settings (e.g. migrations)
 */
export function buildKnexConfig(dbType, connectionConfig, {
  pool = DEFAULT_POOL_OPTIONS,
  acquireConnectionTimeout = 30000,
  extra = {}
} = {}) {
  return {
    ...extra,
    client: dbType === 'mssql' ? 'mssql' : 'pg',
    pool: { ...pool },
    acquireConnectionTimeout,
    connection: buildKnexConnection(dbType, connectionConfig)
  };
}
