// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import { getOdsContextConfig } from '../config/ods-context-config.js';
import { getValidContextValues } from './odsContextValidationService.js';

/**
 * Build Swagger security schemes with separate OAuth configurations for each tenant/context
 * @param {string} oauthBaseUrl - Base OAuth URL (e.g., http://localhost:54746)
 * @param {object} existingScopes - Existing OAuth scopes from swagger.yml
 * @returns {Promise<Object>} Security schemes object
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
          tokenUrl: `${oauthBaseUrl}/oauth/token`,
          scopes: existingScopes
        }
      }
    };
    return securitySchemes;
  }

  // Case 2: Single-tenant with context - single oauth2_client_credentials scheme
  if (!multiTenancyEnabled && contextConfig) {
    securitySchemes.oauth2_client_credentials = {
      type: 'oauth2',
      description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
      flows: {
        clientCredentials: {
          tokenUrl: `${oauthBaseUrl}/oauth/token`,
          scopes: existingScopes
        }
      }
    };
    return securitySchemes;
  }

  // Case 3: Multi-tenant without context - one scheme per tenant
  if (multiTenancyEnabled && !contextConfig) {
    const tenantsConfig = getTenantsConfig();
    if (!tenantsConfig) {
      securitySchemes.oauth2_auth = {
        type: 'oauth2',
        description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
        flows: {
          clientCredentials: {
            tokenUrl: `${oauthBaseUrl}/oauth/token`,
            scopes: existingScopes
          }
        }
      };
      return securitySchemes;
    }

    const tenantIds = Object.keys(tenantsConfig);
    if (tenantIds.length === 0) {
      securitySchemes.oauth2_auth = {
        type: 'oauth2',
        description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
        flows: {
          clientCredentials: {
            tokenUrl: `${oauthBaseUrl}/oauth/token`,
            scopes: existingScopes
          }
        }
      };
      return securitySchemes;
    }

    // Create scheme for each tenant
    for (const tenantId of tenantIds) {
      const schemeName = `${tenantId}_oauth2_client_credentials`;
      securitySchemes[schemeName] = {
        type: 'oauth2',
        description: `Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization (${tenantId})`,
        flows: {
          clientCredentials: {
            tokenUrl: `${oauthBaseUrl}/${tenantId}/oauth/token`,
            scopes: existingScopes
          }
        }
      };
    }
    return securitySchemes;
  }

  // Case 4: Multi-tenant with context - one scheme per tenant only
  if (multiTenancyEnabled && contextConfig) {
    const tenantsConfig = getTenantsConfig();
    if (!tenantsConfig) {
      securitySchemes.oauth2_auth = {
        type: 'oauth2',
        description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
        flows: {
          clientCredentials: {
            tokenUrl: `${oauthBaseUrl}/oauth/token`,
            scopes: existingScopes
          }
        }
      };
      return securitySchemes;
    }

    const tenantIds = Object.keys(tenantsConfig);
    if (tenantIds.length === 0) {
      securitySchemes.oauth2_auth = {
        type: 'oauth2',
        description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
        flows: {
          clientCredentials: {
            tokenUrl: `${oauthBaseUrl}/oauth/token`,
            scopes: existingScopes
          }
        }
      };
      return securitySchemes;
    }

    // Create one scheme per tenant (not per context)
    for (const tenantId of tenantIds) {
      const schemeName = `${tenantId}_oauth2_client_credentials`;
      securitySchemes[schemeName] = {
        type: 'oauth2',
        description: `Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization (${tenantId})`,
        flows: {
          clientCredentials: {
            tokenUrl: `${oauthBaseUrl}/${tenantId}/oauth/token`,
            scopes: existingScopes
          }
        }
      };
    }
    return securitySchemes;
  }

  // Fallback
  securitySchemes.oauth2_auth = {
    type: 'oauth2',
    description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
    flows: {
      clientCredentials: {
        tokenUrl: `${oauthBaseUrl}/oauth/token`,
        scopes: existingScopes
      }
    }
  };
  return securitySchemes;
}
