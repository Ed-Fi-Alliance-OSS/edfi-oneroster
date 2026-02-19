// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const AuthorizationQueryService = require('../../src/services/database/AuthorizationQueryService');

const createMockKnex = () => {
  const hasTable = jest.fn().mockResolvedValue(false);
  const schemaWithSchema = jest.fn(() => ({ hasTable }));

  const knex = {
    withSchema: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    raw: jest.fn(sql => `RAW:${sql}`),
    table: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    schema: {
      withSchema: schemaWithSchema
    }
  };

  knex.__hasTable = hasTable;
  knex.__schemaWithSchema = schemaWithSchema;

  return knex;
};

const createBuilderSpy = () => {
  const builder = {
    children: { where: [], orWhere: [] },
    whereCalls: [],
    orWhereCalls: [],
    whereIn: jest.fn().mockReturnThis(),
    whereNotIn: jest.fn().mockReturnThis()
  };

  builder.where = jest.fn((arg, ...rest) => {
    if (typeof arg === 'function') {
      const child = createBuilderSpy();
      builder.children.where.push(child);
      arg(child);
      return builder;
    }
    builder.whereCalls.push([arg, ...rest]);
    return builder;
  });

  builder.orWhere = jest.fn((arg, ...rest) => {
    if (typeof arg === 'function') {
      const child = createBuilderSpy();
      builder.children.orWhere.push(child);
      arg(child);
      return builder;
    }
    builder.orWhereCalls.push([arg, ...rest]);
    return builder;
  });

  return builder;
};

const createMockQuery = () => {
  const query = {
    whereIn: jest.fn().mockReturnThis(),
    whereNotIn: jest.fn().mockReturnThis(),
    __builders: []
  };

  query.where = jest.fn(callback => {
    if (typeof callback === 'function') {
      const builder = createBuilderSpy();
      query.__builders.push(builder);
      callback(builder);
    }
    return query;
  });

  return query;
};

describe('AuthorizationQueryService', () => {
  test('buildAccessibleOrgIdsQuery returns null for empty input', () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    expect(service.buildAccessibleOrgIdsQuery([])).toBeNull();
    expect(service.buildAccessibleOrgIdsQuery(null)).toBeNull();
  });

  test('buildAccessibleOrgIdsQuery builds auth view subquery', () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex, 'oneroster12', 'auth');

    const result = service.buildAccessibleOrgIdsQuery(['100', '200']);

    expect(result).toBe(knex);
    expect(knex.withSchema).toHaveBeenCalledWith('auth');
    expect(knex.select).toHaveBeenCalledWith('targeteducationorganizationid');
    expect(knex.from).toHaveBeenCalledWith('educationorganizationidtoeducationorganizationid');
    expect(knex.whereIn).toHaveBeenCalledWith('sourceeducationorganizationid', ['100', '200']);
  });

  test('buildOrg/Class/Course/AcademicSession filters return field-based filter', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);
    const ids = ['10'];

    const orgFilter = await service.buildOrgAuthorizationFilter(ids);
    const classFilter = await service.buildClassAuthorizationFilter(ids);
    const courseFilter = await service.buildCourseAuthorizationFilter(ids);
    const sessionFilter = await service.buildAcademicSessionAuthorizationFilter(ids);

    [orgFilter, classFilter, courseFilter, sessionFilter].forEach(filter => {
      expect(filter.field).toBe('educationOrganizationId');
      expect(filter.values).toBe(knex);
    });
  });

  test('buildUserAuthorizationFilter applies role-aware join logic', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    const filter = await service.buildUserAuthorizationFilter(['10']);
    const query = createMockQuery();

    filter.apply(query);

    expect(filter.type).toBe('join');
    expect(query.whereIn).toHaveBeenCalledWith('users.educationOrganizationId', knex);
    expect(query.where).toHaveBeenCalledTimes(1);

    const builder = query.__builders[0];
    expect(builder.orWhere).toHaveBeenCalledTimes(3);

    const [studentChild, parentChild, staffChild] = builder.children.orWhere;

    expect(studentChild.where).toHaveBeenCalledWith('users.role', 'student');
    expect(studentChild.whereIn).toHaveBeenCalledWith('users.participantUSI', knex);

    expect(parentChild.where).toHaveBeenCalledWith('users.role', 'parent');
    expect(parentChild.whereIn).toHaveBeenCalledWith('users.participantUSI', knex);

    expect(staffChild.whereNotIn).toHaveBeenCalledWith('users.role', ['student', 'parent']);
    expect(staffChild.whereIn).toHaveBeenCalledWith('users.participantUSI', knex);
  });

  test('buildUserAuthorizationFilter uses parent auth view when contact auth view is unavailable', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    knex.__hasTable
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const filter = await service.buildUserAuthorizationFilter(['10']);
    const query = createMockQuery();

    filter.apply(query);

    expect(knex.from).toHaveBeenCalledWith('educationorganizationidtoparentusi');
    expect(knex.select).toHaveBeenCalledWith('parentusi');
  });

  test('buildEnrollmentAuthorizationFilter applies student/teacher joins', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    const filter = await service.buildEnrollmentAuthorizationFilter(['10']);
    const query = createMockQuery();

    filter.apply(query);

    expect(filter.type).toBe('join');
    expect(query.whereIn).toHaveBeenCalledWith('enrollments.educationOrganizationId', knex);
    expect(query.where).toHaveBeenCalledTimes(1);

    const builder = query.__builders[0];
    expect(builder.where).toHaveBeenCalledTimes(1);
    expect(builder.orWhere).toHaveBeenCalledTimes(1);

    const studentChild = builder.children.where[0];
    expect(studentChild.where).toHaveBeenCalledWith('enrollments.role', 'student');
    expect(studentChild.whereIn).toHaveBeenCalledWith('enrollments.participantUSI', knex);

    const staffChild = builder.children.orWhere[0];
    expect(staffChild.where).toHaveBeenCalledWith('enrollments.role', 'teacher');
    expect(staffChild.whereIn).toHaveBeenCalledWith('enrollments.participantUSI', knex);
  });

  test('buildDemographicsAuthorizationFilter scopes student matches', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex, 'oneroster12', 'auth');

    const filter = await service.buildDemographicsAuthorizationFilter(['10']);
    const query = createMockQuery();

    filter.apply(query);

    expect(filter.type).toBe('join');
    expect(query.whereIn).toHaveBeenCalledWith('demographics.educationOrganizationId', knex);
    expect(query.where).toHaveBeenCalledTimes(1);

    const builder = query.__builders[0];
    expect(builder.where).toHaveBeenCalledTimes(1);
    const studentChild = builder.children.where[0];
    expect(studentChild.whereIn).toHaveBeenCalledWith('demographics.studentUSI', knex);
  });

  test('applyAuthorizationFilter handles join filters', () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);
    const query = createMockQuery();
    const apply = jest.fn().mockReturnValue(query);

    const result = service.applyAuthorizationFilter(query, { type: 'join', apply });

    expect(apply).toHaveBeenCalledWith(query);
    expect(result).toBe(query);
  });

  test('applyAuthorizationFilter handles subquery values', () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);
    const query = createMockQuery();
    const subquery = { toSQL: jest.fn() };

    service.applyAuthorizationFilter(query, { field: 'educationOrganizationId', values: subquery });

    expect(query.whereIn).toHaveBeenCalledWith('educationOrganizationId', subquery);
  });

  test('applyAuthorizationFilter converts array values to strings', () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);
    const query = createMockQuery();

    service.applyAuthorizationFilter(query, { field: 'educationOrganizationId', values: [1, 2] });

    expect(query.whereIn).toHaveBeenCalledWith('educationOrganizationId', ['1', '2']);
  });

  test('getAuthorizationFilter routes to the correct builder', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    jest.spyOn(service, 'buildOrgAuthorizationFilter').mockResolvedValue('ORG_FILTER');

    const result = await service.getAuthorizationFilter('orgs', ['10']);

    expect(result).toBe('ORG_FILTER');
    expect(service.buildOrgAuthorizationFilter).toHaveBeenCalledWith(['10']);
  });

  test('getAuthorizationFilter returns null for unknown endpoint', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await service.getAuthorizationFilter('unknown', ['10']);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
