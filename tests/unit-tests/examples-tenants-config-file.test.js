// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { describe, test, expect, afterEach } from '@jest/globals';
import { loadTenantsConfig } from '../../src/config/examples/tenants-config-file.js';

describe('example tenants-config-file plugin', () => {
  let dir;

  afterEach(async () => {
    delete process.env.TENANTS_CONFIG_FILE;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  async function writeConfig(contents) {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tenants-cfg-'));
    const file = path.join(dir, 'tenants.json');
    await writeFile(file, contents, 'utf8');
    return file;
  }

  test('loads the tenant map from the JSON file', async () => {
    process.env.TENANTS_CONFIG_FILE = await writeConfig(
      JSON.stringify({
        Tenant1: { adminConnection: 'host=db;database=EdFi_Admin_Tenant1;username=u;password=p' },
        Tenant2: { adminConnection: 'host=db;database=EdFi_Admin_Tenant2;username=u;password=p' }
      })
    );

    const config = await loadTenantsConfig();

    expect(Object.keys(config)).toEqual(['Tenant1', 'Tenant2']);
    expect(config.Tenant1.adminConnection).toContain('database=EdFi_Admin_Tenant1');
  });

  test('throws when TENANTS_CONFIG_FILE is not set', async () => {
    delete process.env.TENANTS_CONFIG_FILE;
    await expect(loadTenantsConfig()).rejects.toThrow('TENANTS_CONFIG_FILE must be set');
  });

  test('throws when the file does not exist', async () => {
    process.env.TENANTS_CONFIG_FILE = path.join(os.tmpdir(), 'tenants-does-not-exist-9f3c1a.json');
    await expect(loadTenantsConfig()).rejects.toThrow('Failed to read TENANTS_CONFIG_FILE');
  });

  test('throws when the file is not valid JSON', async () => {
    process.env.TENANTS_CONFIG_FILE = await writeConfig('{ not json');
    await expect(loadTenantsConfig()).rejects.toThrow('must contain valid JSON');
  });

  test('throws when the JSON is not an object', async () => {
    process.env.TENANTS_CONFIG_FILE = await writeConfig('[]');
    await expect(loadTenantsConfig()).rejects.toThrow('must contain a JSON object');
  });
});
