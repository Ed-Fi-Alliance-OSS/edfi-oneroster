// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { authorizeEndpoint, ROSTER_SCOPES } from '../../src/middleware/authorizationHandler.js';

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
}

describe('authorizationHandler scope validation', () => {
  test('denies non-demographics endpoint when scope only contains crafted substring', () => {
    const middleware = authorizeEndpoint('users');
    const req = {
      auth: {
        payload: {
          scope: `${ROSTER_SCOPES.CORE}-evil`
        }
      }
    };
    const res = createRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows non-demographics endpoint for exact core scope token', () => {
    const middleware = authorizeEndpoint('users');
    const req = {
      auth: {
        payload: {
          scope: `openid profile ${ROSTER_SCOPES.CORE}`
        }
      }
    };
    const res = createRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('allows demographics endpoint only for exact demographics scope token', () => {
    const middleware = authorizeEndpoint('demographics');
    const req = {
      auth: {
        payload: {
          scope: `${ROSTER_SCOPES.DEMOGRAPHICS} ${ROSTER_SCOPES.CORE}`
        }
      }
    };
    const res = createRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('supports array scope claims and still enforces exact matching', () => {
    const middleware = authorizeEndpoint('users');
    const req = {
      auth: {
        payload: {
          scope: ['openid', `${ROSTER_SCOPES.FULL}`]
        }
      }
    };
    const res = createRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
