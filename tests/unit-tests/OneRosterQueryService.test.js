// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock must be declared before importing the module under test
const mockAuthService = {
  getAuthorizationFilter: jest.fn().mockResolvedValue({
    field: 'educationOrganizationId',
    values: [123]
  }),
  applyAuthorizationFilter: jest.fn((query, filter) => {
    return query.whereIn(filter.field, filter.values);
  })
};

jest.unstable_mockModule('../../src/services/database/AuthorizationQueryService.js', () => {
  return {
    default: jest.fn().mockImplementation(() => mockAuthService)
  };
});

const { default: OneRosterQueryService } = await import('../../src/services/database/OneRosterQueryService.js');

describe('OneRosterQueryService', () => {
  let mockKnex;

  beforeEach(() => {
    // Reset mock function call counts
    jest.clearAllMocks();
    // Create mock query builder
    const mockQuery = {
      withSchema: jest.fn().mockReturnThis(),
      table: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      where: jest.fn(function(callback) {
        // Execute callback if provided (needed for validation tests)
        if (typeof callback === 'function') {
          callback(this);
        }
        return this;
      }),
      orWhere: jest.fn(function(callback) {
        if (typeof callback === 'function') {
          callback(this);
        }
        return this;
      }),
      whereNot: jest.fn().mockReturnThis(),
      whereRaw: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis()
    };

    mockQuery.then = jest.fn((resolve) => {
      resolve([]);
      return Promise.resolve([]);
    });

    mockKnex = jest.fn(() => mockQuery);
    mockKnex.withSchema = jest.fn(() => mockQuery);
    mockKnex.raw = jest.fn().mockResolvedValue({ rows: [{ result: 1 }] });
    mockKnex.destroy = jest.fn().mockResolvedValue(true);
    mockKnex.schema = {
      withSchema: jest.fn(() => ({
        hasTable: jest.fn().mockResolvedValue(true)
      }))
    };

    // Reset mockAuthService for each test
    mockAuthService.getAuthorizationFilter.mockResolvedValue({
      field: 'educationOrganizationId',
      values: [123]
    });
  });

  describe('Constructor', () => {
    test('should initialize with knex instance and default schema', () => {
      const service = new OneRosterQueryService(mockKnex);

      expect(service.knex).toBe(mockKnex);
      expect(service.schema).toBe('oneroster12');
      expect(service.allowedPredicates).toEqual(['=', '!=', '>', '>=', '<', '<=', '~']);
      expect(service.MAX_FILTER_VALUE_LENGTH).toBe(250);
      expect(service.MAX_FILTER_CLAUSES).toBe(20);
    });

    test('should initialize with custom schema', () => {
      const service = new OneRosterQueryService(mockKnex, 'custom_schema');

      expect(service.schema).toBe('custom_schema');
    });

    test('should initialize authorization service', () => {
      const service = new OneRosterQueryService(mockKnex);

      expect(service.authService).toBeDefined();
    });
  });

  describe('baseQuery', () => {
    test('should create base query with schema and table', () => {
      const service = new OneRosterQueryService(mockKnex);
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis()
      };
      mockKnex.withSchema = jest.fn(() => mockQuery);

      service.baseQuery('users');

      expect(mockKnex.withSchema).toHaveBeenCalledWith('oneroster12');
      expect(mockQuery.table).toHaveBeenCalledWith('users');
    });
  });

  describe('createMissingAuthFilterError', () => {
    test('should create error with correct message and code', () => {
      const service = new OneRosterQueryService(mockKnex);

      const error = service.createMissingAuthFilterError('users');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Authorization filter missing');
      expect(error.message).toContain('users');
      expect(error.code).toBe('AUTH_FILTER_MISSING');
    });
  });

  describe('queryMany', () => {
    let service;
    let config;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
      service.authService = mockAuthService;

      config = {
        defaultSortField: 'sourcedId',
        selectableFields: ['sourcedId', 'name', 'status'],
        allowedFilterFields: ['status', 'name']
      };
    });

    test('should return empty array when no education organization IDs provided', async () => {
      const result = await service.queryMany('users', config, {}, null, []);

      expect(result).toEqual([]);
    });

    test('should apply field selection', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([{ sourcedId: '123', name: 'Test' }]);
          return Promise.resolve([{ sourcedId: '123', name: 'Test' }]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const queryParams = { fields: 'sourcedId,name' };
      await service.queryMany('users', config, queryParams, null, [123]);

      expect(mockQuery.select).toHaveBeenCalledWith(['sourcedId', 'name']);
    });

    test('should apply default field selection when fields=*', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      await service.queryMany('users', config, {}, null, [123]);

      expect(mockQuery.select).toHaveBeenCalledWith(config.selectableFields);
    });

    test('should apply authorization filter', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      await service.queryMany('users', config, {}, null, [123, 456]);

      expect(mockAuthService.getAuthorizationFilter).toHaveBeenCalledWith('users', [123, 456]);
      expect(mockAuthService.applyAuthorizationFilter).toHaveBeenCalled();
    });

    test('should throw error when auth filter missing but edOrg IDs provided', async () => {
      mockAuthService.getAuthorizationFilter.mockResolvedValue(null);

      await expect(
        service.queryMany('users', config, {}, null, [123])
      ).rejects.toThrow(/Authorization filter missing for endpoint 'users'/);
    });

    test('should apply OneRoster filters wrapped in where group', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        where: jest.fn(function(callback) {
          if (typeof callback === 'function') {
            callback(this);
          }
          return this;
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const queryParams = { filter: "status='active'" };
      await service.queryMany('users', config, queryParams, null, [123]);

      expect(mockQuery.where).toHaveBeenCalled();
    });

    test('should apply sorting', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const queryParams = { sort: 'name', orderBy: 'desc' };
      await service.queryMany('users', config, queryParams, null, [123]);

      expect(mockQuery.orderBy).toHaveBeenCalledWith('name', 'desc');
    });

    test('should apply pagination', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const queryParams = { limit: 50, offset: 100 };
      await service.queryMany('users', config, queryParams, null, [123]);

      expect(mockQuery.limit).toHaveBeenCalledWith(50);
      expect(mockQuery.offset).toHaveBeenCalledWith(100);
    });

    test('should strip null fields from results', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([{ sourcedId: '123', name: 'Test', middleName: null }]);
          return Promise.resolve([{ sourcedId: '123', name: 'Test', middleName: null }]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const result = await service.queryMany('users', config, {}, null, [123]);

      expect(result[0]).toEqual({ sourcedId: '123', name: 'Test' });
      expect(result[0].middleName).toBeUndefined();
    });
  });

  describe('queryOne', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
      service.authService = mockAuthService;
    });

    test('should return null when no education organization IDs provided', async () => {
      const result = await service.queryOne('users', '123', null, []);

      expect(result).toBeNull();
    });

    test('should query by sourcedId', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([{ sourcedId: '123', name: 'Test' }]);
          return Promise.resolve([{ sourcedId: '123', name: 'Test' }]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const result = await service.queryOne('users', '123', null, [123]);

      expect(mockQuery.where).toHaveBeenCalledWith('sourcedId', '123');
      expect(result).toEqual({ sourcedId: '123', name: 'Test' });
    });

    test('should apply field selection', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([{ sourcedId: '123' }]);
          return Promise.resolve([{ sourcedId: '123' }]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      await service.queryOne('users', '123', null, [123], ['sourcedId', 'name']);

      expect(mockQuery.select).toHaveBeenCalledWith(['sourcedId', 'name']);
    });

    test('should return null when record not found', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const result = await service.queryOne('users', '999', null, [123]);

      expect(result).toBeNull();
    });
  });

  describe('applyOneRosterFilters', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should return query unchanged when no filter', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis()
      };

      service.applyOneRosterFilters(mockQuery, '', ['status']);

      expect(mockQuery.where).not.toHaveBeenCalled();
    });

    test('should throw error for disallowed field', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis()
      };

      expect(() => {
        service.applyOneRosterFilters(mockQuery, "invalidField='test'", ['status']);
      }).toThrow('not allowed for filtering');
    });

    test('should apply simple equality filter', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis()
      };

      service.applyOneRosterFilters(mockQuery, "status='active'", ['status']);

      expect(mockQuery.where).toHaveBeenCalled();
    });

    test('should apply AND filters', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };

      service.applyOneRosterFilters(mockQuery, "status='active' AND name='Test'", ['status', 'name']);

      expect(mockQuery.where).toHaveBeenCalled();
    });

    test('should apply OR filters within subquery', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn(function(callback) {
          if (typeof callback === 'function') {
            callback(this);
          }
          return this;
        })
      };

      service.applyOneRosterFilters(mockQuery, "status='active' OR status='inactive'", ['status']);

      expect(mockQuery.where).toHaveBeenCalled();
    });
  });

  describe('applyWhereClause', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should apply equality operator', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'status', '=', 'active');

      expect(mockQuery.where).toHaveBeenCalledWith('status', 'active');
    });

    test('should apply not-equal operator', () => {
      const mockQuery = { whereNot: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'status', '!=', 'inactive');

      expect(mockQuery.whereNot).toHaveBeenCalledWith('status', 'inactive');
    });

    test('should apply greater-than operator', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'age', '>', '18');

      expect(mockQuery.where).toHaveBeenCalledWith('age', '>', '18');
    });

    test('should apply greater-than-or-equal operator', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'age', '>=', '18');

      expect(mockQuery.where).toHaveBeenCalledWith('age', '>=', '18');
    });

    test('should apply less-than operator', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'age', '<', '65');

      expect(mockQuery.where).toHaveBeenCalledWith('age', '<', '65');
    });

    test('should apply less-than-or-equal operator', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'age', '<=', '65');

      expect(mockQuery.where).toHaveBeenCalledWith('age', '<=', '65');
    });

    test('should apply LIKE operator with proper parameterization', () => {
      const mockQuery = { whereRaw: jest.fn().mockReturnThis() };

      service.applyWhereClause(mockQuery, 'name', '~', 'John');

      expect(mockQuery.whereRaw).toHaveBeenCalledWith(
        'LOWER(??) LIKE LOWER(?)',
        ['name', '%John%']
      );
    });

    test('should throw error for unsupported operator', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      expect(() => {
        service.applyWhereClause(mockQuery, 'field', 'INVALID', 'value');
      }).toThrow('Unsupported operator');
    });
  });

  describe('Filter Value Validation', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

  describe('validateFilterValue', () => {
    test('should accept normal values', () => {
      expect(() => service.validateFilterValue('active', 'status')).not.toThrow();
      expect(() => service.validateFilterValue('John Doe', 'name')).not.toThrow();
      expect(() => service.validateFilterValue('2024-01-01', 'date')).not.toThrow();
      expect(() => service.validateFilterValue('123', 'id')).not.toThrow();
    });

    test('should reject null or undefined values', () => {
      expect(() => service.validateFilterValue(null, 'status'))
        .toThrow('cannot be null or undefined');
      expect(() => service.validateFilterValue(undefined, 'status'))
        .toThrow('cannot be null or undefined');
    });

    test('should reject values exceeding maximum length', () => {
      const longValue = 'A'.repeat(251); // Exceeds MAX_FILTER_VALUE_LENGTH (250)

      expect(() => service.validateFilterValue(longValue, 'name'))
        .toThrow('exceeds maximum length');
    });

    test('should accept values at maximum length', () => {
      const maxValue = 'A'.repeat(250); // Exactly MAX_FILTER_VALUE_LENGTH

      expect(() => service.validateFilterValue(maxValue, 'name')).not.toThrow();
    });

    test('should reject values with null bytes', () => {
      const nullByteValue = 'test\0injection';

      expect(() => service.validateFilterValue(nullByteValue, 'name'))
        .toThrow('contains invalid null byte');
    });

    test('should warn about SQL comment patterns', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      service.validateFilterValue('test--comment', 'name');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Suspicious pattern detected')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SQL comment')
      );
      // Verify value is NOT logged (PII protection)
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('test--comment')
      );

      consoleWarnSpy.mockRestore();
    });

    test('should warn about SQL block comment patterns', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      service.validateFilterValue('test/*comment*/', 'name');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SQL block comment')
      );
      // Verify value is NOT logged (PII protection)
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('test/*comment*/')
      );

      consoleWarnSpy.mockRestore();
    });

    test('should warn about SQL injection attempts', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      service.validateFilterValue("'; DROP TABLE users; --", 'name');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SQL command injection attempt')
      );
      // Verify value is NOT logged (PII protection)
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('DROP TABLE')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('parseOneRosterFilter', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should parse simple equality filter', () => {
      const clauses = service.parseOneRosterFilter("status='active'");

      expect(clauses).toHaveLength(1);
      expect(clauses[0]).toEqual({
        field: 'status',
        operator: '=',
        value: 'active',
        logical: 'AND'
      });
    });

    test('should parse not-equal filter', () => {
      const clauses = service.parseOneRosterFilter("status!='inactive'");

      expect(clauses[0].operator).toBe('!=');
      expect(clauses[0].value).toBe('inactive');
    });

    test('should parse comparison operators', () => {
      expect(service.parseOneRosterFilter("age>'18'")[0].operator).toBe('>');
      expect(service.parseOneRosterFilter("age>='18'")[0].operator).toBe('>=');
      expect(service.parseOneRosterFilter("age<'65'")[0].operator).toBe('<');
      expect(service.parseOneRosterFilter("age<='65'")[0].operator).toBe('<=');
    });

    test('should parse LIKE operator', () => {
      const clauses = service.parseOneRosterFilter("name~'John'");

      expect(clauses[0].operator).toBe('~');
      expect(clauses[0].value).toBe('John');
    });

    test('should parse AND clauses', () => {
      const clauses = service.parseOneRosterFilter("status='active' AND type='school'");

      expect(clauses).toHaveLength(2);
      expect(clauses[0].field).toBe('status');
      expect(clauses[1].field).toBe('type');
      expect(clauses[1].logical).toBe('AND');
    });

    test('should parse OR clauses', () => {
      const clauses = service.parseOneRosterFilter("status='active' OR status='inactive'");

      expect(clauses).toHaveLength(2);
      expect(clauses[1].logical).toBe('OR');
    });

    test('should remove quotes from values', () => {
      const clauses = service.parseOneRosterFilter('name="John Doe"');

      expect(clauses[0].value).toBe('John Doe');
    });

    test('should reject excessive filter clauses', () => {
      const filter = Array(21).fill("status='active'").join(' AND ');

      expect(() => service.parseOneRosterFilter(filter))
        .toThrow('too many clauses');
    });

    test('should accept reasonable number of clauses', () => {
      const filter = Array(10).fill("status='active'").join(' AND ');

      expect(() => service.parseOneRosterFilter(filter)).not.toThrow();
    });

    test('should not count substrings in values as logical operators', () => {
      // Values containing "AND" or "OR" should not trigger DoS protection
      const filter = "givenName='Gordon' AND familyName='Anderson' AND title='LAND'";

      const clauses = service.parseOneRosterFilter(filter);

      // Should parse as 3 clauses, not count "or" in "Gordon", "And" in "Anderson", "AND" in "LAND"
      expect(clauses).toHaveLength(3);
      expect(clauses[0].value).toBe('Gordon');
      expect(clauses[1].value).toBe('Anderson');
      expect(clauses[2].value).toBe('LAND');
    });

    test('should throw error for invalid operator', () => {
      expect(() => service.parseOneRosterFilter("status*'test'"))
        .toThrow('unsupported operator');
    });
  });
});

  describe('applyExtraWhere', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should return query unchanged when no extraWhere', () => {
      const mockQuery = {
        whereRaw: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis()
      };

      const result = service.applyExtraWhere(mockQuery, null);

      expect(result).toBe(mockQuery);
      expect(mockQuery.whereRaw).not.toHaveBeenCalled();
      expect(mockQuery.where).not.toHaveBeenCalled();
    });

    test('should apply string extraWhere as raw SQL', () => {
      const mockQuery = { whereRaw: jest.fn().mockReturnThis() };

      service.applyExtraWhere(mockQuery, "role='student'");

      expect(mockQuery.whereRaw).toHaveBeenCalledWith("role='student'");
    });

    test('should apply object extraWhere using where', () => {
      const mockQuery = { where: jest.fn().mockReturnThis() };

      service.applyExtraWhere(mockQuery, { role: 'student' });

      expect(mockQuery.where).toHaveBeenCalledWith({ role: 'student' });
    });
  });

  describe('validateAndParseFields', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should parse single field', () => {
      const result = service.validateAndParseFields('sourcedId', ['sourcedId', 'name']);

      expect(result).toEqual(['sourcedId']);
    });

    test('should parse multiple fields', () => {
      const result = service.validateAndParseFields('sourcedId,name,status', ['sourcedId', 'name', 'status']);

      expect(result).toEqual(['sourcedId', 'name', 'status']);
    });

    test('should trim whitespace', () => {
      const result = service.validateAndParseFields(' sourcedId , name ', ['sourcedId', 'name']);

      expect(result).toEqual(['sourcedId', 'name']);
    });

    test('should throw error for invalid field', () => {
      expect(() => {
        service.validateAndParseFields('sourcedId,invalidField', ['sourcedId', 'name']);
      }).toThrow('Invalid fields requested: invalidField');
    });

    test('should throw error for multiple invalid fields', () => {
      expect(() => {
        service.validateAndParseFields('field1,field2', ['sourcedId']);
      }).toThrow('Invalid fields requested: field1, field2');
    });
  });

  describe('stripNullFields', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should remove null fields from object', () => {
      const data = {
        sourcedId: '123',
        name: 'Test',
        middleName: null,
        status: 'active'
      };

      const result = service.stripNullFields(data);

      expect(result).toEqual({
        sourcedId: '123',
        name: 'Test',
        status: 'active'
      });
    });

    test('should remove undefined fields from object', () => {
      const data = {
        sourcedId: '123',
        name: 'Test',
        middleName: undefined,
        status: 'active'
      };

      const result = service.stripNullFields(data);

      expect(result).toEqual({
        sourcedId: '123',
        name: 'Test',
        status: 'active'
      });
    });

    test('should process array of objects', () => {
      const data = [
        { sourcedId: '123', name: 'Test1', middleName: null },
        { sourcedId: '456', name: 'Test2', middleName: 'M' }
      ];

      const result = service.stripNullFields(data);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ sourcedId: '123', name: 'Test1' });
      expect(result[1]).toEqual({ sourcedId: '456', name: 'Test2', middleName: 'M' });
    });

    test('should remove deprecated role field from users endpoint', () => {
      const data = {
        sourcedId: '123',
        name: 'Test',
        role: 'student'
      };

      const result = service.stripNullFields(data, 'users');

      expect(result).toEqual({
        sourcedId: '123',
        name: 'Test'
      });
      expect(result.role).toBeUndefined();
    });

    test('should keep role field for non-users endpoints', () => {
      const data = {
        sourcedId: '123',
        name: 'Test',
        role: 'admin'
      };

      const result = service.stripNullFields(data, 'classes');

      expect(result).toEqual({
        sourcedId: '123',
        name: 'Test',
        role: 'admin'
      });
    });

    test('should return null when data is null', () => {
      const result = service.stripNullFields(null);

      expect(result).toBeNull();
    });

    test('should return undefined when data is undefined', () => {
      const result = service.stripNullFields(undefined);

      expect(result).toBeUndefined();
    });
  });

  describe('rawQuery', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should execute raw SQL query', async () => {
      mockKnex.raw.mockResolvedValue({ rows: [{ count: 5 }] });

      const result = await service.rawQuery('SELECT COUNT(*) as count FROM users');

      expect(mockKnex.raw).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM users', []);
      expect(result).toEqual([{ count: 5 }]);
    });

    test('should execute raw query with bindings', async () => {
      mockKnex.raw.mockResolvedValue({ rows: [{ name: 'Test' }] });

      const result = await service.rawQuery('SELECT * FROM users WHERE id = ?', [123]);

      expect(mockKnex.raw).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?', [123]);
      expect(result).toEqual([{ name: 'Test' }]);
    });

    test('should handle MSSQL result format', async () => {
      mockKnex.raw.mockResolvedValue([{ count: 5 }]); // MSSQL returns array directly

      const result = await service.rawQuery('SELECT COUNT(*) as count FROM users');

      expect(result).toEqual([{ count: 5 }]);
    });

    test('should throw error on query failure', async () => {
      mockKnex.raw.mockRejectedValue(new Error('Query failed'));

      await expect(
        service.rawQuery('INVALID SQL')
      ).rejects.toThrow('Query failed');
    });
  });

  describe('getTableInfo', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should return table column information', async () => {
      const mockColumns = {
        sourcedId: { type: 'varchar', maxLength: 255 },
        name: { type: 'varchar', maxLength: 255 }
      };

      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        columnInfo: jest.fn().mockResolvedValue(mockColumns)
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const result = await service.getTableInfo('users');

      expect(mockKnex.withSchema).toHaveBeenCalledWith('oneroster12');
      expect(mockQuery.table).toHaveBeenCalledWith('users');
      expect(result).toEqual(mockColumns);
    });

    test('should throw error when table does not exist', async () => {
      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        columnInfo: jest.fn().mockRejectedValue(new Error('Table not found'))
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      await expect(
        service.getTableInfo('nonexistent')
      ).rejects.toThrow('Table not found');
    });
  });

  describe('testConnection', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should return true on successful connection', async () => {
      mockKnex.raw.mockResolvedValue([{ result: 1 }]);

      const result = await service.testConnection();

      expect(mockKnex.raw).toHaveBeenCalledWith('SELECT 1');
      expect(result).toBe(true);
    });

    test('should throw error on connection failure', async () => {
      mockKnex.raw.mockRejectedValue(new Error('Connection failed'));

      await expect(
        service.testConnection()
      ).rejects.toThrow('Connection failed');
    });
  });

  describe('close', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should close database connection', async () => {
      mockKnex.destroy.mockResolvedValue(true);

      await service.close();

      expect(mockKnex.destroy).toHaveBeenCalled();
    });

    test('should throw error on close failure', async () => {
      mockKnex.destroy.mockRejectedValue(new Error('Close failed'));

      await expect(
        service.close()
      ).rejects.toThrow('Close failed');
    });
  });

  describe('Integration Tests', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
      service.authService = mockAuthService;
    });

    test('should validate values during query execution', async () => {
      const config = {
        defaultSortField: 'sourcedId',
        selectableFields: ['sourcedId', 'status'],
        allowedFilterFields: ['status']
      };

      const queryParams = {
        filter: `status=${'A'.repeat(251)}`, // Exceeds max length
        limit: 100,
        offset: 0
      };

      await expect(
        service.queryMany('users', config, queryParams, null, [123])
      ).rejects.toThrow('exceeds maximum length');
    });

    test('should validate null byte injection attempts', async () => {
      const config = {
        defaultSortField: 'sourcedId',
        selectableFields: ['sourcedId', 'status'],
        allowedFilterFields: ['status']
      };

      const queryParams = {
        filter: "status='test\0null'",
        limit: 100,
        offset: 0
      };

      await expect(
        service.queryMany('users', config, queryParams, null, [123])
      ).rejects.toThrow('invalid null byte');
    });

    test('should validate whereRaw uses proper parameter binding', () => {
      const mockQuery = {
        whereRaw: jest.fn().mockReturnThis()
      };

      service.applyWhereClause(mockQuery, 'name', '~', 'test');

      expect(mockQuery.whereRaw).toHaveBeenCalledWith(
        'LOWER(??) LIKE LOWER(?)',
        ['name', '%test%']
      );

      const call = mockQuery.whereRaw.mock.calls[0];
      expect(call[0]).toContain('??');
      expect(call[0]).not.toMatch(/\${/);
    });
  });

  describe('Security - OR Injection Prevention', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
      service.authService = mockAuthService;
    });

    test('should wrap user filters in AND group to prevent OR escape', async () => {
      const config = {
        defaultSortField: 'sourcedId',
        selectableFields: ['sourcedId', 'name'],
        allowedFilterFields: ['name', 'sourcedId']
      };

      let whereCalled = false;
      let whereCallbackExecuted = false;

      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn().mockReturnThis(),
        where: jest.fn(function(callback) {
          whereCalled = true;
          if (typeof callback === 'function') {
            whereCallbackExecuted = true;
            // Execute callback to trigger filter application
            callback(this);
          }
          return this;
        }),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn(function(callback) {
          if (typeof callback === 'function') {
            callback(this);
          }
          return this;
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const queryParams = {
        filter: "name='xxx' OR sourcedId!=''",
        limit: 100,
        offset: 0
      };

      await service.queryMany('users', config, queryParams, null, [123]);

      // Verify authorization filter was applied FIRST
      expect(mockQuery.whereIn).toHaveBeenCalledWith('educationOrganizationId', [123]);

      // Verify user filter was wrapped in a .where() callback (creates AND group)
      expect(whereCalled).toBe(true);
      expect(whereCallbackExecuted).toBe(true);

      // Verify orWhere was called INSIDE the user filter group (not at top level)
      expect(mockQuery.orWhere).toHaveBeenCalled();
    });

    test('should apply authorization filter before user filters', async () => {
      const config = {
        defaultSortField: 'sourcedId',
        selectableFields: ['sourcedId', 'status'],
        allowedFilterFields: ['status']
      };

      const callOrder = [];

      const mockQuery = {
        withSchema: jest.fn().mockReturnThis(),
        table: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        whereIn: jest.fn(function() {
          callOrder.push('whereIn-auth');
          return this;
        }),
        where: jest.fn(function(callback) {
          callOrder.push('where-userFilter');
          if (typeof callback === 'function') {
            callback(this);
          }
          return this;
        }),
        whereNot: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn((resolve) => {
          resolve([]);
          return Promise.resolve([]);
        })
      };

      mockKnex.withSchema = jest.fn(() => mockQuery);

      const queryParams = {
        filter: "status='active'",
        limit: 100,
        offset: 0
      };

      await service.queryMany('users', config, queryParams, null, [123]);

      // Authorization filter MUST be applied before user filters
      // Note: where is called twice - once for the group, once for the actual filter clause
      expect(callOrder[0]).toBe('whereIn-auth');
      expect(callOrder[1]).toBe('where-userFilter');
      expect(callOrder.length).toBeGreaterThanOrEqual(2);
    });

    test('should reject filters with disallowed fields even with OR', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };

      // Try to use OR with a disallowed field
      expect(() => {
        service.applyOneRosterFilters(
          mockQuery,
          "status='active' OR internalField='bypass'",
          ['status'] // internalField is NOT allowed
        );
      }).toThrow('not allowed for filtering');
    });

    test('should validate all values in OR clauses', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };

      // Try to inject null byte in OR clause
      expect(() => {
        service.applyOneRosterFilters(
          mockQuery,
          "status='active' OR status='test\0injection'",
          ['status']
        );
      }).toThrow('invalid null byte');
    });

    test('should enforce operator allowlist in OR clauses', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };

      // Try to use disallowed operator in OR clause
      expect(() => {
        service.parseOneRosterFilter("status='active' OR name*'test'");
      }).toThrow('unsupported operator');
    });
  });

  describe('Security - Multi-Layer Validation', () => {
    let service;

    beforeEach(() => {
      service = new OneRosterQueryService(mockKnex);
    });

    test('should enforce field allowlist before value validation', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis()
      };

      // Disallowed field should fail even with valid value
      expect(() => {
        service.applyOneRosterFilters(
          mockQuery,
          "invalidField='validValue'",
          ['allowedField']
        );
      }).toThrow('not allowed for filtering');
    });

    test('should enforce value validation after field validation', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      };

      // Allowed field but invalid value (too long)
      const longValue = 'A'.repeat(251);
      expect(() => {
        service.applyOneRosterFilters(
          mockQuery,
          `status='${longValue}'`,
          ['status']
        );
      }).toThrow('exceeds maximum length');
    });

    test('should use parameterized queries even after validation passes', () => {
      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis(),
        whereRaw: jest.fn().mockReturnThis()
      };

      // Apply a LIKE filter (uses whereRaw)
      service.applyWhereClause(mockQuery, 'name', '~', 'test');

      // Verify parameterization is used (defense in depth)
      expect(mockQuery.whereRaw).toHaveBeenCalledWith(
        'LOWER(??) LIKE LOWER(?)',
        ['name', '%test%']
      );

      // Verify NO string interpolation
      const sqlTemplate = mockQuery.whereRaw.mock.calls[0][0];
      expect(sqlTemplate).not.toContain('${');
      expect(sqlTemplate).not.toContain('test'); // Value not in template
    });

    test('should limit filter clause count to prevent DoS', () => {
      // Try to create 21 filter clauses (exceeds MAX_FILTER_CLAUSES = 20)
      const filter = Array(21).fill("status='active'").join(' AND ');

      expect(() => {
        service.parseOneRosterFilter(filter);
      }).toThrow('too many clauses');
    });

    test('should enforce value length limit per clause', () => {
      // Each individual value should be validated
      const longValue = 'A'.repeat(251);
      const filter = `status='active' AND name='${longValue}'`;

      const mockQuery = {
        where: jest.fn().mockReturnThis(),
        whereNot: jest.fn().mockReturnThis()
      };

      expect(() => {
        service.applyOneRosterFilters(mockQuery, filter, ['status', 'name']);
      }).toThrow('exceeds maximum length');
    });
  });
});
