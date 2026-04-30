// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Environment Variable Validator
 * Validates required environment variables before application startup
 */

/**
 * Validates all required environment variables
 * @returns {Object} - { isValid: boolean, errors: string[] }
 */
export function validateEnvironmentVariables() {
  const errors = [];

  // 1. PORT: If set, must be a valid integer in range 1-65535. If unset, server.js will default to 3000.
  if (process.env.PORT) {
    const portNum = parseInt(process.env.PORT, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push('PORT must be a valid integer between 1 and 65535 if set');
    }
  }

  // 2. DB_TYPE must be either mssql or postgres
  if (!process.env.DB_TYPE) {
    errors.push('DB_TYPE must not be empty');
  } else if (process.env.DB_TYPE !== 'mssql' && process.env.DB_TYPE !== 'postgres') {
    errors.push('DB_TYPE must be either "mssql" or "postgres"');
  }

  // 3. ODS_CONNECTION_STRING_ENCRYPTION_KEY must not be empty
  if (!process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY) {
    errors.push('ODS_CONNECTION_STRING_ENCRYPTION_KEY must not be empty');
  }

  const isMultiTenancyEnabled = process.env.MULTITENANCY_ENABLED === 'true';

  // 4. CONNECTION_CONFIG must be valid JSON with adminConnection if MULTITENANCY_ENABLED is false
  if (!isMultiTenancyEnabled) {
    if (!process.env.CONNECTION_CONFIG) {
      errors.push('CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is false');
    } else {
      try {
        const config = JSON.parse(process.env.CONNECTION_CONFIG);
        if (!config.adminConnection || typeof config.adminConnection !== 'string' || !config.adminConnection.trim()) {
          errors.push('CONNECTION_CONFIG must contain a non-empty adminConnection property');
        }
      } catch (e) {
        errors.push('CONNECTION_CONFIG must be valid JSON');
      }
    }
  }

  // 5. PG_BOSS_CONNECTION_CONFIG must be valid JSON with adminConnection if DB_TYPE is postgres
  if (process.env.DB_TYPE === 'postgres') {
    if (!process.env.PG_BOSS_CONNECTION_CONFIG) {
      errors.push('PG_BOSS_CONNECTION_CONFIG must not be empty when DB_TYPE is postgres');
    } else {
      try {
        const config = JSON.parse(process.env.PG_BOSS_CONNECTION_CONFIG);
        if (!config.adminConnection || typeof config.adminConnection !== 'string' || !config.adminConnection.trim()) {
          errors.push('PG_BOSS_CONNECTION_CONFIG must contain a non-empty adminConnection property');
        }
      } catch (e) {
        errors.push('PG_BOSS_CONNECTION_CONFIG must be valid JSON');
      }
    }
  }

  // 6. OAUTH2_ISSUERBASEURL must not be empty
  if (!process.env.OAUTH2_ISSUERBASEURL) {
    errors.push('OAUTH2_ISSUERBASEURL must not be empty');
  }

  // 7. OAUTH2_AUDIENCE must not be empty
  if (!process.env.OAUTH2_AUDIENCE) {
    errors.push('OAUTH2_AUDIENCE must not be empty');
  }

  // 8. OAUTH2_TOKENSIGNINGALG must be RS256
  if (!process.env.OAUTH2_TOKENSIGNINGALG) {
    errors.push('OAUTH2_TOKENSIGNINGALG must not be empty');
  } else if (process.env.OAUTH2_TOKENSIGNINGALG !== 'RS256') {
    errors.push('OAUTH2_TOKENSIGNINGALG must be "RS256"');
  }

  // 9. OAUTH2_PUBLIC_KEY_PEM must not be empty
  if (!process.env.OAUTH2_PUBLIC_KEY_PEM) {
    errors.push('OAUTH2_PUBLIC_KEY_PEM must not be empty');
  }

  // 10. TENANTS_CONNECTION_CONFIG must be valid JSON mapping tenant IDs to objects with adminConnection if MULTITENANCY_ENABLED is true
  if (isMultiTenancyEnabled) {
    if (!process.env.TENANTS_CONNECTION_CONFIG) {
      errors.push('TENANTS_CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is true');
    } else {
      try {
        const tenants = JSON.parse(process.env.TENANTS_CONNECTION_CONFIG);
        if (typeof tenants !== 'object' || tenants === null || Array.isArray(tenants)) {
          errors.push('TENANTS_CONNECTION_CONFIG must be a JSON object mapping tenant IDs to config objects');
        } else {
          for (const [tenantId, config] of Object.entries(tenants)) {
            if (!config || typeof config !== 'object' || !config.adminConnection || typeof config.adminConnection !== 'string' || !config.adminConnection.trim()) {
              errors.push(`TENANTS_CONNECTION_CONFIG: tenant '${tenantId}' must have a non-empty adminConnection property`);
            }
          }
        }
      } catch (e) {
        errors.push('TENANTS_CONNECTION_CONFIG must be valid JSON');
      }
    }
  }

  const isHttpsEnabled = process.env.ENABLE_HTTPS === 'true';

  // 11. TLS_KEY_PATH must not be empty if ENABLE_HTTPS is true
  if (isHttpsEnabled && !process.env.TLS_KEY_PATH) {
    errors.push('TLS_KEY_PATH must not be empty when ENABLE_HTTPS is true');
  }

  // 12. TLS_CERT_PATH must not be empty if ENABLE_HTTPS is true
  if (isHttpsEnabled && !process.env.TLS_CERT_PATH) {
    errors.push('TLS_CERT_PATH must not be empty when ENABLE_HTTPS is true');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates environment variables and exits the process if validation fails
 * Logs all validation errors to the console
 */
export function validateAndExit() {
  const { isValid, errors } = validateEnvironmentVariables();

  if (!isValid) {
    console.error('Environment variable validation failed:\n');
    errors.forEach((error, index) => {
      console.error(`  ${index + 1}. ${error}`);
    });
    console.error('Application startup aborted due to invalid configuration.\n');
    process.exit(1);
  }

  console.log('Environment variable validation passed');
}
