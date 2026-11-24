// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock the database service before importing the controller
const mockQueryOne = jest.fn();
const mockGetDefaultDatabaseService = jest.fn(async () => ({ queryOne: mockQueryOne }));

jest.unstable_mockModule('../../src/services/database/DatabaseServiceFactory.js', () => ({
  getDefaultDatabaseService: mockGetDefaultDatabaseService,
}));

const controller = await import('../../src/controllers/unified/oneRosterController.js');

function createReq(id = 'abc123') {
  return { params: { id }, odsInstanceId: 1, tenantId: null, odsCacheKey: 'key', educationOrgIds: [] };
}

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

// Single-record wrapper keys from the OneRoster 1.2 Rostering REST binding
const BY_ID_HANDLERS = [
  ['academicSessionsOne', 'academicSession'],
  ['gradingPeriodsOne', 'academicSession'],
  ['termsOne', 'academicSession'],
  ['classesOne', 'class'],
  ['coursesOne', 'course'],
  ['demographicsOne', 'demographics'],
  ['enrollmentsOne', 'enrollment'],
  ['orgsOne', 'org'],
  ['schoolsOne', 'org'],
  ['usersOne', 'user'],
  ['studentsOne', 'user'],
  ['teachersOne', 'user'],
];

describe('oneRosterController by-id endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(BY_ID_HANDLERS)('%s wraps the record in "%s"', async (handler, wrapper) => {
    const record = { sourcedId: 'abc123' };
    mockQueryOne.mockResolvedValueOnce(record);
    const res = createRes();

    await controller[handler](createReq(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ [wrapper]: record });
  });

  test('returns 404 in the imsx envelope when the record is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = createRes();

    await controller.demographicsOne(createReq('missing'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
    }));
  });
});
