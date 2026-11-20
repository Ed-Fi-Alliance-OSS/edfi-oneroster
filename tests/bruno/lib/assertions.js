// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Shared request and assertion helpers for the scope tests. Bruno's `expect` and
// `bru` are passed in, since they only exist in the calling script.

// GET a URL with a bearer token and return { status, body }, also for non-2xx
// responses. The error body of a non-2xx response is only available when Bruno
// runs with --sandbox developer.
async function getWithToken(bru, url, token) {
  try {
    const res = await bru.sendRequest({
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${token}` }
    });
    return { status: res.status, body: res.data };
  } catch (err) {
    if (err.response) {
      return { status: err.response.status, body: err.response.data };
    }
    throw err;
  }
}

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

module.exports = { getWithToken, expectAllowed, expectForbidden };
