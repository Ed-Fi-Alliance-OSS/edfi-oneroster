// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import { getOdsContextConfig } from '../config/ods-context-config.js';
import { getValidContextValues } from './odsContextValidationService.js';
import { joinUrl } from '../utils/urlHelper.js';

/**
 * Build Swagger security schemes with separate OAuth configurations for each tenant/context
 */
export async function buildSwaggerSecuritySchemes(oauthBaseUrl, existingScopes = {}) {
  const multiTenancyEnabled = isMultiTenancyEnabled();
  const contextConfig = getOdsContextConfig();
  const dbType = process.env.DB_TYPE || 'postgres';

  const securitySchemes = {};

  // Case 1: Single-tenant without context - single oauth2_auth
  if (!multiTenancyEnabled && !contextConfig) {
    securitySchemes.oauth2_auth = {
      type: 'oauth2',
      description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
      flows: {
        clientCredentials: {
          tokenUrl: joinUrl(oauthBaseUrl, 'oauth/token'),
          scopes: existingScopes
        }
      }
    };
    return securitySchemes;
  }

  // Case 2: Single-tenant with context - single oauth2_client_credentials scheme
  if (!multiTenancyEnabled && contextConfig) {
    let tokenUrl = joinUrl(oauthBaseUrl, 'oauth/token');
    try {
      const contextValues = await getValidContextValues(contextConfig.parameterName, null, dbType);
      if (contextValues.length > 0) {
        tokenUrl = joinUrl(joinUrl(oauthBaseUrl, contextValues[0]), 'oauth/token');
      }
    } catch (error) {
      console.error(`[SwaggerSecurityBuilder] Error fetching context values:`, error.message);
    }

    securitySchemes.oauth2_client_credentials = {
      type: 'oauth2',
      description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
      flows: {
        clientCredentials: {
          tokenUrl,
          scopes: existingScopes
        }
      }
    };
    return securitySchemes;
  }

  // Case 3: Multi-tenant without context - one scheme per tenant
  if (multiTenancyEnabled && !contextConfig) {
    const tenantsConfig = getTenantsConfig();
    const tenantIds = tenantsConfig ? Object.keys(tenantsConfig) : [];

    if (tenantIds.length > 0) {
      for (const tenantId of tenantIds) {
        const schemeName = `${tenantId}_oauth2_client_credentials`;
        securitySchemes[schemeName] = {
          type: 'oauth2',
          description: `Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization (${tenantId})`,
          flows: {
            clientCredentials: {
              tokenUrl: joinUrl(joinUrl(oauthBaseUrl, tenantId), 'oauth/token'),
              scopes: existingScopes
            }
          }
        };
      }
      return securitySchemes;
    }
  }

  // Case 4: Multi-tenant with context - one scheme per tenant, token URL includes first context value
  if (multiTenancyEnabled && contextConfig) {
    const tenantsConfig = getTenantsConfig();
    const tenantIds = tenantsConfig ? Object.keys(tenantsConfig) : [];

    if (tenantIds.length > 0) {
      for (const tenantId of tenantIds) {
        let tokenUrl = joinUrl(joinUrl(oauthBaseUrl, tenantId), 'oauth/token');
        try {
          const contextValues = await getValidContextValues(contextConfig.parameterName, tenantId, dbType);
          if (contextValues.length > 0) {
            tokenUrl = joinUrl(joinUrl(joinUrl(oauthBaseUrl, tenantId), contextValues[0]), 'oauth/token');
          } else {
            console.warn(`[SwaggerSecurityBuilder] No context values found for tenant '${tenantId}', contextKey '${contextConfig.parameterName}'. Token URL will not include context segment.`);
          }
        } catch (error) {
          console.error(`[SwaggerSecurityBuilder] Error fetching context values for tenant '${tenantId}':`, error.message);
        }

        const schemeName = `${tenantId}_oauth2_client_credentials`;
        securitySchemes[schemeName] = {
          type: 'oauth2',
          description: `Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization (${tenantId})`,
          flows: {
            clientCredentials: {
              tokenUrl,
              scopes: existingScopes
            }
          }
        };
      }
      return securitySchemes;
    }
  }

  // Fallback
  securitySchemes.oauth2_auth = {
    type: 'oauth2',
    description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
    flows: {
      clientCredentials: {
        tokenUrl: joinUrl(oauthBaseUrl, 'oauth/token'),
        scopes: existingScopes
      }
    }
  };
  return securitySchemes;
}
