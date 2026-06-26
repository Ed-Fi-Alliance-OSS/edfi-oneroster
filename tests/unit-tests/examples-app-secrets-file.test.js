// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { describe, test, expect, afterEach } from '@jest/globals';
import { loadAppSecrets } from '../../src/config/examples/app-secrets-file.js';

describe('example app-secrets-file plugin', () => {
  let dir;

  afterEach(async () => {
    delete process.env.APP_SECRETS_FILE;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  async function writeSecrets(contents) {
    dir = await mkdtemp(path.join(os.tmpdir(), 'app-secrets-'));
    const file = path.join(dir, 'app-secrets.json');
    await writeFile(file, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
    return file;
  }

  const validSecrets = {
    odsConnectionStringEncryptionKey: 'base64key==',
    oauth2PublicKeyPem: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n'
  };

  test('loads the required secrets from the JSON file', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets(validSecrets);

    const result = await loadAppSecrets();

    expect(result.odsConnectionStringEncryptionKey).toBe('base64key==');
    expect(result.oauth2PublicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(result.pgBossConnectionConfig).toBeUndefined();
  });

  test('includes pgBossConnectionConfig when present', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets({
      ...validSecrets,
      pgBossConnectionConfig: { adminConnection: 'host=db;database=pgboss;username=u;password=p' }
    });

    const result = await loadAppSecrets();

    expect(result.pgBossConnectionConfig).toEqual({ adminConnection: 'host=db;database=pgboss;username=u;password=p' });
  });

  test('throws when APP_SECRETS_FILE is not set', async () => {
    delete process.env.APP_SECRETS_FILE;
    await expect(loadAppSecrets()).rejects.toThrow('APP_SECRETS_FILE must be set');
  });

  test('throws when the file does not exist', async () => {
    process.env.APP_SECRETS_FILE = path.join(os.tmpdir(), 'app-secrets-does-not-exist-7b2e9d.json');
    await expect(loadAppSecrets()).rejects.toThrow('Failed to read APP_SECRETS_FILE');
  });

  test('throws when the file is not valid JSON', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets('{ not json');
    await expect(loadAppSecrets()).rejects.toThrow('must contain valid JSON');
  });

  test('throws when the JSON is not an object', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets('[]');
    await expect(loadAppSecrets()).rejects.toThrow('must contain a JSON object');
  });

  test('throws when odsConnectionStringEncryptionKey is missing', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets({ oauth2PublicKeyPem: 'pem' });
    await expect(loadAppSecrets()).rejects.toThrow('odsConnectionStringEncryptionKey');
  });

  test('throws when oauth2PublicKeyPem is missing', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets({ odsConnectionStringEncryptionKey: 'key' });
    await expect(loadAppSecrets()).rejects.toThrow('oauth2PublicKeyPem');
  });

  test('throws when pgBossConnectionConfig is present but adminConnection is empty', async () => {
    process.env.APP_SECRETS_FILE = await writeSecrets({
      ...validSecrets,
      pgBossConnectionConfig: { adminConnection: '   ' }
    });
    await expect(loadAppSecrets()).rejects.toThrow('pgBossConnectionConfig.adminConnection');
  });
});
