// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Runs the scope access tests for one scope set. Call it from the tests block of
// a request that POSTs to {{oauthUrl}} for a token with exactly those scopes:
//
//   const { runScopeAccess } = require('./lib/scope-access.js');
//   await runScopeAccess({ label: 'roster.readonly', scopes: ['roster'], res, bru, test, expect });
//
// `scopes` are keys of SCOPES in lib/access-matrix.js. It creates one test for the
// token and one per endpoint in ENDPOINTS, named `<label> › <endpoint> → <status>`.

const { SCOPES, ENDPOINTS, expectedStatus } = require('./access-matrix.js');
const { getWithToken, expectAllowed, expectForbidden } = require('./assertions.js');

async function runScopeAccess({ label, scopes, res, bru, test, expect }) {
  const requested = scopes.map((key) => {
    if (!SCOPES[key]) throw new Error(`Unknown scope key '${key}' in ${label}`);
    return SCOPES[key];
  });
  const token = res.getBody()?.access_token;
  const granted = (res.getBody()?.scope || '').split(/\s+/).filter(Boolean);
  const tokenOk = res.getStatus() === 200 && typeof token === 'string' && token.length > 0;

  test(`${label} › token holds only the requested scope`, function() {
    expect(res.getStatus(), 'token request HTTP status').to.equal(200);
    expect(token, 'access_token').to.be.a('string').and.not.be.empty;
    expect([...granted].sort(), 'granted scopes').to.deep.equal([...requested].sort());
  });

  // Without a token every endpoint check would fail for the same reason, so the
  // failed token test above is the only failure reported.
  if (!tokenOk) return;

  const baseUrl = `${bru.getEnvVar('oneRosterUrl')}/${bru.getEnvVar('rosterPath')}`;
  for (const [endpoint, { collection }] of Object.entries(ENDPOINTS)) {
    const expected = expectedStatus(requested, endpoint);
    await test(`${label} › ${endpoint} → ${expected}`, async function() {
      const response = await getWithToken(bru, `${baseUrl}/${endpoint}?limit=1`, token);
      if (expected === 200) {
        expectAllowed(expect, endpoint, response, collection);
      } else {
        expectForbidden(expect, endpoint, response, collection);
      }
    });
  }
}

module.exports = { runScopeAccess };
