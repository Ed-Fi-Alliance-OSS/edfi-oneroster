// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Multi-Tenancy Configuration Utility
 * Manages tenant-specific EdFi_Admin database connection strings
 *
 * Important: These connections are for EdFi_Admin databases, NOT ODS databases.
 * The actual ODS connection strings are stored encrypted in EdFi_Admin.OdsInstances table
 * and are resolved at runtime based on JWT OdsInstanceId claim.
 */

/**
 * Check if multi-tenancy is enabled
 * @returns {boolean}
 */
function isMultiTenancyEnabled() {
  return process.env.MULTI_TENANCY === 'true';
}

/**
 * Parse tenant configuration from environment variables
 * Expects JSON string in TENANTS_CONFIG environment variable
 *
 * Format:
 * {
 *   "Tenant1": {
 *     "adminConnection": "host=localhost;port=5432;database=EdFi_Admin_Tenant1;username=postgres;password=..."
 *   },
 *   "Tenant2": {
 *     "adminConnection": "server=(local);database=EdFi_Admin_Tenant2;user id=sa;password=..."
 *   }
 * }
 *
 * @returns {Object|null} Parsed tenants configuration or null if not configured
 */
function getTenantsConfig() {
  if (!isMultiTenancyEnabled()) {
    return null;
  }

  const tenantsConfigJson = process.env.TENANTS_CONFIG;
  if (!tenantsConfigJson) {
    console.warn('[MultiTenancy] MULTI_TENANCY is enabled but TENANTS_CONFIG is not set');
    return null;
  }

  try {
    return JSON.parse(tenantsConfigJson);
  } catch (error) {
    console.error('[MultiTenancy] Failed to parse TENANTS_CONFIG:', error.message);
    return null;
  }
}

/**
 * Parse a connection string into connection object
 * Supports both MSSQL and PostgreSQL connection string formats
 * @param {string} connectionString - Connection string to parse
 * @param {string} dbType - Database type ('mssql' or 'postgres')
 * @returns {Object} Connection configuration object
 */
function parseConnectionString(connectionString, dbType) {
  const config = {};

  if (dbType === 'mssql') {
    // Parse MSSQL connection string format:
    // server=(local);database=EdFi_Admin;user id=sa;password=pass;encrypt=false
    const parts = connectionString.split(';').filter(p => p.trim());
    parts.forEach(part => {
      const [key, value] = part.split('=').map(s => s.trim());
      const lowerKey = key.toLowerCase();

      if (lowerKey === 'server' || lowerKey === 'data source') {
        config.server = value.replace(/^\(local\)$/, 'localhost');
      } else if (lowerKey === 'database' || lowerKey === 'initial catalog') {
        config.database = value;
      } else if (lowerKey === 'user id' || lowerKey === 'uid') {
        config.user = value;
      } else if (lowerKey === 'password' || lowerKey === 'pwd') {
        config.password = value;
      } else if (lowerKey === 'port') {
        config.port = parseInt(value, 10);
      } else if (lowerKey === 'encrypt') {
        config.encrypt = value.toLowerCase() === 'true';
      } else if (lowerKey === 'trustservercertificate' || lowerKey === 'trust server certificate') {
        config.trustServerCertificate = value.toLowerCase() === 'true';
      }
    });

    // Set defaults
    if (!config.port) config.port = 1433;
    if (config.encrypt === undefined) config.encrypt = false;
    if (config.trustServerCertificate === undefined) config.trustServerCertificate = true;

  } else {
    // Parse PostgreSQL connection string format:
    // host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=pass
    const parts = connectionString.split(';').filter(p => p.trim());
    parts.forEach(part => {
      const [key, value] = part.split('=').map(s => s.trim());
      const lowerKey = key.toLowerCase();

      if (lowerKey === 'host' || lowerKey === 'server') {
        config.host = value;
      } else if (lowerKey === 'port') {
        config.port = parseInt(value, 10);
      } else if (lowerKey === 'database') {
        config.database = value;
      } else if (lowerKey === 'username' || lowerKey === 'user id' || lowerKey === 'user') {
        config.user = value;
      } else if (lowerKey === 'password') {
        config.password = value;
      }
    });

    // Set defaults
    if (!config.port) config.port = 5432;
  }

  return config;
}

/**
 * Get tenant-specific EdFi_Admin connection configuration
 * @param {string} tenantId - Tenant identifier
 * @param {string} dbType - Database type ('mssql' or 'postgres')
 * @returns {Object|null} Tenant EdFi_Admin connection configuration or null if not found
 */
function getTenantConnectionConfig(tenantId, dbType = process.env.DB_TYPE || 'postgres') {
  if (!isMultiTenancyEnabled() || !tenantId) {
    return null;
  }

  const tenantsConfig = getTenantsConfig();
  if (!tenantsConfig) {
    return null;
  }

  // Normalize tenant ID to match configuration keys (case-insensitive)
  const normalizedTenantId = tenantId.toLowerCase();
  const tenantKey = Object.keys(tenantsConfig).find(
    key => key.toLowerCase() === normalizedTenantId
  );

  if (!tenantKey) {
    console.warn(`[MultiTenancy] Tenant '${tenantId}' not found in configuration`);
    return null;
  }

  const tenantConfig = tenantsConfig[tenantKey];

  // Get EdFi_Admin connection string
  const connectionString = tenantConfig.adminConnection;

  if (!connectionString) {
    console.warn(`[MultiTenancy] No EdFi_Admin connection string found for tenant '${tenantId}'. Expected property: adminConnection`);
    return null;
  }

  return parseConnectionString(connectionString, dbType);
}

/**
 * Get default EdFi_Admin connection configuration from environment variables
 * @param {string} dbType - Database type ('mssql' or 'postgres')
 * @returns {Object} Default EdFi_Admin connection configuration
 */
function getDefaultConnectionConfig(dbType = process.env.DB_TYPE || 'postgres') {
  if (dbType === 'mssql') {
    return {
      server: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      port: parseInt(process.env.DB_PORT) || 1433,
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    };
  } else {
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    };
  }
}

/**
 * Get EdFi_Admin connection configuration (tenant-aware)
 * This returns the EdFi_Admin database connection, NOT the ODS connection.
 * The ODS connection is resolved later from EdFi_Admin.OdsInstances table.
 *
 * Falls back to default connection if multi-tenancy is disabled or tenant not found
 * @param {string|null} tenantId - Tenant identifier (optional, from route in multi-tenant mode)
 * @param {string} dbType - Database type ('mssql' or 'postgres')
 * @returns {Object} EdFi_Admin connection configuration
 */
function getConnectionConfig(tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  // Try to get tenant-specific EdFi_Admin configuration
  if (tenantId) {
    const tenantConfig = getTenantConnectionConfig(tenantId, dbType);
    if (tenantConfig) {
      console.log(`[MultiTenancy] Using tenant-specific EdFi_Admin connection for '${tenantId}'`);
      return tenantConfig;
    }
  }

  // Fall back to default EdFi_Admin configuration
  console.log(`[MultiTenancy] Using default EdFi_Admin connection configuration`);
  return getDefaultConnectionConfig(dbType);
}

/**
 * Get EdFi_Admin connection string for ODS resolution
 * Returns connection string suitable for OdsInstanceService
 * @param {string|null} tenantId - Tenant identifier (optional)
 * @param {string} dbType - Database type ('mssql' or 'postgres')
 * @returns {string} EdFi_Admin connection string
 */
function getAdminConnectionString(tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  if (tenantId && isMultiTenancyEnabled()) {
    const tenantsConfig = getTenantsConfig();
    if (tenantsConfig) {
      const normalizedTenantId = tenantId.toLowerCase();
      const tenantKey = Object.keys(tenantsConfig).find(
        key => key.toLowerCase() === normalizedTenantId
      );

      if (tenantKey) {
        const tenantConfig = tenantsConfig[tenantKey];
        const connectionString = tenantConfig.adminConnection;

        if (connectionString) {
          return connectionString;
        }
      }
    }
  }

  // Build default connection string from environment
  const config = getDefaultConnectionConfig(dbType);
  if (dbType === 'mssql') {
    return `server=${config.server};database=${config.database};user id=${config.user};password=${config.password};port=${config.port};encrypt=${config.encrypt};trustservercertificate=${config.trustServerCertificate}`;
  } else {
    return `host=${config.host};port=${config.port};database=${config.database};username=${config.user};password=${config.password}`;
  }
}

export {
  isMultiTenancyEnabled,
  getTenantsConfig,
  getTenantConnectionConfig,
  getDefaultConnectionConfig,
  getConnectionConfig,
  getAdminConnectionString,
  parseConnectionString
};
