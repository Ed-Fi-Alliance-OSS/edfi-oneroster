// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockParentQueryOne = jest.fn();
const mockParentQueryMany = jest.fn();

jest.unstable_mockModule('../../src/services/database/OneRosterQueryService.js', () => {
  class MockOneRosterQueryService {
    constructor(_knexInstance, _schema) {}
    async queryOne(...args) { return mockParentQueryOne(...args); }
    async queryMany(...args) { return mockParentQueryMany(...args); }
  }
  return { default: MockOneRosterQueryService };
});

const { default: MSSQLQueryService } = await import('../../src/services/database/MSSQLQueryService.js');

describe('MSSQLQueryService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MSSQLQueryService(null, 'oneroster12');
  });

  // ---------------------------------------------------------------------------
  describe('isJSONString', () => {
    test('returns false for null', () => {
      expect(service.isJSONString(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(service.isJSONString(undefined)).toBe(false);
    });

    test('returns false for a number', () => {
      expect(service.isJSONString(42)).toBe(false);
    });

    test('returns false for an object', () => {
      expect(service.isJSONString({})).toBe(false);
    });

    test('returns false for an empty string', () => {
      expect(service.isJSONString('')).toBe(false);
    });

    test('returns false for a whitespace-only string', () => {
      expect(service.isJSONString('   ')).toBe(false);
    });

    test('returns false for a plain word string', () => {
      expect(service.isJSONString('hello')).toBe(false);
    });

    test('returns false for a string that only starts with {', () => {
      expect(service.isJSONString('{no closing brace')).toBe(false);
    });

    test('returns false for a string that only ends with }', () => {
      expect(service.isJSONString('no opening brace}')).toBe(false);
    });

    test('returns true for an empty JSON object string', () => {
      expect(service.isJSONString('{}')).toBe(true);
    });

    test('returns true for an empty JSON array string', () => {
      expect(service.isJSONString('[]')).toBe(true);
    });

    test('returns true for a valid JSON object string', () => {
      expect(service.isJSONString('{"key":"value"}')).toBe(true);
    });

    test('returns true for a valid JSON array string', () => {
      expect(service.isJSONString('[1,2,3]')).toBe(true);
    });

    test('returns true for a JSON object string with surrounding whitespace', () => {
      expect(service.isJSONString('  { "key": "value" }  ')).toBe(true);
    });

    test('returns true for a string that looks like JSON but contains invalid content', () => {
      // isJSONString only checks delimiters, not validity
      expect(service.isJSONString('{bad json}')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('parseJSONFields', () => {
    test('returns null as-is', () => {
      expect(service.parseJSONFields(null, 'endpoint')).toBeNull();
    });

    test('returns undefined as-is', () => {
      expect(service.parseJSONFields(undefined, 'endpoint')).toBeUndefined();
    });

    test('returns a non-array value as-is', () => {
      expect(service.parseJSONFields('not an array', 'endpoint')).toBe('not an array');
    });

    test('returns an empty array unchanged', () => {
      expect(service.parseJSONFields([], 'endpoint')).toEqual([]);
    });

    test('parses a valid JSON object string field', () => {
      const input = [{ data: '{"name":"Alice"}' }];
      const result = service.parseJSONFields(input, 'orgs');
      expect(result[0].data).toEqual({ name: 'Alice' });
    });

    test('parses a valid JSON array string field', () => {
      const input = [{ tags: '["math","science"]' }];
      const result = service.parseJSONFields(input, 'courses');
      expect(result[0].tags).toEqual(['math', 'science']);
    });

    test('leaves a plain string field unchanged', () => {
      const input = [{ name: 'Alice' }];
      const result = service.parseJSONFields(input, 'users');
      expect(result[0].name).toBe('Alice');
    });

    test('leaves a null field value unchanged', () => {
      const input = [{ data: null }];
      const result = service.parseJSONFields(input, 'orgs');
      expect(result[0].data).toBeNull();
    });

    test('leaves an undefined field value unchanged', () => {
      const input = [{ data: undefined }];
      const result = service.parseJSONFields(input, 'orgs');
      expect(result[0].data).toBeUndefined();
    });

    test('leaves a malformed JSON string unchanged (parse error is caught)', () => {
      // Starts with { and ends with } so isJSONString returns true, but JSON.parse fails
      const input = [{ data: '{bad json}' }];
      const result = service.parseJSONFields(input, 'orgs');
      expect(result[0].data).toBe('{bad json}');
    });

    test('does not mutate the original record objects', () => {
      const record = { data: '{"key":"value"}' };
      const input = [record];
      service.parseJSONFields(input, 'orgs');
      // Original record should be unchanged
      expect(record.data).toBe('{"key":"value"}');
    });

    test('processes multiple records independently', () => {
      const input = [
        { data: '{"id":1}' },
        { data: null },
        { data: 'plain string' },
        { data: '{"id":2}' }
      ];
      const result = service.parseJSONFields(input, 'orgs');
      expect(result[0].data).toEqual({ id: 1 });
      expect(result[1].data).toBeNull();
      expect(result[2].data).toBe('plain string');
      expect(result[3].data).toEqual({ id: 2 });
    });

    test('parses multiple JSON fields within a single record', () => {
      const input = [{ meta: '{"page":1}', subjects: '["Math"]', name: 'Alice' }];
      const result = service.parseJSONFields(input, 'courses');
      expect(result[0].meta).toEqual({ page: 1 });
      expect(result[0].subjects).toEqual(['Math']);
      expect(result[0].name).toBe('Alice');
    });
  });

  // ---------------------------------------------------------------------------
  describe('queryOne', () => {
    test('returns null when super.queryOne returns null', async () => {
      mockParentQueryOne.mockResolvedValue(null);
      const result = await service.queryOne('users', 'abc-123');
      expect(result).toBeNull();
    });

    test('returns undefined when super.queryOne returns undefined', async () => {
      mockParentQueryOne.mockResolvedValue(undefined);
      const result = await service.queryOne('users', 'abc-123');
      expect(result).toBeUndefined();
    });

    test('returns an empty object parsed correctly when super.queryOne returns {}', async () => {
      mockParentQueryOne.mockResolvedValue({});
      const result = await service.queryOne('users', 'abc-123');
      expect(result).toEqual({});
    });

    test('returns a plain record unchanged when no JSON string fields are present', async () => {
      const record = { sourcedId: 'abc-123', name: 'Alice', status: 'active' };
      mockParentQueryOne.mockResolvedValue(record);
      const result = await service.queryOne('users', 'abc-123');
      expect(result).toEqual(record);
    });

    test('parses JSON string fields in the returned record', async () => {
      const record = { sourcedId: 'abc-123', metadata: '{"grade":5}' };
      mockParentQueryOne.mockResolvedValue(record);
      const result = await service.queryOne('users', 'abc-123');
      expect(result.metadata).toEqual({ grade: 5 });
      expect(result.sourcedId).toBe('abc-123');
    });

    test('leaves malformed JSON string fields unchanged', async () => {
      const record = { sourcedId: 'abc-123', metadata: '{not valid json}' };
      mockParentQueryOne.mockResolvedValue(record);
      const result = await service.queryOne('users', 'abc-123');
      expect(result.metadata).toBe('{not valid json}');
    });

    test('forwards all arguments to super.queryOne', async () => {
      mockParentQueryOne.mockResolvedValue(null);
      await service.queryOne('users', 'abc-123', { active: true }, [1, 2], ['name']);
      expect(mockParentQueryOne).toHaveBeenCalledWith(
        'users', 'abc-123', { active: true }, [1, 2], ['name']
      );
    });
  });
});
