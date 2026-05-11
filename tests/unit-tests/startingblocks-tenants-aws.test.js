// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, test, expect } from '@jest/globals';
import { buildTenantsConnectionMap } from '../../src/config/startingblocks-tenants-aws.js';

describe('buildTenantsConnectionMap', () => {
  const secret = {
    host: 'cluster.aws.com',
    port: 5432,
    username: 'master',
    password: 'secret'
  };

  test('builds adminConnection per tenant with verbatim Name for database segment', () => {
    const env = {};
    const out = buildTenantsConnectionMap(['SchoolA', 'b'], secret, env);
    expect(Object.keys(out)).toEqual(['SchoolA', 'b']);
    expect(out.SchoolA.adminConnection).toContain('database=admin_SchoolA');
    expect(out.b.adminConnection).toContain('database=admin_b');
    expect(out.SchoolA.adminConnection).toContain('host=cluster.aws.com');
    expect(out.SchoolA.adminConnection).toContain('username=master');
    expect(out.SchoolA.adminConnection).toContain('password=secret');
    expect(out.SchoolA.adminConnection).toContain('sslmode=require');
  });

  test('includes pool options when MAX_POOL_SIZE and CONNECTION_IDLE_LIFETIME are set', () => {
    const env = { MAX_POOL_SIZE: '100', CONNECTION_IDLE_LIFETIME: '300' };
    const out = buildTenantsConnectionMap(['t1'], secret, env);
    expect(out.t1.adminConnection).toContain('Maximum Pool Size=100');
    expect(out.t1.adminConnection).toContain('Connection Idle Lifetime=300');
  });

  test('appends TENANTS_CONNECTION_STRING_SUFFIX', () => {
    const env = { TENANTS_CONNECTION_STRING_SUFFIX: 'sslmode=no-verify' };
    const out = buildTenantsConnectionMap(['x'], secret, env);
    expect(out.x.adminConnection).toContain('sslmode=no-verify');
    expect(out.x.adminConnection.endsWith(';')).toBe(true);
  });
});
