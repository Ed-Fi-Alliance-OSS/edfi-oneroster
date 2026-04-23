// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const MAX_BASE_PATH_LENGTH = 1024;

/**
 * Safely join URL segments
 */
export function joinUrl(base, path) {
  if (!base) return path;
  if (!path) return base;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

/**
 * Normalize base path by removing leading/trailing slashes and limiting length
 */
export function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') return '';
  const safeBasePath = basePath.slice(0, MAX_BASE_PATH_LENGTH);
  return '/' + safeBasePath.replace(/^\/+|\/+$/g, '');
}

/**
 * Get external base URL from request, including forwarded headers and base path
 */
export function getExternalBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const forwardedPrefix = req.get('x-forwarded-prefix');

  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');

  const basePath = normalizeBasePath(forwardedPrefix || process.env.API_BASE_PATH || '');
  return `${protocol}://${host}${basePath}`;
}
