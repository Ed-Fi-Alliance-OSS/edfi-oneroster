// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helper: create a valid IV|CipherText|HMAC string using the same algorithm
// as OdsInstanceService.decryptConnectionString so round-trip tests are possible.
// ---------------------------------------------------------------------------
function encryptForTest(plainText, keyBuffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plainText, 'utf8')),
    cipher.final(),
  ]);
  const hmac = crypto.createHmac('sha256', keyBuffer);
  hmac.update(enc);
  const sig = hmac.digest();
  return `${iv.toString('base64')}|${enc.toString('base64')}|${sig.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the dynamic import
// ---------------------------------------------------------------------------
const mockGetOdsInstances = jest.fn();
const mockParseConnectionString = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  getOdsInstances: mockGetOdsInstances,
  parseConnectionString: mockParseConnectionString,
}));

const mockKnexFactory = jest.fn();
jest.unstable_mockModule('knex', () => ({ default: mockKnexFactory }));

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------
let OdsInstanceService;

beforeAll(async () => {
  ({ OdsInstanceService } = await import('../../src/services/database/OdsInstanceService.js'));
});

// ---------------------------------------------------------------------------
// Helper: build a fresh knex mock where each query chain resolves to `result`.
// ---------------------------------------------------------------------------
function buildKnexMock(queryResult = null) {
  const first = jest.fn().mockResolvedValue(queryResult);
  const where = jest.fn().mockReturnValue({ first });
  const select = jest.fn().mockReturnValue({ where });
  const destroy = jest.fn().mockResolvedValue(undefined);
  const dbInstance = Object.assign(jest.fn().mockReturnValue({ select }), { destroy });
  mockKnexFactory.mockReturnValue(dbInstance);
  return { dbInstance, select, where, first, destroy };
}

// ---------------------------------------------------------------------------
describe('OdsInstanceService', () => {
  let service;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    service = new OdsInstanceService();
    mockGetOdsInstances.mockReset();
    mockParseConnectionString.mockReset();
    mockKnexFactory.mockReset();
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  // -------------------------------------------------------------------------
  describe('getEncryptionKey', () => {
    test('throws when ODS_CONNECTION_STRING_ENCRYPTION_KEY is not set', () => {
      delete process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY;
      expect(() => service.getEncryptionKey()).toThrow('ODS_CONNECTION_STRING_ENCRYPTION_KEY not configured');
    });

    test('throws when key decodes to fewer than 32 bytes', () => {
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
      expect(() => service.getEncryptionKey()).toThrow('Invalid encryption key length');
    });

    test('throws when key decodes to more than 32 bytes', () => {
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = Buffer.alloc(64).toString('base64');
      expect(() => service.getEncryptionKey()).toThrow('Invalid encryption key length');
    });

    test('returns a 32-byte Buffer for a valid 256-bit key', () => {
      const key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
      const result = service.getEncryptionKey();
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(32);
    });

    test('returns the same Buffer reference on repeated calls (cached)', () => {
      const key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
      expect(service.getEncryptionKey()).toBe(service.getEncryptionKey());
    });
  });

  // -------------------------------------------------------------------------
  describe('isEncrypted', () => {
    test('returns false for a plain PostgreSQL connection string', () => {
      expect(service.isEncrypted('host=localhost;port=5432;database=db;username=u;password=p')).toBe(false);
    });

    test('returns false for a plain MSSQL connection string', () => {
      expect(service.isEncrypted('server=localhost;database=db;user id=sa;password=pass')).toBe(false);
    });

    test('returns false when there are fewer than two pipe characters', () => {
      expect(service.isEncrypted('justonepart')).toBe(false);
      expect(service.isEncrypted('a|b')).toBe(false);
    });

    test('returns false when there are more than two pipe characters', () => {
      expect(service.isEncrypted('a|b|c|d')).toBe(false);
    });

    test('returns false when pipe-delimited segments are not valid base64', () => {
      expect(service.isEncrypted('not b64|also not|nope!')).toBe(false);
    });

    test('returns false when any segment is empty', () => {
      expect(service.isEncrypted('|validb64==|validb64==')).toBe(false);
    });

    test('returns true for a genuine IV|CipherText|HMAC string', () => {
      const key = crypto.randomBytes(32);
      const encrypted = encryptForTest('connection-string', key);
      expect(service.isEncrypted(encrypted)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('decryptConnectionString', () => {
    let key;

    beforeEach(() => {
      key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
    });

    test('decrypts a validly-encrypted string back to the original plaintext', () => {
      const plain = 'host=odshost;database=EdFi_Ods;username=u;password=secret';
      const encrypted = encryptForTest(plain, key);
      expect(service.decryptConnectionString(encrypted)).toBe(plain);
    });

    test('throws when the string does not have exactly three pipe-delimited parts', () => {
      expect(() => service.decryptConnectionString('onlyone')).toThrow('Failed to decrypt');
      expect(() => service.decryptConnectionString('a|b')).toThrow('Failed to decrypt');
    });

    test('throws when the HMAC signature has been tampered with', () => {
      const encrypted = encryptForTest('original', key);
      const parts = encrypted.split('|');
      const hmacBuf = Buffer.from(parts[2], 'base64');
      hmacBuf[0] ^= 0xff; // flip one byte
      const tampered = `${parts[0]}|${parts[1]}|${hmacBuf.toString('base64')}`;
      expect(() => service.decryptConnectionString(tampered)).toThrow('Failed to decrypt');
    });

    test('throws when the encryption key env var is absent', () => {
      delete process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY;
      const otherKey = crypto.randomBytes(32);
      const encrypted = encryptForTest('conn', otherKey);
      expect(() => service.decryptConnectionString(encrypted)).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('getOdsInstanceFromExternalConfig', () => {
    test('returns null when getOdsInstances returns null', () => {
      mockGetOdsInstances.mockReturnValue(null);
      expect(service.getOdsInstanceFromExternalConfig(1)).toBeNull();
    });

    test('returns null when the ODS instance ID is not present in the config', () => {
      mockGetOdsInstances.mockReturnValue({ '2': { ConnectionString: 'cs' } });
      expect(service.getOdsInstanceFromExternalConfig(1)).toBeNull();
    });

    test('returns the instance config when the ID is found (numeric coercion)', () => {
      const instanceConfig = { ConnectionString: 'cs', Name: 'Ods' };
      mockGetOdsInstances.mockReturnValue({ '42': instanceConfig });
      expect(service.getOdsInstanceFromExternalConfig(42)).toEqual(instanceConfig);
    });

    test('passes tenantId through to getOdsInstances', () => {
      mockGetOdsInstances.mockReturnValue(null);
      service.getOdsInstanceFromExternalConfig(1, 'myTenant');
      expect(mockGetOdsInstances).toHaveBeenCalledWith('myTenant');
    });
  });

  // -------------------------------------------------------------------------
  describe('resolveFromExternalConfig', () => {
    test('returns null when odsInstanceConfig is null', () => {
      expect(service.resolveFromExternalConfig(null)).toBeNull();
    });

    test('returns null when odsInstanceConfig has no ConnectionString', () => {
      expect(service.resolveFromExternalConfig({})).toBeNull();
    });

    test('returns a plain connection string unchanged', () => {
      const config = { ConnectionString: 'host=localhost;database=EdFi_Ods' };
      expect(service.resolveFromExternalConfig(config)).toBe('host=localhost;database=EdFi_Ods');
    });

    test('decrypts and returns an encrypted connection string', () => {
      const key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
      const plain = 'host=dbhost;database=EdFi_Ods;username=u;password=p';
      const config = { ConnectionString: encryptForTest(plain, key) };
      expect(service.resolveFromExternalConfig(config)).toBe(plain);
    });

    test('propagates decryption errors instead of swallowing them', () => {
      const key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
      // Looks encrypted (3 valid base64 parts) but HMAC is wrong
      const fakeIv = Buffer.alloc(16).toString('base64');
      const fakeCipher = Buffer.alloc(32).toString('base64');
      const fakeHmac = Buffer.alloc(32).toString('base64');
      const config = { ConnectionString: `${fakeIv}|${fakeCipher}|${fakeHmac}` };
      expect(() => service.resolveFromExternalConfig(config)).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('resolveOdsConnectionString', () => {
    test('throws when odsInstanceId is not provided', async () => {
      await expect(
        service.resolveOdsConnectionString({ adminConnectionString: 'cs', dbType: 'postgres' })
      ).rejects.toThrow('OdsInstanceId is required');
    });

    test('resolves from external config when a matching instance is found', async () => {
      mockGetOdsInstances.mockReturnValue({
        '7': { ConnectionString: 'host=exthost;database=EdFi_Ods' },
      });
      const result = await service.resolveOdsConnectionString({
        adminConnectionString: 'cs',
        dbType: 'postgres',
        odsInstanceId: 7,
      });
      expect(result).toBe('host=exthost;database=EdFi_Ods');
      expect(mockKnexFactory).not.toHaveBeenCalled();
    });

    test('resolves an encrypted connection string from external config', async () => {
      const key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
      const plain = 'host=exthost;database=EdFi_Ods;username=u;password=secret';
      mockGetOdsInstances.mockReturnValue({ '7': { ConnectionString: encryptForTest(plain, key) } });
      const result = await service.resolveOdsConnectionString({
        adminConnectionString: 'cs',
        dbType: 'postgres',
        odsInstanceId: 7,
      });
      expect(result).toBe(plain);
    });

    test('falls back to the database when external config returns null', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({ host: 'adminhost', database: 'EdFi_Admin', port: 5432 });
      const { first } = buildKnexMock({ connectionstring: 'host=dbhost;database=EdFi_Ods' });
      const result = await service.resolveOdsConnectionString({
        adminConnectionString: 'host=adminhost;database=EdFi_Admin;username=u;password=p',
        dbType: 'postgres',
        odsInstanceId: 3,
      });
      expect(result).toBe('host=dbhost;database=EdFi_Ods');
      expect(first).toHaveBeenCalled();
    });

    test('decrypts an encrypted connection string returned from the database', async () => {
      const key = crypto.randomBytes(32);
      process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = key.toString('base64');
      const plain = 'host=odshost;database=EdFi_Ods;username=u;password=secret';
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({ host: 'adminhost' });
      buildKnexMock({ connectionstring: encryptForTest(plain, key) });
      const result = await service.resolveOdsConnectionString({
        adminConnectionString: 'cs',
        dbType: 'postgres',
        odsInstanceId: 1,
      });
      expect(result).toBe(plain);
    });

    test('throws when the database returns no matching instance', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({ host: 'adminhost' });
      buildKnexMock(null);
      await expect(
        service.resolveOdsConnectionString({ adminConnectionString: 'cs', dbType: 'postgres', odsInstanceId: 99 })
      ).rejects.toThrow('No ODS instance found');
    });

    test('throws when the database instance row has a null connection string', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({ host: 'adminhost' });
      buildKnexMock({ connectionstring: null });
      await expect(
        service.resolveOdsConnectionString({ adminConnectionString: 'cs', dbType: 'postgres', odsInstanceId: 5 })
      ).rejects.toThrow('has no connection string');
    });

    test('builds an MSSQL knex config when dbType is "mssql"', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({
        server: 'sqlhost', database: 'EdFi_Admin', user: 'sa', password: 'pass', port: 1433,
      });
      buildKnexMock({ connectionstring: 'server=odshost;database=EdFi_Ods' });
      const result = await service.resolveOdsConnectionString({
        adminConnectionString: 'server=sqlhost;database=EdFi_Admin;user id=sa;password=pass',
        dbType: 'mssql',
        odsInstanceId: 2,
      });
      expect(result).toBe('server=odshost;database=EdFi_Ods');
      const knexConfig = mockKnexFactory.mock.calls[0][0];
      expect(knexConfig.client).toBe('mssql');
    });

    test('caches admin connections so knex is only instantiated once per unique connection string', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({ host: 'adminhost' });
      const { first } = buildKnexMock({ connectionstring: 'host=ods;database=EdFi_Ods' });
      first.mockResolvedValue({ connectionstring: 'host=ods;database=EdFi_Ods' });

      const args = { adminConnectionString: 'host=adminhost;database=EdFi_Admin;username=u;password=p', dbType: 'postgres', odsInstanceId: 1 };
      await service.resolveOdsConnectionString(args);
      await service.resolveOdsConnectionString({ ...args, odsInstanceId: 2 });

      expect(mockKnexFactory).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('destroy', () => {
    test('calls destroy on all cached admin connections and clears the cache', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockParseConnectionString.mockReturnValue({ host: 'adminhost' });
      const { destroy, first } = buildKnexMock({ connectionstring: 'host=ods;database=EdFi_Ods' });

      await service.resolveOdsConnectionString({
        adminConnectionString: 'host=admin;database=EdFi_Admin;username=u;password=p',
        dbType: 'postgres',
        odsInstanceId: 1,
      });

      await service.destroy();
      expect(destroy).toHaveBeenCalledTimes(1);

      // Subsequent destroy should not error (cache is empty)
      await expect(service.destroy()).resolves.toBeUndefined();
    });
  });
});
