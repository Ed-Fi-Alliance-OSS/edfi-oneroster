// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Pagination limits shared by the query service and the startup env validator,
 * so both agree on what a usable MAX_PAGE_SIZE is.
 */

// Page size applied when a request omits 'limit'. Matches the `default: 100`
// documented for every collection endpoint in config/swagger.yml and the
// OneRoster 1.2 REST binding. Not configurable.
export const DEFAULT_PAGE_SIZE = 100;

// Fallback page-size ceiling used when MAX_PAGE_SIZE is unset or unusable
export const DEFAULT_MAX_PAGE_SIZE = 500;

// Largest MAX_PAGE_SIZE an operator can set without a startup warning. Not a
// hard limit: deployments whose clients need bigger pages may exceed it, at the
// cost of memory, response size and query time.
export const RECOMMENDED_MAX_PAGE_SIZE = 10000;

/**
 * Parse an operator-supplied MAX_PAGE_SIZE
 * Digits only, so '1e3', '1.5', '-1' and 'abc' are rejected rather than coerced.
 * @returns {number|null} the positive safe integer, or null when the value is unusable
 */
export function parseMaxPageSize(rawValue) {
  const stringValue = String(rawValue).trim();
  if (!/^\d+$/.test(stringValue)) {
    return null;
  }

  const parsed = Number(stringValue);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}
