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

// Sanity cap on the operator-supplied MAX_PAGE_SIZE. Guards against a
// misconfiguration (MAX_PAGE_SIZE=100000000) silently removing the ceiling.
// Set well above the 20000 the E2E environments use for full-view fetches.
export const MAX_ALLOWED_PAGE_SIZE = 100000;
