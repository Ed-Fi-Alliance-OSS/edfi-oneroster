// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Request helper for Bruno scripts. `bru` is passed in, since it only exists in
// the calling script. Load it with require('./lib/request.js') from a .bru file.

// Send an HTTP request through bru.sendRequest and return { status, body }, also
// for non-2xx responses. `token`, `body` and `headers` are optional; a token is
// sent as a bearer Authorization header. The body of a non-2xx response is only
// available when Bruno runs with --sandbox developer.
async function sendRequest(bru, { method = 'GET', url, token, body, headers = {} }) {
  const allHeaders = { ...headers };
  if (token) {
    allHeaders.Authorization = `Bearer ${token}`;
  }
  const options = { method, url, headers: allHeaders };
  if (body !== undefined) {
    options.data = body;
  }
  try {
    const res = await bru.sendRequest(options);
    return { status: res.status, body: res.data };
  } catch (err) {
    if (err.response) {
      return { status: err.response.status, body: err.response.data };
    }
    throw err;
  }
}

module.exports = { sendRequest };
