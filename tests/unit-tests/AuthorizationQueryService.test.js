// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const AuthorizationQueryService = require('../../src/services/database/AuthorizationQueryService');

const createMockKnex = () => {
  const knex = {
    withSchema: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    raw: jest.fn(sql => `RAW:${sql}`)
  };

  return knex;
};

const createMockQuery = () => ({
  whereIn: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orWhere: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  whereNotIn: jest.fn().mockReturnThis()
});

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
    expect(knex.select).toHaveBeenCalledWith('TargetEducationOrganizationId');
    expect(knex.from).toHaveBeenCalledWith('EducationOrganizationIdToEducationOrganizationId');
    expect(knex.whereIn).toHaveBeenCalledWith('SourceEducationOrganizationId', ['100', '200']);
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

  test('buildUserAuthorizationFilter returns join filter', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    const filter = await service.buildUserAuthorizationFilter(['10']);

    expect(filter.type).toBe('join');
    expect(typeof filter.apply).toBe('function');
  });

  test('buildEnrollmentAuthorizationFilter returns join filter', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex);

    const filter = await service.buildEnrollmentAuthorizationFilter(['10']);

    expect(filter.type).toBe('join');
    expect(typeof filter.apply).toBe('function');
  });

  test('buildDemographicsAuthorizationFilter joins auth views', async () => {
    const knex = createMockKnex();
    const service = new AuthorizationQueryService(knex, 'oneroster12', 'auth');

    jest.spyOn(service, 'buildAccessibleOrgIdsQuery').mockReturnValue('ACCESSIBLE_ORGS');

    const filter = await service.buildDemographicsAuthorizationFilter(['10']);
    const query = createMockQuery();

    filter.apply(query);

    expect(knex.raw).toHaveBeenCalledWith(
      'auth.EducationOrganizationIdToEducationOrganizationId as auth_demographics_eo'
    );
    expect(knex.raw).toHaveBeenCalledWith(
      'auth.EducationOrganizationIdToStudentUSI as auth_demographics_student'
    );
    expect(query.innerJoin).toHaveBeenCalledWith(
      'RAW:auth.EducationOrganizationIdToEducationOrganizationId as auth_demographics_eo',
      'demographics.educationOrganizationId',
      'auth_demographics_eo.TargetEducationOrganizationId'
    );
    expect(query.innerJoin).toHaveBeenCalledWith(
      'RAW:auth.EducationOrganizationIdToStudentUSI as auth_demographics_student',
      'demographics.studentUSI',
      'auth_demographics_student.StudentUSI'
    );
    expect(query.whereIn).toHaveBeenCalledWith(
      'auth_demographics_eo.SourceEducationOrganizationId',
      ['10']
    );
    expect(query.whereIn).toHaveBeenCalledWith(
      'auth_demographics_student.SourceEducationOrganizationId',
      'ACCESSIBLE_ORGS'
    );
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
