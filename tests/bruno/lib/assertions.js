// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Shared assertions for the scope tests. Bruno's `expect` is passed in, since it
// only exists in the calling script.

// Text for assertion messages: what was called, the status and the start of the
// body, so a failure in the report can be diagnosed without rerunning.
function describe(endpoint, { status, body }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return `${endpoint} returned HTTP ${status}, body: ${(text || '').slice(0, 200)}`;
}

// 200 with the endpoint's collection in the body.
function expectAllowed(expect, endpoint, response, collection) {
  const context = describe(endpoint, response);
  const { status, body } = response;
  expect(status, `expected HTTP 200; ${context}`).to.equal(200);
  expect(body?.[collection], `expected a ${collection} array; ${context}`).to.be.an('array');
}

// 403 in the imsx_* envelope, denied for scope, with no data.
function expectForbidden(expect, endpoint, response, collection) {
  const context = describe(endpoint, response);
  const { status, body } = response;
  expect(status, `expected HTTP 403; ${context}`).to.equal(403);
  expect(body?.imsx_codeMajor, `imsx_codeMajor; ${context}`).to.equal('failure');
  expect(body?.imsx_severity, `imsx_severity; ${context}`).to.equal('error');
  expect(body?.imsx_description, `imsx_description; ${context}`).to.be.a('string').and.match(/scope/i);
  expect(body, `expected no ${collection} data; ${context}`).to.not.have.property(collection);
}

module.exports = { expectAllowed, expectForbidden };
