// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Tenant and ODS Instance Identification Middleware
 * Extracts tenant identifier from route parameters and OdsInstanceId from JWT
 */

import { isMultiTenancyEnabled } from '../config/multi-tenancy-config.js';
import { getOdsContextConfig } from '../config/ods-context-config.js';

/**
 * Extract OdsInstanceId from JWT token claims
 * This determines which ODS database to query (authorized instance)
 */
function extractOdsInstanceIdFromJwt(req) {
  if (!req.auth?.payload) {
    return null;
  }

  const payload = req.auth.payload;

  // Extract OdsInstanceId from JWT - this identifies the authorized ODS database
  const odsInstanceId = payload.odsInstanceId || payload.ods_instance_id || payload.OdsInstanceId;

  return odsInstanceId ? parseInt(odsInstanceId, 10) : null;
}

/**
 * Extract tenant ID from route parameters
 * Only applicable in multi-tenant mode where routes include :tenantId
 */
function extractTenantFromRoute(req) {
  // In multi-tenant mode, tenant ID comes from route parameter
  return req.params?.tenantId || null;
}

/**
 * Extract ODS context value from route parameters (e.g., school year)
 * Only applicable when ODS_CONTEXT_ROUTE_TEMPLATE is configured
 */
function extractOdsContextFromRoute(req) {
  const contextConfig = getOdsContextConfig();
  if (!contextConfig?.parameterName) {
    return null;
  }

  return req.params[contextConfig.parameterName] || null;
}

/**
 * Middleware to extract and attach tenant and ODS instance information to request
 */
function extractTenantMiddleware(req, res, next) {
  // Always extract OdsInstanceId from JWT - required for ODS database resolution
  const odsInstanceId = extractOdsInstanceIdFromJwt(req);
  req.odsInstanceId = odsInstanceId;

  // Extract tenant ID from route if multi-tenancy is enabled
  let tenantId = null;
  if (isMultiTenancyEnabled()) {
    tenantId = extractTenantFromRoute(req);
  }
  req.tenantId = tenantId;

  // Extract ODS context value from route (e.g., school year)
  const odsContext = extractOdsContextFromRoute(req);
  req.odsContext = odsContext;

  // Log extraction results
  const contextInfo = odsContext ? `, Context: ${odsContext}` : '';
  if (tenantId) {
    console.log(`[TenantMiddleware] Tenant: ${tenantId}, OdsInstanceId: ${odsInstanceId}${contextInfo}`);
  } else {
    console.log(`[TenantMiddleware] Single-tenant mode, OdsInstanceId: ${odsInstanceId}${contextInfo}`);
  }

  if (!odsInstanceId) {
    console.warn('[TenantMiddleware] WARNING: No OdsInstanceId found in JWT token');
  }

  next();
}

/**
 * Middleware to require OdsInstanceId from JWT (returns 403 if not present)
 * Use this on routes that require database access
 */
function requireOdsInstanceMiddleware(req, res, next) {
  if (!req.odsInstanceId) {
    return res.status(403).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'ODS Instance identifier is required but was not found in JWT token',
      imsx_codeMinor: 'unauthorized'
    });
  }
  next();
}

/**
 * Middleware to require tenant ID (returns 400 if not present when multi-tenancy enabled)
 * Use this on routes that must have a tenant ID in multi-tenant mode
 */
function requireTenantMiddleware(req, res, next) {
  if (isMultiTenancyEnabled() && !req.tenantId) {
    return res.status(400).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Tenant identifier is required but was not provided in the route',
      imsx_codeMinor: 'invalid_data'
    });
  }
  next();
}

export {
  extractTenantMiddleware,
  requireTenantMiddleware,
  requireOdsInstanceMiddleware,
  extractOdsInstanceIdFromJwt,
  extractTenantFromRoute,
  extractOdsContextFromRoute
};
