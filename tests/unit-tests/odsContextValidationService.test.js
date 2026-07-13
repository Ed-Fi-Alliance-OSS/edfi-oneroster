// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the dynamic import
// ---------------------------------------------------------------------------
const mockGetConnectionConfig = jest.fn();
const mockGetOdsInstances = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  getConnectionConfig: mockGetConnectionConfig,
  getOdsInstances: mockGetOdsInstances,
}));

const mockKnexFactory = jest.fn();
jest.unstable_mockModule('knex', () => ({ default: mockKnexFactory }));

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------
let getValidContextValues;
let validateContextValueFromDatabase;
let closeAdminConnections;

beforeAll(async () => {
  ({
    getValidContextValues,
    validateContextValueFromDatabase,
    closeAdminConnections,
  } = await import('../../src/services/odsContextValidationService.js'));
});

// ---------------------------------------------------------------------------
// Helper: build a knex mock whose chaining methods all return `this` so every
// query pattern works, with `distinct` and `first` resolving to `queryResult`.
// ---------------------------------------------------------------------------
function buildKnexMock(queryResult = null) {
  const distinct = jest.fn().mockResolvedValue(queryResult);
  const first = jest.fn().mockResolvedValue(queryResult);
  const destroy = jest.fn().mockResolvedValue(undefined);

  const chain = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    distinct,
    first,
  };

  const dbInstance = Object.assign(jest.fn().mockReturnValue(chain), { destroy });
  mockKnexFactory.mockReturnValue(dbInstance);
  return { dbInstance, chain, distinct, first, destroy };
}

// ---------------------------------------------------------------------------
describe('odsContextValidationService', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DB_TYPE = 'postgres';
    mockGetConnectionConfig.mockReset();
    mockGetOdsInstances.mockReset();
    mockKnexFactory.mockReset();
  });

  afterEach(async () => {
    // Reset module-level adminConnections cache between tests
    await closeAdminConnections();
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  // -------------------------------------------------------------------------
  describe('getValidContextValues', () => {
    test('returns context values from external ODS instances config when available', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { schoolYear: '2024' } },
        '2': { ContextValueByKey: { schoolYear: '2025' } },
      });

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual(expect.arrayContaining(['2024', '2025']));
      expect(mockKnexFactory).not.toHaveBeenCalled();
    });

    test('returns deduplicated values when multiple instances share the same context value', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { schoolYear: '2024' } },
        '2': { ContextValueByKey: { schoolYear: '2024' } },
      });

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual(['2024']);
    });

    test('falls back to the database when external config has no matching context key', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { otherKey: 'value' } },
      });
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock([{ contextvalue: '2024' }, { contextvalue: '2025' }]);

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual(['2024', '2025']);
    });

    test('falls back to the database when external config is null', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock([{ contextvalue: '2024' }]);

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual(['2024']);
    });

    test('returns an empty array when the database query returns no rows', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock([]);

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual([]);
    });

    test('returns an empty array when the database query throws', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      const { chain } = buildKnexMock();
      chain.distinct.mockRejectedValue(new Error('db error'));

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual([]);
    });

    test('passes tenantId to getOdsInstances', async () => {
      mockGetOdsInstances.mockReturnValue({ '1': { ContextValueByKey: { schoolYear: '2024' } } });

      await getValidContextValues('schoolYear', 'myTenant');

      expect(mockGetOdsInstances).toHaveBeenCalledWith('myTenant');
    });

    test('coerces context values to strings', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { schoolYear: 2024 } }, // number, not string
      });

      const result = await getValidContextValues('schoolYear');

      expect(result).toEqual(['2024']);
    });
  });

  // -------------------------------------------------------------------------
  describe('validateContextValueFromDatabase', () => {
    test('returns true when the context value is found in external config', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { schoolYear: '2024' } },
      });

      const result = await validateContextValueFromDatabase('schoolYear', '2024');

      expect(result).toBe(true);
      expect(mockKnexFactory).not.toHaveBeenCalled();
    });

    test('returns false when external config exists but value is not present', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { schoolYear: '2024' } },
      });
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock(null); // DB also returns nothing

      const result = await validateContextValueFromDatabase('schoolYear', '9999');

      expect(result).toBe(false);
    });

    test('returns true when found in the database after external config miss', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock({ contextkey: 'schoolYear', contextvalue: '2024' });

      const result = await validateContextValueFromDatabase('schoolYear', '2024');

      expect(result).toBe(true);
    });

    test('returns false when the database query returns null', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock(null);

      const result = await validateContextValueFromDatabase('schoolYear', '9999');

      expect(result).toBe(false);
    });

    test('returns false when the database query throws', async () => {
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      const { chain } = buildKnexMock();
      chain.first.mockRejectedValue(new Error('connection refused'));

      const result = await validateContextValueFromDatabase('schoolYear', '2024');

      expect(result).toBe(false);
    });

    test('passes tenantId to getOdsInstances', async () => {
      mockGetOdsInstances.mockReturnValue({ '1': { ContextValueByKey: { schoolYear: '2024' } } });

      await validateContextValueFromDatabase('schoolYear', '2024', 'myTenant');

      expect(mockGetOdsInstances).toHaveBeenCalledWith('myTenant');
    });

    test('returns false when value casing does not match external config', async () => {
      mockGetOdsInstances.mockReturnValue({
        '1': { ContextValueByKey: { schoolYear: 'Spring2024' } },
      });
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      buildKnexMock(null);

      // 'spring2024' (lowercase) should not match 'Spring2024' (mixed case) in external config
      const result = await validateContextValueFromDatabase('schoolYear', 'spring2024');

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('closeAdminConnections', () => {
    test('resolves without error when no connections are cached', async () => {
      await expect(closeAdminConnections()).resolves.toBeUndefined();
    });

    test('calls destroy on all cached connections', async () => {
      // Force a DB connection into the cache
      mockGetOdsInstances.mockReturnValue(null);
      mockGetConnectionConfig.mockReturnValue({ host: 'adminhost', port: 5432, user: 'u', password: 'p', database: 'EdFi_Admin' });
      const { destroy } = buildKnexMock([]);

      await getValidContextValues('schoolYear', null, 'postgres');
      await closeAdminConnections();

      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });
});
