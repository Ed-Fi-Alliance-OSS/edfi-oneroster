// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * ODS Instance Validation Middleware
 * Implements comprehensive validation for 4 data flow types:
 * 1. Single Tenant
 * 2. Single Tenant with Context
 * 3. Multi-Tenant
 * 4. Multi-Tenant with Context
 */

import { isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import { getOdsContextConfig } from '../config/ods-context-config.js';

/**
 * Parse odsInstances from JWT payload
 * @param {Object} payload - JWT payload
 * @returns {Array} Array of ODS instances with context information
 */
function parseOdsInstances(payload) {
  if (!payload?.odsInstances) return [];

  try {
    // odsInstances is always a JSON string in the fixed JWT structure
    const parsed = JSON.parse(payload.odsInstances);
    return parsed.OdsInstances || [];
  } catch (error) {
    console.error('[OdsInstanceValidation] Failed to parse odsInstances JSON:', error.message);
    return [];
  }
}

/**
 * Validate tenant ID against configuration and JWT
 * Returns 404 if tenant not in config, 401 if JWT mismatch
 */
function validateTenantId(req, res, next) {
  const tenantIdFromRoute = req.tenantId;
  const tenantIdFromJwt = req.auth?.payload?.tenantId;

  if (!tenantIdFromRoute) {
    // No tenant in route - this is expected for non-multi-tenant or routes before extraction
    return next();
  }

  // Check if tenant exists in configuration
  const tenantsConfig = getTenantsConfig();
  if (!tenantsConfig || !tenantsConfig[tenantIdFromRoute]) {
    console.error(`[OdsInstanceValidation] Tenant '${tenantIdFromRoute}' not found in configuration`);
    return res.status(404).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: `Tenant '${tenantIdFromRoute}' not found`,
      imsx_codeMinor: 'not_found'
    });
  }

  // Validate tenant ID matches JWT
  if (tenantIdFromJwt && tenantIdFromJwt !== tenantIdFromRoute) {
    console.error(`[OdsInstanceValidation] Tenant mismatch - Route: ${tenantIdFromRoute}, JWT: ${tenantIdFromJwt}`);
    return res.status(401).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Tenant identifier in request does not match authorized tenant',
      imsx_codeMinor: 'unauthorized'
    });
  }

  next();
}

/**
 * Validate ODS context value against JWT and resolve ODS Instance ID
 * For flows with context routing (single-tenant with context, multi-tenant with context)
 */
function validateAndResolveOdsInstance(req, res, next) {
  const contextConfig = getOdsContextConfig();
  const multiTenancyEnabled = isMultiTenancyEnabled();
  const contextValueFromRoute = req.odsContext;
  const tenantIdFromRoute = req.tenantId;
  const payload = req.auth?.payload;

  // Parse ODS instances from JWT
  const odsInstances = parseOdsInstances(payload);

  if (odsInstances.length === 0) {
    console.warn('[OdsInstanceValidation] No ODS instances found in JWT');
    // If no ODS instances in JWT, allow fallback to existing odsInstanceId extraction
    return next();
  }

  // Flow Type Determination:
  // 1. Single Tenant (no context): !multiTenancyEnabled && !contextConfig
  // 2. Single Tenant with Context: !multiTenancyEnabled && contextConfig
  // 3. Multi-Tenant: multiTenancyEnabled && !contextConfig
  // 4. Multi-Tenant with Context: multiTenancyEnabled && contextConfig

  if (!contextConfig) {
    // Flow 1 or 3: No context routing
    // Use first ODS instance (or could implement additional logic)
    if (!req.odsInstanceId && odsInstances[0]) {
      req.odsInstanceId = odsInstances[0].OdsInstanceId;
      console.log(`[OdsInstanceValidation] Resolved OdsInstanceId: ${req.odsInstanceId} (${multiTenancyEnabled ? 'Multi-Tenant' : 'Single-Tenant'})`);
    }
    return next();
  }

  // Flow 2 or 4: Context routing enabled
  if (!contextValueFromRoute) {
    console.warn('[OdsInstanceValidation] Context value missing from route but context routing is enabled');
    return res.status(400).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: `Context parameter '${contextConfig.parameterName}' is required but not provided`,
      imsx_codeMinor: 'invalid_data'
    });
  }

  // Find matching ODS instance based on context value
  const matchingInstance = odsInstances.find(instance => {
    if (!instance.OdsInstanceContext) return false;

    const contextKey = instance.OdsInstanceContext.ContextKey;
    const contextValue = instance.OdsInstanceContext.ContextValue;

    // Verify context key matches the configured parameter name
    return contextKey === contextConfig.parameterName &&
           contextValue === contextValueFromRoute;
  });

  if (!matchingInstance) {
    console.error(`[OdsInstanceValidation] No authorized ODS instance found for context '${contextValueFromRoute}'`);
    console.error(`[OdsInstanceValidation] Available contexts:`, odsInstances.map(i => i.OdsInstanceContext));

    return res.status(401).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: `Not authorized for context '${contextValueFromRoute}'`,
      imsx_codeMinor: 'unauthorized'
    });
  }

  // Set the resolved ODS Instance ID
  req.odsInstanceId = matchingInstance.OdsInstanceId;

  const flowType = multiTenancyEnabled ? 'Multi-Tenant with Context' : 'Single-Tenant with Context';
  console.log(`[OdsInstanceValidation] ${flowType} - Resolved OdsInstanceId: ${req.odsInstanceId} for context '${contextValueFromRoute}'${tenantIdFromRoute ? ` (tenant: ${tenantIdFromRoute})` : ''}`);

  next();
}

/**
 * Build cache key for ODS connection based on flow type
 * Implements caching strategy from requirements:
 * - Single Tenant: odsinstance-{odsInstanceId}
 * - Single Tenant with Context: odsinstance-{odsInstanceId}-context-{contextValue}
 * - Multi-Tenant: tenant-{tenantId}-odsinstance-{odsInstanceId}
 * - Multi-Tenant with Context: tenant-{tenantId}-odsinstance-{odsInstanceId}-context-{contextValue}
 */
function buildOdsCacheKey(tenantId, odsInstanceId, contextValue) {
  if (!odsInstanceId) {
    return null;
  }

  const multiTenancyEnabled = isMultiTenancyEnabled();
  const contextConfig = getOdsContextConfig();

  // Flow 1: Single Tenant (no context)
  if (!multiTenancyEnabled && !contextConfig) {
    return `odsinstance-${odsInstanceId}`;
  }

  // Flow 2: Single Tenant with Context
  if (!multiTenancyEnabled && contextConfig && contextValue) {
    return `odsinstance-${odsInstanceId}-context-${contextValue}`;
  }

  // Flow 3: Multi-Tenant (no context)
  if (multiTenancyEnabled && !contextConfig && tenantId) {
    return `tenant-${tenantId}-odsinstance-${odsInstanceId}`;
  }

  // Flow 4: Multi-Tenant with Context
  if (multiTenancyEnabled && contextConfig && tenantId && contextValue) {
    return `tenant-${tenantId}-odsinstance-${odsInstanceId}-context-${contextValue}`;
  }

  // Fallback
  return `odsinstance-${odsInstanceId}`;
}

/**
 * Attach cache key to request for use by database factory
 */
function attachCacheKey(req, res, next) {
  const cacheKey = buildOdsCacheKey(req.tenantId, req.odsInstanceId, req.odsContext);
  req.odsCacheKey = cacheKey;

  if (cacheKey) {
    console.log(`[OdsInstanceValidation] Cache key: ${cacheKey}`);
  }

  next();
}

/**
 * Combined validation middleware - validates tenant, context, and resolves ODS instance
 * This should be applied after JWT verification and tenant extraction middleware
 */
function validateOdsInstanceFlow(req, res, next) {
  // Step 1: Validate tenant ID (if multi-tenant)
  validateTenantId(req, res, (err) => {
    if (err) return next(err);

    // Step 2: Validate context and resolve ODS instance ID
    validateAndResolveOdsInstance(req, res, (err) => {
      if (err) return next(err);

      // Step 3: Attach cache key
      attachCacheKey(req, res, next);
    });
  });
}

export {
  validateOdsInstanceFlow,
  validateTenantId,
  validateAndResolveOdsInstance,
  buildOdsCacheKey,
  parseOdsInstances
};
