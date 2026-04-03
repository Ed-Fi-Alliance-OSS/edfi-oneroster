// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import { getOdsContextConfig } from '../config/ods-context-config.js';
import { getValidContextValues } from './odsContextValidationService.js';

/**
 * Build Swagger servers array with dynamic tenant/context selection
 * @param {string} baseUrl - Base URL from request
 * @returns {Promise<Array>} Array of server configurations for Swagger
 */
export async function buildSwaggerServers(baseUrl) {
  const multiTenancyEnabled = isMultiTenancyEnabled();
  const contextConfig = getOdsContextConfig();
  const dbType = process.env.DB_TYPE || 'postgres';

  // Case 1: Single-tenant without context - simple server
  if (!multiTenancyEnabled && !contextConfig) {
    return [{ url: baseUrl }];
  }

  // Case 2: Single-tenant with context - context selection dropdown
  if (!multiTenancyEnabled && contextConfig) {
    try {
      const contextValues = await getValidContextValues(contextConfig.parameterName, null, dbType);

      if (contextValues.length === 0) {
        // No context values found, return base URL
        return [{ url: baseUrl }];
      }

      return [{
        url: `${baseUrl}/{${contextConfig.parameterName}}`,
        variables: {
          [contextConfig.parameterName]: {
            default: contextValues[0],
            enum: contextValues,
            description: `Select ${contextConfig.parameterName}`
          }
        }
      }];
    } catch (error) {
      console.error('[SwaggerServerBuilder] Error fetching context values:', error);
      return [{ url: baseUrl }];
    }
  }

  // Case 3: Multi-tenant without context - tenant selection dropdown
  if (multiTenancyEnabled && !contextConfig) {
    const tenantsConfig = getTenantsConfig();
    if (!tenantsConfig) {
      return [{ url: baseUrl }];
    }

    const tenantIds = Object.keys(tenantsConfig);
    if (tenantIds.length === 0) {
      return [{ url: baseUrl }];
    }

    return [{
      url: `${baseUrl}/{tenantId}`,
      variables: {
        tenantId: {
          default: tenantIds[0],
          enum: tenantIds,
          description: 'Select Tenant'
        }
      }
    }];
  }

  // Case 4: Multi-tenant with context - tenant and context selection dropdowns
  if (multiTenancyEnabled && contextConfig) {
    const tenantsConfig = getTenantsConfig();
    if (!tenantsConfig) {
      return [{ url: baseUrl }];
    }

    const tenantIds = Object.keys(tenantsConfig);
    if (tenantIds.length === 0) {
      return [{ url: baseUrl }];
    }

    try {
      // Get context values from first tenant (assuming same context values across tenants)
      const contextValues = await getValidContextValues(contextConfig.parameterName, tenantIds[0], dbType);

      if (contextValues.length === 0) {
        // No context values, just tenant selection
        return [{
          url: `${baseUrl}/{tenantId}`,
          variables: {
            tenantId: {
              default: tenantIds[0],
              enum: tenantIds,
              description: 'Select Tenant'
            }
          }
        }];
      }

      // Both tenant and context selection
      return [{
        url: `${baseUrl}/{tenantId}/{${contextConfig.parameterName}}`,
        variables: {
          tenantId: {
            default: tenantIds[0],
            enum: tenantIds,
            description: 'Select Tenant'
          },
          [contextConfig.parameterName]: {
            default: contextValues[0],
            enum: contextValues,
            description: `Select ${contextConfig.parameterName}`
          }
        }
      }];
    } catch (error) {
      console.error('[SwaggerServerBuilder] Error fetching context values:', error);
      // Fallback to just tenant selection
      return [{
        url: `${baseUrl}/{tenantId}`,
        variables: {
          tenantId: {
            default: tenantIds[0],
            enum: tenantIds,
            description: 'Select Tenant'
          }
        }
      }];
    }
  }

  // Fallback
  return [{ url: baseUrl }];
}
