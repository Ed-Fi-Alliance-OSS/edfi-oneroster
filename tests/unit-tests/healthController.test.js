// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing the controller
const mockRaw = jest.fn();
const mockGetAdminConnection = jest.fn(() => ({ raw: mockRaw }));
const mockIsMultiTenancyEnabled = jest.fn();
const mockGetTenantsConfig = jest.fn();
const mockGetAdminConnectionString = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  getAdminConnectionString: mockGetAdminConnectionString,
  isMultiTenancyEnabled: mockIsMultiTenancyEnabled,
  getTenantsConfig: mockGetTenantsConfig,
}));

jest.unstable_mockModule('../../src/services/database/OdsInstanceService.js', () => ({
  odsInstanceService: { getAdminConnection: mockGetAdminConnection },
}));

const { list } = await import('../../src/controllers/healthController.js');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('healthController', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  describe('single-tenant mode', () => {
    beforeEach(() => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetAdminConnectionString.mockReturnValue('host=localhost;database=EdFi_Admin');
    });

    test('returns 200 with status pass when DB is reachable', async () => {
      mockRaw.mockResolvedValue([{ test: 1 }]);
      const req = {};
      const res = createRes();

      await list(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: 'pass', mode: 'single-tenant' });
    });

    test('returns 503 with generic error when DB is unreachable', async () => {
      mockRaw.mockRejectedValue(new Error('Connection refused to host 10.0.0.1:5432'));
      const req = {};
      const res = createRes();

      await list(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.status).toBe('fail');
      expect(jsonArg.error).toBe('database unreachable');
    });

    test('does not expose raw DB error messages in the response', async () => {
      const sensitiveMessage = 'Connection refused to host 192.168.1.100:5432 — secret db details';
      mockRaw.mockRejectedValue(new Error(sensitiveMessage));
      const req = {};
      const res = createRes();

      await list(req, res);

      const jsonArg = res.json.mock.calls[0][0];
      expect(JSON.stringify(jsonArg)).not.toContain(sensitiveMessage);
      expect(jsonArg.message).toBeUndefined();
    });
  });

  describe('multi-tenant mode', () => {
    beforeEach(() => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetTenantsConfig.mockReturnValue({
        acme: { adminConnection: 'conn1' },
        beta: { adminConnection: 'conn2' },
      });
      mockGetAdminConnectionString.mockReturnValue('some-connection-string');
    });

    test('returns 200 with pass status when all tenant DBs are reachable', async () => {
      mockRaw.mockResolvedValue([{ test: 1 }]);
      const req = {};
      const res = createRes();

      await list(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: 'pass', mode: 'multi-tenant' });
    });

    test('returns 503 with fail status when any tenant DB is unreachable', async () => {
      mockRaw
        .mockResolvedValueOnce([{ test: 1 }])
        .mockRejectedValueOnce(new Error('Connection failed for beta tenant'));
      const req = {};
      const res = createRes();

      await list(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ status: 'fail', mode: 'multi-tenant' });
    });

    test('does not expose tenant IDs in the response', async () => {
      mockRaw.mockResolvedValue([{ test: 1 }]);
      const req = {};
      const res = createRes();

      await list(req, res);

      const jsonArg = res.json.mock.calls[0][0];
      const jsonStr = JSON.stringify(jsonArg);
      expect(jsonStr).not.toContain('acme');
      expect(jsonStr).not.toContain('beta');
    });

    test('does not expose raw DB error messages in per-tenant failures', async () => {
      const sensitiveError = 'password authentication failed for user "admin" host=secret-host';
      mockRaw
        .mockResolvedValueOnce([{ test: 1 }])
        .mockRejectedValueOnce(new Error(sensitiveError));
      const req = {};
      const res = createRes();

      await list(req, res);

      const jsonArg = res.json.mock.calls[0][0];
      expect(JSON.stringify(jsonArg)).not.toContain(sensitiveError);
    });

    test('returns 503 when tenantsConfig is null', async () => {
      mockGetTenantsConfig.mockReturnValue(null);
      const req = {};
      const res = createRes();

      await list(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.status).toBe('fail');
      expect(jsonArg.message).toBeUndefined();
    });
  });
});
