// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Multi-Tenancy Configuration Utility
 * Manages tenant-specific EdFi_Admin database connection strings
 */

/**
 * Check if multi-tenancy is enabled
 */
function isMultiTenancyEnabled() {
  return process.env.MULTI_TENANCY === 'true';
}

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
 * Tenant EdFi_Admin connection configuration or null if not found
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
 */
function getDefaultConnectionConfig(dbType = process.env.DB_TYPE || 'postgres') {
  const connectionConfigJson = process.env.CONNECTION_CONFIG;

  if (!connectionConfigJson) {
    console.error('[Config] CONNECTION_CONFIG environment variable is not set');
    return null;
  }

  try {
    const connectionConfig = JSON.parse(connectionConfigJson);
    const connectionString = connectionConfig.adminConnection;

    if (!connectionString) {
      console.error('[Config] adminConnection not found in CONNECTION_CONFIG');
      return null;
    }

    return parseConnectionString(connectionString, dbType);
  } catch (error) {
    console.error('[Config] Failed to parse CONNECTION_CONFIG:', error.message);
    return null;
  }
}

/**
 * Get EdFi_Admin connection configuration (tenant-aware)
 * This returns the EdFi_Admin database connection
 */
function getConnectionConfig(tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  if (isMultiTenancyEnabled()) {
    // In multi-tenant mode a tenant ID is required and must resolve — no fallback.
    const tenantConfig = getTenantConnectionConfig(tenantId, dbType);
    if (!tenantConfig) {
      const msg = `[MultiTenancy] No configuration found for tenant '${tenantId}'.`;
      console.error(msg);
      throw new Error(msg);
    }
    return tenantConfig;
  }

  // Single-tenant mode: use default connection from CONNECTION_CONFIG.
  console.log('[Config] Using default EdFi_Admin connection configuration');
  return getDefaultConnectionConfig(dbType);
}

/**
 * Get EdFi_Admin connection string for ODS resolution
 * Returns connection string suitable for OdsInstanceService
 */
function getAdminConnectionString(tenantId = null, dbType = process.env.DB_TYPE || 'postgres') {
  if (isMultiTenancyEnabled()) {
    // In multi-tenant mode a tenant ID is required and must resolve — no fallback.
    const tenantsConfig = getTenantsConfig();
    if (!tenantsConfig) {
      const msg = `[MultiTenancy] TENANTS_CONFIG is not set or invalid. Cannot resolve connection for tenant '${tenantId}'.`;
      console.error(msg);
      throw new Error(msg);
    }

    const normalizedTenantId = tenantId?.toLowerCase();
    const tenantKey = Object.keys(tenantsConfig).find(
      key => key.toLowerCase() === normalizedTenantId
    );

    if (!tenantKey) {
      const msg = `[MultiTenancy] Tenant '${tenantId}' not found in configuration. Cannot fall back to default in multi-tenant mode.`;
      console.error(msg);
      throw new Error(msg);
    }

    const connectionString = tenantsConfig[tenantKey].adminConnection;
    if (!connectionString) {
      const msg = `[MultiTenancy] No adminConnection found for tenant '${tenantId}'.`;
      console.error(msg);
      throw new Error(msg);
    }

    return connectionString;
  }

  // Single-tenant mode: use default connection from CONNECTION_CONFIG.
  const connectionConfigJson = process.env.CONNECTION_CONFIG;
  if (!connectionConfigJson) {
    console.error('[Config] CONNECTION_CONFIG environment variable is not set');
    return '';
  }

  try {
    const connectionConfig = JSON.parse(connectionConfigJson);
    return connectionConfig.adminConnection || '';
  } catch (error) {
    console.error('[Config] Failed to parse CONNECTION_CONFIG:', error.message);
    return '';
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
