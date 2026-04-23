// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import express from 'express';
import { getDiscovery } from '../controllers/discoveryController.js';
import { isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import {
  getOdsContextConfig,
  validateContextValue
} from '../config/ods-context-config.js';
import { validateContextValueFromDatabase } from '../services/odsContextValidationService.js';

const router = express.Router();

/**
 * Middleware to validate ODS context value (e.g., school year)
 * Validates against both constraint and database
 * Only validates if context value is provided in the route
 */
async function validateContextMiddleware(req, res, next) {
  const contextConfig = getOdsContextConfig();

  if (!contextConfig) {
    // No context configured, skip validation
    return next();
  }

  const contextValue = req.params[contextConfig.parameterName];

  if (!contextValue) {
    // Context not provided in route, skip validation (allows partial URLs)
    return next();
  }

  // Validate against constraint (e.g., range, values, int, regex)
  if (!validateContextValue(contextValue, contextConfig)) {
    return res.status(404).json({
      error: 'The specified data could not be found.',
      title: 'Not Found',
      status: 404
    });
  }

  // Validate against database (OdsInstanceContexts table)
  const tenantId = req.params.tenantId || null;
  const dbType = process.env.DB_TYPE || 'postgres';

  try {
    const isValid = await validateContextValueFromDatabase(
      contextConfig.parameterName,
      contextValue,
      tenantId,
      dbType
    );

    if (!isValid) {
      return res.status(404).json({
        error: 'The specified data could not be found.',
        title: 'Not Found',
        status: 404
      });
    }

    next();
  } catch (error) {
    console.error('[Discovery] Error validating context value:', error);
    return res.status(404).json({
      error: 'The specified data could not be found.',
      title: 'Not Found',
      status: 404
    });
  }
}

/**
 * Middleware to validate tenant exists in configuration (multi-tenant mode only)
 * Only validates if tenant is provided in the route
 */
function validateTenantMiddleware(req, res, next) {
  if (!isMultiTenancyEnabled()) {
    return next();
  }

  const tenantId = req.params.tenantId;

  if (!tenantId) {
    // Tenant not provided in route, skip validation (allows root path)
    return next();
  }

  // Validate tenant exists in TENANTS_CONFIG
  const tenantsConfig = getTenantsConfig();
  if (tenantsConfig) {
    const normalizedTenantId = tenantId.toLowerCase();
    const tenantKey = Object.keys(tenantsConfig).find(
      key => key.toLowerCase() === normalizedTenantId
    );

    if (!tenantKey) {
      return res.status(404).json({
        error: 'The specified data could not be found.',
        title: 'Not Found',
        status: 404
      });
    }
  }

  next();
}

const multiTenancyEnabled = isMultiTenancyEnabled();
const contextConfig = getOdsContextConfig();

// Mount routes based on configuration
if (multiTenancyEnabled && contextConfig) {
  // Multi-tenant with context: 3 routes
  // 1. Full path with both parameters
  router.get(`/:tenantId/:${contextConfig.parameterName}`, validateTenantMiddleware, validateContextMiddleware, getDiscovery);
  // 2. Tenant only
  router.get('/:tenantId', validateTenantMiddleware, getDiscovery);
  // 3. Root path
  router.get('/', getDiscovery);
} else if (multiTenancyEnabled && !contextConfig) {
  // Multi-tenant without context: 2 routes
  // 1. Tenant path
  router.get('/:tenantId', validateTenantMiddleware, getDiscovery);
  // 2. Root path
  router.get('/', getDiscovery);
} else if (!multiTenancyEnabled && contextConfig) {
  // Single-tenant with context: 2 routes
  // 1. Context path
  router.get(`/:${contextConfig.parameterName}`, validateContextMiddleware, getDiscovery);
  // 2. Root path
  router.get('/', getDiscovery);
} else {
  // Single-tenant without context: 1 route
  router.get('/', getDiscovery);
}

export default router;
