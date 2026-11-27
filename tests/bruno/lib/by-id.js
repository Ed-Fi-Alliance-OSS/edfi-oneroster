// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Get-by-id checks for every rostering endpoint (ONEROSTER-91). Call it from the
// tests block of a .bru request:
//
//   const { runByIdChecks } = require('./lib/by-id.js');
//   await runByIdChecks(test, expect, bru, { token: bru.getEnvVar('lea-odsApiToken') });
//
// The token must reach all 12 endpoints, so it needs roster-core (or roster) and
// roster-demographics. Each check is reported as its own named test.

const { ENDPOINTS } = require('./access-matrix.js');
const { sendRequest } = require('./request.js');
const { describe, expectNotFound } = require('./assertions.js');

// Endpoint path -> the key a single record is wrapped in, per the OneRoster 1.2
// Rostering REST binding. The collection key comes from lib/access-matrix.js.
const WRAPPERS = {
  academicSessions: 'academicSession',
  gradingPeriods: 'academicSession',
  terms: 'academicSession',
  classes: 'class',
  courses: 'course',
  demographics: 'demographics',
  enrollments: 'enrollment',
  orgs: 'org',
  schools: 'org',
  users: 'user',
  students: 'user',
  teachers: 'user'
};

// Well-formed (sourcedIds are 32-character MD5 hex strings) but matches no record.
const UNKNOWN_ID = '00000000000000000000000000000000';

// Sub-types the E2E data sets may not contain: the Grand Bend sessions all map
// to `semester`. When one of these collections is empty, its valid-id check is
// reported as skipped instead of failing.
const MAY_BE_EMPTY = ['terms', 'gradingPeriods'];

const filtered = (endpoint, filter) => `${endpoint}?filter=${encodeURIComponent(filter)}`;

// A real record of one sub-type must not be returned by the endpoint of another.
// `source` is the collection query that supplies the id. Semesters are always in
// the data, so they test the terms and gradingPeriods filters.
const SUBTYPE_MISMATCHES = [
  { endpoint: 'terms', source: filtered('academicSessions', "type='semester'"), label: 'semester id' },
  { endpoint: 'gradingPeriods', source: filtered('academicSessions', "type='semester'"), label: 'semester id' },
  { endpoint: 'schools', source: filtered('orgs', "type='district'"), label: 'district id' },
  { endpoint: 'students', source: 'teachers', label: 'teacher id' },
  { endpoint: 'teachers', source: 'students', label: 'student id' }
];

// First record of a collection query, or a failed assertion that says why there is none.
async function firstRecord(expect, bru, baseUrl, token, query) {
  const path = query.split('?')[0];
  const separator = query.includes('?') ? '&' : '?';
  const label = `${query}${separator}limit=1`;
  const response = await sendRequest(bru, { url: `${baseUrl}/${label}`, token });
  const context = describe(label, response);
  expect(response.status, `expected HTTP 200; ${context}`).to.equal(200);
  const record = response.body?.[ENDPOINTS[path].collection]?.[0];
  expect(record, `the test needs at least one record; ${context}`).to.be.an('object');
  return record;
}

// True only for a successful, empty collection response; any other answer goes
// through the normal check so the problem is reported.
async function isEmpty(bru, baseUrl, token, endpoint) {
  const response = await sendRequest(bru, { url: `${baseUrl}/${endpoint}?limit=1`, token });
  const records = response.body?.[ENDPOINTS[endpoint].collection];
  return response.status === 200 && Array.isArray(records) && records.length === 0;
}

async function runByIdChecks(test, expect, bru, { token }) {
  const baseUrl = `${bru.getEnvVar('oneRosterUrl')}/${bru.getEnvVar('rosterPath')}`;

  // Valid id: the by-id record is the one the collection returned, in the spec wrapper.
  for (const [endpoint, wrapper] of Object.entries(WRAPPERS)) {
    if (MAY_BE_EMPTY.includes(endpoint) && await isEmpty(bru, baseUrl, token, endpoint)) {
      await test(`by-id › ${endpoint}/{id} → skipped, no ${endpoint} in this data set`, function() {});
      continue;
    }
    await test(`by-id › ${endpoint}/{id} → 200`, async function() {
      const record = await firstRecord(expect, bru, baseUrl, token, endpoint);
      const label = `${endpoint}/${record.sourcedId}`;
      const response = await sendRequest(bru, { url: `${baseUrl}/${encodeURI(label)}`, token });
      const context = describe(label, response);
      expect(response.status, `expected HTTP 200; ${context}`).to.equal(200);
      expect(Object.keys(response.body || {}), `expected only the ${wrapper} key; ${context}`).to.deep.equal([wrapper]);
      const single = response.body[wrapper];
      expect(single, `expected a single ${wrapper} object; ${context}`).to.be.an('object').and.not.be.an('array');
      expect(single.sourcedId, `sourcedId; ${context}`).to.equal(record.sourcedId);
      expect(single, `by-id record differs from the collection record; ${context}`).to.deep.equal(record);
    });
  }

  // Unknown id: 404 on every endpoint.
  for (const [endpoint, wrapper] of Object.entries(WRAPPERS)) {
    await test(`by-id › ${endpoint}/{unknown id} → 404`, async function() {
      const label = `${endpoint}/${UNKNOWN_ID}`;
      const response = await sendRequest(bru, { url: `${baseUrl}/${label}`, token });
      expectNotFound(expect, label, response, wrapper);
    });
  }

  // Wrong sub-type: a filtered endpoint doesn't return a record of another type.
  for (const { endpoint, source, label } of SUBTYPE_MISMATCHES) {
    await test(`by-id › ${endpoint}/{${label}} → 404`, async function() {
      const record = await firstRecord(expect, bru, baseUrl, token, source);
      const path = `${endpoint}/${record.sourcedId}`;
      const response = await sendRequest(bru, { url: `${baseUrl}/${encodeURI(path)}`, token });
      expectNotFound(expect, path, response, WRAPPERS[endpoint]);
    });
  }
}

module.exports = { WRAPPERS, UNKNOWN_ID, MAY_BE_EMPTY, SUBTYPE_MISMATCHES, runByIdChecks };
