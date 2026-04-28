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

  // 1. PORT must not be empty
  if (!process.env.PORT) {
    errors.push('PORT must not be empty');
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

  // 4. CONNECTION_CONFIG must not be empty if MULTITENANCY_ENABLED is false
  if (!isMultiTenancyEnabled && !process.env.CONNECTION_CONFIG) {
    errors.push('CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is false');
  }

  // 5. PG_BOSS_CONNECTION_CONFIG must not be empty if DB_TYPE is postgres
  if (process.env.DB_TYPE === 'postgres' && !process.env.PG_BOSS_CONNECTION_CONFIG) {
    errors.push('PG_BOSS_CONNECTION_CONFIG must not be empty when DB_TYPE is postgres');
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

  // 10. TENANTS_CONNECTION_CONFIG must not be empty if MULTITENANCY_ENABLED is true
  if (isMultiTenancyEnabled && !process.env.TENANTS_CONNECTION_CONFIG) {
    errors.push('TENANTS_CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is true');
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
    console.error('\n❌ Environment variable validation failed:\n');
    errors.forEach((error, index) => {
      console.error(`  ${index + 1}. ${error}`);
    });
    console.error('\n❌ Application startup aborted due to invalid configuration.\n');
    process.exit(1);
  }

  console.log('✅ Environment variable validation passed');
}
