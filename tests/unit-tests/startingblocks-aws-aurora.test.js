// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, test, expect } from '@jest/globals';
import { buildPostgresAdminConnection } from '../../src/config/startingblocks-aws-aurora.js';

describe('buildPostgresAdminConnection', () => {
  const secret = {
    host: 'cluster.aws.com',
    port: 5432,
    username: 'master',
    password: 'secret'
  };

  test('builds connection string for arbitrary database name', () => {
    const conn = buildPostgresAdminConnection(secret, 'pgboss_db', {});
    expect(conn).toContain('database=pgboss_db');
    expect(conn).toContain('host=cluster.aws.com');
    expect(conn).toContain('sslmode=require');
    expect(conn.endsWith(';')).toBe(true);
  });

  test('matches tenant map style for admin_* database', () => {
    const conn = buildPostgresAdminConnection(secret, 'admin_SchoolA', {});
    expect(conn).toContain('database=admin_SchoolA');
  });

  test('honors pool and suffix env like tenant builder', () => {
    const env = {
      MAX_POOL_SIZE: '100',
      CONNECTION_IDLE_LIFETIME: '300',
      TENANTS_CONNECTION_STRING_SUFFIX: 'sslmode=no-verify'
    };
    const conn = buildPostgresAdminConnection(secret, 'db1', env);
    expect(conn).toContain('Maximum Pool Size=100');
    expect(conn).toContain('Connection Idle Lifetime=300');
    expect(conn).toContain('sslmode=no-verify');
  });
});
