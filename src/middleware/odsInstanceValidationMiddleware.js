// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import { getOdsContextConfig } from '../config/ods-context-config.js';

/**
 * Parse odsInstances from JWT payload
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
  const tenantIdFromRoute = req.tenantId?.toLowerCase();
  const tenantIdFromJwt = req.auth?.payload?.tenantId?.toLowerCase();

  if (!tenantIdFromRoute) {
    // No tenant in route - this is expected for non-multi-tenant or routes before extraction
    return next();
  }

  // Check if tenant exists in configuration
  const tenantsConfig = getTenantsConfig();
  const normalizedConfig = tenantsConfig
    ? Object.fromEntries(Object.entries(tenantsConfig).map(([k, v]) => [k.toLowerCase(), v]))
    : null;
  if (!normalizedConfig || !normalizedConfig[tenantIdFromRoute]) {
    console.error(`[OdsInstanceValidation] Tenant '${tenantIdFromRoute}' not found in configuration`);
    return res.status(404).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'The requested resource was not found.'
    });
  }

  // Validate tenant ID matches JWT
  if (tenantIdFromJwt && tenantIdFromJwt !== tenantIdFromRoute) {
    console.error(`[OdsInstanceValidation] Tenant mismatch - Route: ${tenantIdFromRoute}, JWT: ${tenantIdFromJwt}`);
    return res.status(401).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Not authorized to access the requested resource.'
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

  if (!contextConfig) {
    if (!req.odsInstanceId && odsInstances[0]) {
      req.odsInstanceId = odsInstances[0].OdsInstanceId;
      console.log(`[OdsInstanceValidation] Resolved OdsInstanceId: ${req.odsInstanceId} (${multiTenancyEnabled ? 'Multi-Tenant' : 'Single-Tenant'})`);
    }
    return next();
  }

  if (!contextValueFromRoute) {
    console.warn('[OdsInstanceValidation] Context value missing from route but context routing is enabled');
    return res.status(400).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Required context parameter is missing from the request'
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
      imsx_description: 'Not authorized to access the requested resource',
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
