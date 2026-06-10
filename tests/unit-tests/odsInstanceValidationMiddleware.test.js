// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, beforeAll } from '@jest/globals';

const mockIsMultiTenancyEnabled = jest.fn();
const mockGetTenantsConfig = jest.fn();
const mockGetOdsContextConfig = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  isMultiTenancyEnabled: mockIsMultiTenancyEnabled,
  getTenantsConfig: mockGetTenantsConfig,
}));

jest.unstable_mockModule('../../src/config/ods-context-config.js', () => ({
  getOdsContextConfig: mockGetOdsContextConfig,
}));

let parseOdsInstances;
let validateTenantId;
let validateAndResolveOdsInstance;
let buildOdsCacheKey;
let validateOdsInstanceFlow;

beforeAll(async () => {
  ({
    parseOdsInstances,
    validateTenantId,
    validateAndResolveOdsInstance,
    buildOdsCacheKey,
    validateOdsInstanceFlow,
  } = await import('../../src/middleware/odsInstanceValidationMiddleware.js'));
});

function createResponseMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('odsInstanceValidationMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMultiTenancyEnabled.mockReturnValue(false);
    mockGetTenantsConfig.mockReturnValue({ tenant1: { connection: 'value' } });
    mockGetOdsContextConfig.mockReturnValue(null);
  });

  describe('parseOdsInstances', () => {
    test('returns empty array when payload is missing', () => {
      expect(parseOdsInstances(undefined)).toEqual([]);
    });

    test('returns empty array when odsInstances contains invalid JSON', () => {
      const result = parseOdsInstances({ odsInstances: 'not-json' });
      expect(result).toEqual([]);
    });

    test('returns OdsInstances array when JWT payload contains valid JSON', () => {
      const payload = {
        odsInstances: JSON.stringify({
          OdsInstances: [{ OdsInstanceId: 101 }, { OdsInstanceId: 202 }],
        }),
      };

      const result = parseOdsInstances(payload);
      expect(result).toEqual([{ OdsInstanceId: 101 }, { OdsInstanceId: 202 }]);
    });
  });

  describe('validateTenantId', () => {
    test('allows request when tenant is missing in single-tenant mode', () => {
      const req = { tenantId: undefined, auth: { payload: {} } };
      const res = createResponseMock();
      const next = jest.fn();

      validateTenantId(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('returns 404 when tenant is missing in multi-tenant mode', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      const req = { tenantId: undefined, auth: { payload: {} } };
      const res = createResponseMock();
      const next = jest.fn();

      validateTenantId(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 404 when tenant does not exist in config', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetTenantsConfig.mockReturnValue({ tenant2: { connection: 'x' } });
      const req = { tenantId: 'tenant1', auth: { payload: { tenantId: 'tenant1' } } };
      const res = createResponseMock();
      const next = jest.fn();

      validateTenantId(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when JWT tenant claim is missing for tenant route', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetTenantsConfig.mockReturnValue({ tenant1: { connection: 'x' } });
      const req = { tenantId: 'tenant1', auth: { payload: {} } };
      const res = createResponseMock();
      const next = jest.fn();

      validateTenantId(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when route tenant and JWT tenant do not match', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetTenantsConfig.mockReturnValue({ tenant1: { connection: 'x' } });
      const req = { tenantId: 'tenant1', auth: { payload: { tenantId: 'tenant2' } } };
      const res = createResponseMock();
      const next = jest.fn();

      validateTenantId(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('allows request when tenant exists and JWT tenant matches (case-insensitive)', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetTenantsConfig.mockReturnValue({ TENANT1: { connection: 'x' } });
      const req = { tenantId: 'tenant1', auth: { payload: { tenantId: 'Tenant1' } } };
      const res = createResponseMock();
      const next = jest.fn();

      validateTenantId(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('validateAndResolveOdsInstance', () => {
    test('calls next when JWT has no ODS instances', () => {
      const req = { auth: { payload: {} } };
      const res = createResponseMock();
      const next = jest.fn();

      validateAndResolveOdsInstance(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('sets req.odsInstanceId to first JWT ODS instance when context routing is disabled', () => {
      const req = {
        auth: {
          payload: {
            odsInstances: JSON.stringify({ OdsInstances: [{ OdsInstanceId: 77 }, { OdsInstanceId: 88 }] }),
          },
        },
      };
      const res = createResponseMock();
      const next = jest.fn();

      validateAndResolveOdsInstance(req, res, next);

      expect(req.odsInstanceId).toBe(77);
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('returns 400 when context routing is enabled and route context is missing', () => {
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      const req = {
        odsContext: undefined,
        auth: {
          payload: {
            odsInstances: JSON.stringify({ OdsInstances: [{ OdsInstanceId: 77 }] }),
          },
        },
      };
      const res = createResponseMock();
      const next = jest.fn();

      validateAndResolveOdsInstance(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when no ODS instance is authorized for route context', () => {
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      const req = {
        odsContext: '2025',
        auth: {
          payload: {
            odsInstances: JSON.stringify({
              OdsInstances: [
                {
                  OdsInstanceId: 77,
                  OdsInstanceContext: { ContextKey: 'schoolYear', ContextValue: '2024' },
                },
              ],
            }),
          },
        },
      };
      const res = createResponseMock();
      const next = jest.fn();

      validateAndResolveOdsInstance(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('sets req.odsInstanceId when route context matches an authorized ODS instance', () => {
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      const req = {
        tenantId: 'tenant1',
        odsContext: '2025',
        auth: {
          payload: {
            odsInstances: JSON.stringify({
              OdsInstances: [
                {
                  OdsInstanceId: 42,
                  OdsInstanceContext: { ContextKey: 'schoolYear', ContextValue: '2025' },
                },
              ],
            }),
          },
        },
      };
      const res = createResponseMock();
      const next = jest.fn();

      validateAndResolveOdsInstance(req, res, next);

      expect(req.odsInstanceId).toBe(42);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildOdsCacheKey', () => {
    test('returns null when odsInstanceId is missing', () => {
      const cacheKey = buildOdsCacheKey('tenant1', null, '2025');
      expect(cacheKey).toBeNull();
    });

    test('builds single-tenant cache key without context', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);
      expect(buildOdsCacheKey(null, 12, null)).toBe('odsinstance-12');
    });

    test('builds single-tenant cache key with context', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      expect(buildOdsCacheKey(null, 12, '2025')).toBe('odsinstance-12-context-2025');
    });

    test('builds multi-tenant cache key without context', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue(null);
      expect(buildOdsCacheKey('tenant1', 12, null)).toBe('tenant-tenant1-odsinstance-12');
    });

    test('builds multi-tenant cache key with context', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      expect(buildOdsCacheKey('tenant1', 12, '2025')).toBe('tenant-tenant1-odsinstance-12-context-2025');
    });

    test('uses fallback key when flow-specific requirements are not met', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({ parameterName: 'schoolYear' });
      expect(buildOdsCacheKey(null, 12, '2025')).toBe('odsinstance-12');
    });
  });

  describe('validateOdsInstanceFlow', () => {
    test('resolves odsInstanceId and attaches cache key for single-tenant no-context flow', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const req = {
        tenantId: undefined,
        odsContext: undefined,
        auth: {
          payload: {
            odsInstances: JSON.stringify({ OdsInstances: [{ OdsInstanceId: 321 }] }),
          },
        },
      };
      const res = createResponseMock();
      const next = jest.fn();

      validateOdsInstanceFlow(req, res, next);

      expect(req.odsInstanceId).toBe(321);
      expect(req.odsCacheKey).toBe('odsinstance-321');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('returns tenant validation error and does not call next when tenant is unauthorized', () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetTenantsConfig.mockReturnValue({ tenant1: { connection: 'x' } });

      const req = {
        tenantId: 'tenant1',
        auth: { payload: { tenantId: 'tenant2' } },
      };
      const res = createResponseMock();
      const next = jest.fn();

      validateOdsInstanceFlow(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
