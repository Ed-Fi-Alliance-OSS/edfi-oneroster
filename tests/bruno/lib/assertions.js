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

// 200 with the endpoint's collection in the body.
function expectAllowed(expect, { status, body }, collection) {
  expect(status, 'HTTP status').to.equal(200);
  expect(body?.[collection], `${collection} collection`).to.be.an('array');
}

// 403 in the imsx_* envelope, denied for scope, with no data.
function expectForbidden(expect, { status, body }, collection) {
  expect(status, 'HTTP status').to.equal(403);
  expect(body?.imsx_codeMajor, 'imsx_codeMajor').to.equal('failure');
  expect(body?.imsx_severity, 'imsx_severity').to.equal('error');
  expect(body?.imsx_description, 'imsx_description').to.be.a('string').and.match(/scope/i);
  expect(body, 'response body').to.not.have.property(collection);
}

module.exports = { getWithToken, expectAllowed, expectForbidden };
