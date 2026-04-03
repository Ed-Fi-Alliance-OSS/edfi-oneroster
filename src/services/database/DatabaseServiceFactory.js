import OneRosterQueryService from './OneRosterQueryService.js';
import MSSQLQueryService from './MSSQLQueryService.js';
import { getKnexForType, knexManager } from '../../config/knex-factory.js';
import { isMultiTenancyEnabled, getAdminConnectionString } from '../../config/multi-tenancy-config.js';
import { odsInstanceService } from './OdsInstanceService.js';

/**
 * Database Service Factory
 * Creates OneRoster query services with appropriate ODS database connections
 *
 * Connection Resolution Flow:
 * 1. Determine EdFi_Admin database (tenant-specific or default)
 * 2. Query EdFi_Admin.OdsInstances table using OdsInstanceId from JWT
 * 3. Decrypt the ODS connection string
 * 4. Connect to the resolved ODS database
 * 5. Execute OneRoster queries against ODS database
 */

class DatabaseServiceFactory {
  constructor() {
    this.services = new Map();
  }

  /**
   * Create OneRoster query service for default database type
   * Requires OdsInstanceId to resolve correct ODS database
   *
   * @param {string} schema - Database schema name (default: 'oneroster12')
   * @param {string|null} tenantId - Tenant identifier (from route in multi-tenant mode)
   * @param {number|null} odsInstanceId - ODS Instance ID (from JWT token)
   */
  async createService(schema = 'oneroster12', tenantId = null, odsInstanceId = null) {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType, schema, tenantId, odsInstanceId);
  }

  /**
   * Create OneRoster query service for specific database type
   * Implements two-level database resolution:
   * - First: Resolve EdFi_Admin connection (tenant-specific or default)
   * - Second: Resolve ODS connection from EdFi_Admin.OdsInstances table
   *
   * @param {string} dbType - Database type ('postgres' or 'mssql')
   * @param {string} schema - Database schema name (default: 'oneroster12')
   * @param {string|null} tenantId - Tenant identifier (from route in multi-tenant mode)
   * @param {number|null} odsInstanceId - ODS Instance ID (from JWT token)
   */
  async createServiceForType(dbType, schema = 'oneroster12', tenantId = null, odsInstanceId = null) {
    // Cache key includes odsInstanceId to support multiple ODS databases
    const serviceKey = `${dbType}_${tenantId || 'default'}_${odsInstanceId || 'default'}_${schema}`;

    if (!this.services.has(serviceKey)) {
      console.log(`[DatabaseServiceFactory] Creating ${dbType.toUpperCase()} service for schema '${schema}'${tenantId ? ` (tenant: ${tenantId})` : ''}${odsInstanceId ? ` (ODS: ${odsInstanceId})` : ''}`);

      try {
        let knexInstance;

        if (odsInstanceId) {
          // Two-level database resolution
          // Step 1: Get EdFi_Admin connection string (tenant-specific or default)
          const adminConnectionString = getAdminConnectionString(tenantId, dbType);
          console.log(`[DatabaseServiceFactory] Resolving ODS connection via EdFi_Admin for OdsInstanceId: ${odsInstanceId}`);

          // Step 2: Resolve ODS connection string from EdFi_Admin database
          const odsConnectionString = await odsInstanceService.resolveOdsConnectionString({
            adminConnectionString,
            dbType,
            odsInstanceId
          });

          // Step 3: Create Knex instance with ODS connection
          knexInstance = knexManager.createOdsInstance(dbType, odsConnectionString, odsInstanceId);
        } else {
          // Fallback: Direct connection (for backward compatibility or debugging)
          console.warn(`[DatabaseServiceFactory] No OdsInstanceId provided, using direct connection`);
          if (tenantId && isMultiTenancyEnabled()) {
            knexInstance = knexManager.getTenantInstance(dbType, tenantId);
          } else {
            knexInstance = getKnexForType(dbType);
          }
        }

        // Test the connection
        await this.testConnection(knexInstance, serviceKey);

        // Create the service (use MSSQL-specific service for mssql database type)
        let service;
        if (dbType === 'mssql') {
          console.log(`[DatabaseServiceFactory] Creating MSSQLQueryService for schema '${schema}'`);
          service = new MSSQLQueryService(knexInstance, schema);
        } else {
          console.log(`[DatabaseServiceFactory] Creating OneRosterQueryService for schema '${schema}'`);
          service = new OneRosterQueryService(knexInstance, schema);
        }

        // Store for reuse
        this.services.set(serviceKey, service);

        console.log(`[DatabaseServiceFactory] ${dbType.toUpperCase()} service created successfully`);
      } catch (error) {
        console.error(`[DatabaseServiceFactory] Failed to create ${dbType} service:`, error.message);
        throw new Error(`Failed to create database service for ${dbType}: ${error.message}`);
      }
    }

    return this.services.get(serviceKey);
  }

  /**
   * Get or create the default service based on DB_TYPE environment variable
   * Uses two-level database resolution with OdsInstanceId
   *
   * @param {string|null} tenantId - Tenant identifier (from route in multi-tenant mode)
   * @param {number|null} odsInstanceId - ODS Instance ID (from JWT token)
   */
  async getDefaultService(tenantId = null, odsInstanceId = null) {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType, 'oneroster12', tenantId, odsInstanceId);
  }

  /**
   * Test database connection
   */
  async testConnection(knexInstance, dbType) {
    try {
      await knexInstance.raw('SELECT 1 as test');
      console.log(`[DatabaseServiceFactory] ${dbType} connection test passed`);
    } catch (error) {
      console.error(`[DatabaseServiceFactory] ${dbType} connection test failed:`, error.message);
      throw error;
    }
  }

  /**
   * Test both PostgreSQL and MSSQL connections
   */
  async testAllConnections() {
    const results = {
      postgres: { success: false, error: null },
      mssql: { success: false, error: null }
    };

    // Test PostgreSQL
    try {
      await this.createServiceForType('postgres');
      results.postgres.success = true;
      console.log('✅ PostgreSQL connection successful');
    } catch (error) {
      results.postgres.error = error.message;
      console.log('❌ PostgreSQL connection failed:', error.message);
    }

    // Test MSSQL
    try {
      await this.createServiceForType('mssql');
      results.mssql.success = true;
      console.log('✅ MSSQL connection successful');
    } catch (error) {
      results.mssql.error = error.message;
      console.log('❌ MSSQL connection failed:', error.message);
    }

    return results;
  }

  /**
   * Close all services and connections
   */
  async closeAll() {
    console.log('[DatabaseServiceFactory] Closing all services...');

    // Close all query services
    const closePromises = Array.from(this.services.values()).map(service =>
      service.close()
    );

    await Promise.all(closePromises);
    this.services.clear();

    // Close Knex manager connections
    await knexManager.closeAll();

    console.log('[DatabaseServiceFactory] All services closed');
  }

  /**
   * Get service statistics
   */
  getStats() {
    const stats = {
      totalServices: this.services.size,
      services: Array.from(this.services.keys())
    };

    console.log('[DatabaseServiceFactory] Stats:', stats);
    return stats;
  }
}

/**
 * Tenant-Aware Query Service (extends OneRosterQueryService)
 * Adds tenant isolation capabilities for future multi-tenant support
 */
class TenantAwareQueryService extends OneRosterQueryService {
  constructor(knexInstance, schema, tenantId) {
    super(knexInstance, schema);
    this.tenantId = tenantId;
  }

  /**
   * Override base query to add tenant filtering if using shared schema
   */
  baseQuery(endpoint) {
    let query = super.baseQuery(endpoint);

    // Add tenant isolation for shared schema approach
    if (this.isSharedSchema()) {
      query = query.where('tenantId', this.tenantId);
    }

    return query;
  }

  /**
   * Check if using shared schema tenant isolation strategy
   */
  isSharedSchema() {
    // For now, assume separate schemas per tenant
    // In the future, this could check tenant configuration
    return false;
  }

  /**
   * Get tenant-specific table name (for tenant-prefixed tables)
   */
  getTenantTableName(endpoint) {
    if (this.tenantId && this.usesTablePrefix()) {
      return `${this.tenantId}_${endpoint}`;
    }
    return endpoint;
  }

  /**
   * Check if using table prefix tenant isolation strategy
   */
  usesTablePrefix() {
    return false; // Future enhancement
  }
}

// Singleton instance
const databaseServiceFactory = new DatabaseServiceFactory();

/**
 * Get the default database service with two-level resolution
 * @param {string|null} tenantId - Tenant identifier (from route in multi-tenant mode)
 * @param {number|null} odsInstanceId - ODS Instance ID (from JWT token)
 */
async function getDefaultDatabaseService(tenantId = null, odsInstanceId = null) {
  return databaseServiceFactory.getDefaultService(tenantId, odsInstanceId);
}

/**
 * Get database service for specific type with two-level resolution
 * @param {string} dbType - Database type ('postgres' or 'mssql')
 * @param {string|null} tenantId - Tenant identifier (from route in multi-tenant mode)
 * @param {number|null} odsInstanceId - ODS Instance ID (from JWT token)
 */
async function getDatabaseServiceForType(dbType, tenantId = null, odsInstanceId = null) {
  return databaseServiceFactory.createServiceForType(dbType, 'oneroster12', tenantId, odsInstanceId);
}

export {
  DatabaseServiceFactory,
  TenantAwareQueryService,
  databaseServiceFactory,
  getDefaultDatabaseService,
  getDatabaseServiceForType
};
