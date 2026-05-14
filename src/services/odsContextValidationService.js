// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import knex from 'knex';
import { getConnectionConfig, parseConnectionString, getOdsInstances, isExternalOdsInstanceConfigEnabled } from '../config/multi-tenancy-config.js';
import { buildPostgresSslConfig } from '../config/postgres-ssl.js';

/**
 * ODS Context Validation Service
 * Validates context values (e.g., schoolYearFromRoute or instanceId) against OdsInstanceContexts table in EdFi_Admin
 */

/**
 * Cache for admin database connections
 */
const adminConnections = new Map();

/**
 * Get valid context values from external ODS instances configuration
 * Returns array of unique context values for the given context key from OdsInstances config
 */
function getContextValuesFromExternalConfig(contextKey, tenantId = null) {
  const odsInstances = getOdsInstances(tenantId);
  if (!odsInstances) {
    return null;
  }

  const contextValues = new Set();

  // Iterate through all ODS instances in the config
  Object.values(odsInstances).forEach(instanceConfig => {
    if (instanceConfig?.ContextValueByKey?.[contextKey]) {
      contextValues.add(String(instanceConfig.ContextValueByKey[contextKey]));
    }
  });

  if (contextValues.size === 0) {
    return null;
  }

  return Array.from(contextValues);
}

/**
 * Validate context value from external ODS instances configuration
 */
function validateContextValueFromExternalConfig(contextKey, contextValue, tenantId = null) {
  const contextValues = getContextValuesFromExternalConfig(contextKey, tenantId);
  if (!contextValues) {
    return false;
  }

  return contextValues.includes(String(contextValue));
}

/**
 * Get or create admin database connection
 */
function getAdminConnection(tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  const cacheKey = tenantId ? `${tenantId}_${dbType}` : dbType;

  // Return cached connection if exists
  if (adminConnections.has(cacheKey)) {
    return adminConnections.get(cacheKey);
  }

  // Get admin connection configuration
  const connectionConfig = getConnectionConfig(tenantId, dbType);

  // Create Knex configuration
  const baseConfig = {
    pool: {
      min: 0,
      max: 5,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000
    },
    acquireConnectionTimeout: 30000,
    debug: process.env.NODE_ENV === 'dev'
  };

  let knexConfig;
  if (dbType === 'mssql') {
    knexConfig = {
      ...baseConfig,
      client: 'mssql',
      connection: {
        server: connectionConfig.server,
        database: connectionConfig.database,
        user: connectionConfig.user,
        password: connectionConfig.password,
        port: connectionConfig.port,
        options: {
          encrypt: connectionConfig.encrypt ?? false,
          trustServerCertificate: connectionConfig.trustServerCertificate ?? true,
          enableArithAbort: true,
          useUTC: false
        },
        connectionTimeout: 30000,
        requestTimeout: 30000
      }
    };
  } else {
    // PostgreSQL
    const sslConfig = buildPostgresSslConfig('OdsContextValidation');

    knexConfig = {
      ...baseConfig,
      client: 'pg',
      connection: {
        host: connectionConfig.host,
        port: connectionConfig.port,
        user: connectionConfig.user,
        password: connectionConfig.password,
        database: connectionConfig.database,
        ssl: sslConfig
      }
    };
  }

  const connection = knex(knexConfig);
  adminConnections.set(cacheKey, connection);

  return connection;
}

/**
 * Query OdsInstanceContexts table to get valid context values
 */
export async function getValidContextValues(contextKey, tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  try {
    const externalConfigEnabled = isExternalOdsInstanceConfigEnabled();
    if (externalConfigEnabled) {
      // Get context values from external configuration
      const externalContextValues = getContextValuesFromExternalConfig(contextKey, tenantId);
      if (externalContextValues && externalContextValues.length > 0) {
        console.log(`[OdsContextValidation] Retrieved context values for '${contextKey}' from external configuration`);
        return externalContextValues;
      }
      else{
      console.warn(`[OdsContextValidation] EXTERNAL_ODSINSTANCE_CONFIG is enabled but context key '${contextKey}' not found in external configuration`);
      return [];
      }
    }

    // Fall back to database query
    const adminDb = getAdminConnection(tenantId, dbType);

    // Query OdsInstanceContexts table
    // Table structure: OdsInstance_OdsInstanceId, ContextKey, ContextValue
    const results = await adminDb('dbo.odsinstancecontexts')
      .select('contextvalue')
      .where('contextkey', contextKey)
      .distinct();

    console.log(`[OdsContextValidation] Retrieved context values for '${contextKey}' from database`);
    return results.map(row => String(row.contextvalue));
  } catch (error) {
    console.error(`[OdsContextValidation] Error querying OdsInstanceContexts for contextKey '${contextKey}':`, error.message);
    return [];
  }
}

/**
 * Validate context value against OdsInstanceContexts table
 */
export async function validateContextValueFromDatabase(contextKey, contextValue, tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  try {
    const externalConfigEnabled = isExternalOdsInstanceConfigEnabled();

    // Check if external config is enabled and validate against it first
    if (externalConfigEnabled) {
      const isValidInExternalConfig = validateContextValueFromExternalConfig(contextKey, contextValue, tenantId);
      if (isValidInExternalConfig) {
        console.log(`[OdsContextValidation] Validated context value '${contextValue}' for contextKey '${contextKey}' from external configuration`);
        return true;
      }
      else{
      console.warn(`[OdsContextValidation] EXTERNAL_ODSINSTANCE_CONFIG is enabled but context value '${contextValue}' for contextKey '${contextKey}' not found in external configuration`);
      return false;
      }
    }

    // Fall back to database query
    const adminDb = getAdminConnection(tenantId, dbType);

    // Query OdsInstanceContexts table for exact match
    const result = await adminDb('dbo.odsinstancecontexts')
      .where('contextkey', contextKey)
      .where('contextvalue', contextValue)
      .first();

    if (result) {
      console.log(`[OdsContextValidation] Validated context value '${contextValue}' for contextKey '${contextKey}' from database`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[OdsContextValidation] Error validating context value '${contextValue}' for contextKey '${contextKey}':`, error.message);
    return false;
  }
}

/**
 * Close all admin database connections
 */
export async function closeAdminConnections() {
  const promises = Array.from(adminConnections.values()).map(conn => conn.destroy());
  adminConnections.clear();
  await Promise.all(promises);
}
