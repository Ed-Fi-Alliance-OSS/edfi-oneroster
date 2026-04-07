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
        url: `${baseUrl}/{Context Selection}`,
        variables: {
          'Context Selection': {
            default: contextValues[0],
            enum: contextValues,
            description: 'Context Selection'
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
      url: `${baseUrl}/{Tenant Selection}`,
      variables: {
        'Tenant Selection': {
          default: tenantIds[0],
          enum: tenantIds,
          description: 'Tenant Selection'
        }
      }
    }];
  }

  // Case 4: Multi-tenant with context - combined tenant/context selection dropdown
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
      // Build combined tenant/context values
      const combinedValues = [];

      for (const tenantId of tenantIds) {
        const contextValues = await getValidContextValues(contextConfig.parameterName, tenantId, dbType);

        if (contextValues.length > 0) {
          // Add tenant with each context value
          for (const contextValue of contextValues) {
            combinedValues.push(`${tenantId}/${contextValue}`);
          }
        } else {
          // Add tenant without context if no context values found
          combinedValues.push(tenantId);
        }
      }

      if (combinedValues.length === 0) {
        // No values found, just tenant selection
        return [{
          url: `${baseUrl}/{Tenant Selection}`,
          variables: {
            'Tenant Selection': {
              default: tenantIds[0],
              enum: tenantIds,
              description: 'Tenant Selection'
            }
          }
        }];
      }

      // Combined tenant/context selection
      return [{
        url: `${baseUrl}/{Tenant/Context Selection}`,
        variables: {
          'Tenant/Context Selection': {
            default: combinedValues[0],
            enum: combinedValues,
            description: 'Tenant/Context Selection'
          }
        }
      }];
    } catch (error) {
      console.error('[SwaggerServerBuilder] Error fetching context values:', error);
      // Fallback to just tenant selection
      return [{
        url: `${baseUrl}/{Tenant Selection}`,
        variables: {
          'Tenant Selection': {
            default: tenantIds[0],
            enum: tenantIds,
            description: 'Tenant Selection'
          }
        }
      }];
    }
  }

  // Fallback
  return [{ url: baseUrl }];
}
