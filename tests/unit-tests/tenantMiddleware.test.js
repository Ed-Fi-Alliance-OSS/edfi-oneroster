// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, beforeAll, afterEach } from '@jest/globals';

const mockIsMultiTenancyEnabled = jest.fn();
const mockGetOdsContextConfig = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  isMultiTenancyEnabled: mockIsMultiTenancyEnabled,
}));

jest.unstable_mockModule('../../src/config/ods-context-config.js', () => ({
  getOdsContextConfig: mockGetOdsContextConfig,
}));

let extractTenantMiddleware;
let requireTenantMiddleware;
let requireOdsInstanceMiddleware;
let extractOdsInstanceIdFromJwt;
let extractTenantFromRoute;
let extractOdsContextFromRoute;

beforeAll(async () => {
  ({
    extractTenantMiddleware,
    requireTenantMiddleware,
    requireOdsInstanceMiddleware,
    extractOdsInstanceIdFromJwt,
    extractTenantFromRoute,
    extractOdsContextFromRoute,
  } = await import('../../src/middleware/tenantMiddleware.js'));
});

function createResponseMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('tenantMiddleware', () => {
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMultiTenancyEnabled.mockReturnValue(false);
    mockGetOdsContextConfig.mockReturnValue(null);

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('extractOdsInstanceIdFromJwt', () => {
    test('returns null when auth payload is missing', () => {
      expect(extractOdsInstanceIdFromJwt({})).toBeNull();
    });

    test('extracts odsInstanceId from payload.odsInstanceId', () => {
      const req = { auth: { payload: { odsInstanceId: '101' } } };
      expect(extractOdsInstanceIdFromJwt(req)).toBe(101);
    });

    test('extracts odsInstanceId from payload.ods_instance_id', () => {
      const req = { auth: { payload: { ods_instance_id: '202' } } };
      expect(extractOdsInstanceIdFromJwt(req)).toBe(202);
    });

    test('extracts odsInstanceId from payload.OdsInstanceId', () => {
      const req = { auth: { payload: { OdsInstanceId: '303' } } };
      expect(extractOdsInstanceIdFromJwt(req)).toBe(303);
    });

    test('returns null when no recognized ODS instance claim exists', () => {
      const req = { auth: { payload: { tenantId: 'tenant1' } } };
      expect(extractOdsInstanceIdFromJwt(req)).toBeNull();
    });
  });

  describe('extractTenantFromRoute', () => {
    test('returns route tenantId when present', () => {
      expect(extractTenantFromRoute({ params: { tenantId: 'tenant-a' } })).toBe('tenant-a');
    });

    test('returns null when route tenantId is missing', () => {
      expect(extractTenantFromRoute({ params: {} })).toBeNull();
    });
  });

  describe('extractOdsContextFromRoute', () => {
    test('returns null when no ODS context config exists', () => {
      mockGetOdsContextConfig.mockReturnValue(null);
      expect(extractOdsContextFromRoute({ params: { schoolYear: '2025' } })).toBeNull();
    });

    test('returns context value from configured route parameter', () => {
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      const req = { params: { schoolYear: '2025' } };
      expect(extractOdsContextFromRoute(req)).toBe('2025');
    });

    test('returns null when configured route parameter is not present', () => {
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      const req = { params: {} };
      expect(extractOdsContextFromRoute(req)).toBeNull();
    });
  });

  describe('extractTenantMiddleware', () => {
    test('extracts odsInstanceId and context in single-tenant mode and calls next', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });

      const req = {
        params: { schoolYear: '2026' },
        auth: { payload: { odsInstanceId: '99' } },
      };
      const res = createResponseMock();
      const next = jest.fn();

      extractTenantMiddleware(req, res, next);

      expect(req.odsInstanceId).toBe(99);
      expect(req.tenantId).toBeNull();
      expect(req.odsContext).toBe('2026');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('returns 401 in multi-tenant mode when JWT tenant claim is missing', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);

      const req = {
        params: { tenantId: 'tenant1' },
        auth: { payload: { odsInstanceId: '11' } },
      };
      const res = createResponseMock();
      const next = jest.fn();

      extractTenantMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 in multi-tenant mode when JWT tenant does not match route tenant', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);

      const req = {
        params: { tenantId: 'tenant1' },
        auth: { payload: { odsInstanceId: '11', tenantId: 'tenant2' } },
      };
      const res = createResponseMock();
      const next = jest.fn();

      extractTenantMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('sets tenantId and calls next in multi-tenant mode when JWT tenant matches route tenant', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });

      const req = {
        params: { tenantId: 'tenant1', schoolYear: '2027' },
        auth: { payload: { odsInstanceId: '123', tenantId: 'tenant1' } },
      };
      const res = createResponseMock();
      const next = jest.fn();

      extractTenantMiddleware(req, res, next);

      expect(req.odsInstanceId).toBe(123);
      expect(req.tenantId).toBe('tenant1');
      expect(req.odsContext).toBe('2027');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('requireOdsInstanceMiddleware', () => {
    test('returns 403 when req.odsInstanceId is missing', () => {
      const req = { odsInstanceId: null };
      const res = createResponseMock();
      const next = jest.fn();

      requireOdsInstanceMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('calls next when req.odsInstanceId exists', () => {
      const req = { odsInstanceId: 1 };
      const res = createResponseMock();
      const next = jest.fn();

      requireOdsInstanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('requireTenantMiddleware', () => {
    test('returns 400 when multi-tenancy is enabled and tenantId is missing', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      const req = { tenantId: null };
      const res = createResponseMock();
      const next = jest.fn();

      requireTenantMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    test('calls next when multi-tenancy is disabled even if tenantId is missing', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      const req = { tenantId: null };
      const res = createResponseMock();
      const next = jest.fn();

      requireTenantMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('calls next when tenantId exists in multi-tenant mode', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      const req = { tenantId: 'tenant1' };
      const res = createResponseMock();
      const next = jest.fn();

      requireTenantMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
