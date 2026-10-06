// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  ADMIN_POOL_OPTIONS,
  DEFAULT_POOL_OPTIONS,
  buildKnexConfig,
  buildKnexConnection,
  buildPostgresClientOptions,
  getOdsAcquireConnectionTimeout,
  getOdsPoolOptions
} from '../../src/config/db-connection.js';
import { parseConnectionString } from '../../src/config/multi-tenancy-config.js';
import { buildPostgresSslConfig } from '../../src/config/postgres-ssl.js';
import { logger } from '../../src/utils/logger.js';

const ENV_KEYS = ['DB_POOL_MAX', 'DB_POOL_IDLE_TIMEOUT_MS', 'DB_CONNECTION_TIMEOUT_MS', 'DB_REQUEST_TIMEOUT'];

describe('db-connection', () => {
  let savedEnv;
  let warnSpy;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    ENV_KEYS.forEach(k => delete process.env[k]);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    ENV_KEYS.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
    warnSpy.mockRestore();
  });

  describe('buildPostgresClientOptions', () => {
    const base = { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' };

    test('passes through an SSL object', () => {
      const ssl = { rejectUnauthorized: true };
      expect(buildPostgresClientOptions({ ...base, ssl })).toEqual({ ...base, ssl });
    });

    test('keeps an explicit ssl=false so PGSSLMODE cannot re-enable TLS', () => {
      expect(buildPostgresClientOptions({ ...base, ssl: false }).ssl).toBe(false);
    });

    test('omits ssl when none was resolved', () => {
      expect(buildPostgresClientOptions(base)).not.toHaveProperty('ssl');
    });

    test('applies SSL end to end from a connection string with sslmode=require', () => {
      const cfg = parseConnectionString('host=h;port=5432;database=d;username=u;password=p;sslmode=require', 'postgres');
      expect(buildPostgresClientOptions(cfg).ssl).toEqual({ rejectUnauthorized: true });
    });

    test.each([null, undefined, 'host=h;sslmode=require'])('rejects invalid config %p', (cfg) => {
      expect(() => buildPostgresClientOptions(cfg)).toThrow('Database connection configuration is missing or invalid');
    });
  });

  describe('buildKnexConnection', () => {
    test('postgres: includes SSL and statement_timeout', () => {
      const conn = buildKnexConnection('postgres', { host: 'h', port: 5432, ssl: { rejectUnauthorized: false } });
      expect(conn.ssl).toEqual({ rejectUnauthorized: false });
      expect(conn.statement_timeout).toBe(30000);
    });

    test('mssql: secure TLS defaults, requestTimeout and driver options', () => {
      const conn = buildKnexConnection('mssql', { server: 's', port: 1433, database: 'd' });
      expect(conn.options).toEqual({
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
        useUTC: false
      });
      expect(conn.requestTimeout).toBe(30000);
      expect(conn.connectionTimeout).toBe(30000);
    });
  });

  describe('buildKnexConfig', () => {
    test('defaults to the standard pool and 30s acquire timeout', () => {
      const cfg = buildKnexConfig('postgres', { host: 'h' });
      expect(cfg.client).toBe('pg');
      expect(cfg.pool).toEqual(DEFAULT_POOL_OPTIONS);
      expect(cfg.acquireConnectionTimeout).toBe(30000);
    });

    test('accepts pool, acquire timeout and extra settings', () => {
      const cfg = buildKnexConfig('mssql', { server: 's' }, {
        pool: ADMIN_POOL_OPTIONS,
        acquireConnectionTimeout: 1234,
        extra: { migrations: { tableName: 't' } }
      });
      expect(cfg.client).toBe('mssql');
      expect(cfg.pool).toEqual(ADMIN_POOL_OPTIONS);
      expect(cfg.acquireConnectionTimeout).toBe(1234);
      expect(cfg.migrations).toEqual({ tableName: 't' });
    });
  });

  describe('ODS pool options', () => {
    test('defaults', () => {
      expect(getOdsPoolOptions()).toEqual({ min: 0, max: 10, idleTimeoutMillis: 30000 });
      expect(getOdsAcquireConnectionTimeout()).toBe(60000);
    });

    test('reads environment overrides', () => {
      process.env.DB_POOL_MAX = '25';
      process.env.DB_POOL_IDLE_TIMEOUT_MS = '5000';
      process.env.DB_CONNECTION_TIMEOUT_MS = '15000';
      expect(getOdsPoolOptions()).toEqual({ min: 0, max: 25, idleTimeoutMillis: 5000 });
      expect(getOdsAcquireConnectionTimeout()).toBe(15000);
    });
  });
});

describe('buildPostgresSslConfig input guard', () => {
  test.each(['OdsContextValidation', 'host=h;sslmode=require', null, undefined])(
    'throws on non-object input %p instead of silently disabling SSL',
    (input) => {
      expect(() => buildPostgresSslConfig(input)).toThrow(TypeError);
    }
  );
});
