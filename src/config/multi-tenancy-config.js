// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import fs from 'fs';
import { buildPostgresSslConfig } from './postgres-ssl.js';
import { resolveEsmModuleSpecifier } from './resolve-esm-module-specifier.js';

/**
 * Multi-Tenancy Configuration Utility
 * Manages tenant-specific EdFi_Admin database connection strings
 */

let cachedTenantsConfig = null;

function getTenantsConfigSource() {
  return (process.env.TENANTS_CONFIG_MODULE || '').trim() !== '' ? 'plugin' : 'env';
}

function isTenantsConfigFromPlugin() {
  return getTenantsConfigSource() === 'plugin';
}

/**
 * Check if multi-tenancy is enabled
 */
function isMultiTenancyEnabled() {
  return process.env.MULTITENANCY_ENABLED === 'true';
}

function getTenantsConfigFromEnv() {
  const tenantsConfigJson = process.env.TENANTS_CONNECTION_CONFIG;
  if (!tenantsConfigJson) {
    console.warn('[MultiTenancy] MULTITENANCY_ENABLED is true but TENANTS_CONNECTION_CONFIG is not set');
    return null;
  }

  try {
    return JSON.parse(tenantsConfigJson);
  } catch (error) {
    console.error('[MultiTenancy] Failed to parse TENANTS_CONNECTION_CONFIG:', error.message);
    return null;
  }
}

function getTenantsConfig() {
  if (!isMultiTenancyEnabled()) {
    return null;
  }

  if (isTenantsConfigFromPlugin()) {
    return cachedTenantsConfig;
  }

  return getTenantsConfigFromEnv();
}

async function refreshTenantsConfig(reason = 'signal') {
  if (!isMultiTenancyEnabled() || !isTenantsConfigFromPlugin()) {
    if (reason === 'signal') {
      console.log('[MultiTenancy] refreshTenantsConfig skipped (not MULTITENANCY_ENABLED or TENANTS_CONFIG_MODULE not set)');
    }
    return;
  }

  console.log(`[MultiTenancy] Loading tenants via plugin (${reason})...`);
  const moduleHref = resolveEsmModuleSpecifier(process.env.TENANTS_CONFIG_MODULE || '');
  const mod = await import(moduleHref);
  if (typeof mod.loadTenantsConfig !== 'function') {
    throw new Error('Tenant configuration plugin must export async function loadTenantsConfig');
  }
  cachedTenantsConfig = await mod.loadTenantsConfig();
  const count = cachedTenantsConfig ? Object.keys(cachedTenantsConfig).length : 0;
  console.log(`[MultiTenancy] Loaded ${count} tenant(s) via plugin`);
}

async function initializeTenantsConfig() {
  if (!isMultiTenancyEnabled() || !isTenantsConfigFromPlugin()) {
    return;
  }

  await refreshTenantsConfig('startup');

  if (!cachedTenantsConfig || Object.keys(cachedTenantsConfig).length === 0) {
    console.warn('[MultiTenancy] Tenant list is empty at startup (use SIGUSR2 to reload after tenants are available)');
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
      const [key, ...rest] = part.split('=');
      const value = rest.join('=').trim();
      const lowerKey = key.trim().toLowerCase();

      if (lowerKey === 'server' || lowerKey === 'data source') {
        config.server = value.replace(/^\(local\)$/i, 'localhost');
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
    // host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=pass;sslmode=require;sslrootcert=/path/to/ca.pem;sslcert=/path/to/cert.pem;sslkey=/path/to/key.pem
    const parseConnectionParts = (connectionString) =>
      connectionString
        .split(';')
        .filter(p => p.trim())
        .map(part => {
          const [key, ...rest] = part.split('=');
          return {
            key: key.trim().toLowerCase(),
            value: rest.join('=').trim(), // safe if value has '='
          };
        });
      const parts = parseConnectionParts(connectionString);
      // build options once
      const options = Object.fromEntries(
        parts.map(({ key, value }) => [key, value])
      );

      if (options.host || options.server) {
        config.host = options.host ?? options.server;
      }

      if (options.port) {
        config.port = parseInt(options.port, 10);
      }

      if (options.database) {
        config.database = options.database;
      }

      if (options.username || options['user id'] || options.user) {
        config.user = options.username ?? options['user id'] ?? options.user;
      }

      if (options.password) {
        config.password = options.password;
      }

      // SSL
      const ssl = buildPostgresSslConfig(options);
      if (ssl !== undefined) {
        config.ssl = ssl;
      }
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
      const msg = `[MultiTenancy] TENANTS_CONNECTION_CONFIG is not set or invalid. Cannot resolve connection for tenant '${tenantId}'.`;
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

/**
 * Get ODS instances configuration for a tenant (multi-tenant mode)
 * Returns the OdsInstances object from tenant configuration if available
 */
function getTenantOdsInstances(tenantId) {
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
    return null;
  }

  const tenantConfig = tenantsConfig[tenantKey];
  return tenantConfig.OdsInstances || null;
}

/**
 * Get default ODS instances configuration from environment (single-tenant mode)
 * Returns the OdsInstances object from ODS_INSTANCES environment variable
 */
function getDefaultOdsInstances() {
  const odsInstancesJson = process.env.ODS_INSTANCES;
  if (!odsInstancesJson) {
    return null;
  }

  try {
    return JSON.parse(odsInstancesJson);
  } catch (error) {
    console.error('[Config] Failed to parse ODS_INSTANCES:', error.message);
    return null;
  }
}

/**
 * Get ODS instances configuration (tenant-aware)
 * For multi-tenant mode: returns OdsInstances for the specified tenant
 * For single-tenant mode: returns OdsInstances from ODS_INSTANCES environment variable
 * Returns null if not found (caller should fall back to database query)
 */
function getOdsInstances(tenantId = null) {
  if (isMultiTenancyEnabled()) {
    // Multi-tenant mode: get from tenant config
    return getTenantOdsInstances(tenantId);
  }

  // Single-tenant mode: get from ODS_INSTANCES environment variable
  return getDefaultOdsInstances();
}

export {
  isMultiTenancyEnabled,
  getTenantsConfig,
  getTenantsConfigSource,
  isTenantsConfigFromPlugin,
  getTenantConnectionConfig,
  getDefaultConnectionConfig,
  getConnectionConfig,
  getAdminConnectionString,
  parseConnectionString,
  initializeTenantsConfig,
  refreshTenantsConfig,
  getTenantOdsInstances,
  getDefaultOdsInstances,
  getOdsInstances
};
