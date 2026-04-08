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
   * @param {string|null} cacheKey - Optional cache key for connection pooling
   */
  async createService(schema = 'oneroster12', tenantId = null, odsInstanceId = null, cacheKey = null) {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType, schema, tenantId, odsInstanceId, cacheKey);
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
   * @param {string|null} cacheKey - Optional cache key for connection pooling
   */
  async createServiceForType(dbType, schema = 'oneroster12', tenantId = null, odsInstanceId = null, cacheKey = null) {
    // Use provided cache key or build default service key
    const serviceKey = cacheKey || `${dbType}_${tenantId || 'default'}_${odsInstanceId || 'default'}_${schema}`;

    if (!this.services.has(serviceKey)) {
      console.log(`[DatabaseServiceFactory] Creating ${dbType.toUpperCase()} service for schema '${schema}'${tenantId ? ` (tenant: ${tenantId})` : ''}${odsInstanceId ? ` (ODS: ${odsInstanceId})` : ''}${cacheKey ? ` [${cacheKey}]` : ''}`);

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

          // Step 3: Create Knex instance with ODS connection using flow-specific cache key
          knexInstance = knexManager.createOdsInstance(dbType, odsConnectionString, odsInstanceId, cacheKey);
        } else {
          // Fallback: Direct connection (for backward compatibility or debugging)
          console.warn(`[DatabaseServiceFactory] No OdsInstanceId provided, using direct connection`);
          if (tenantId && isMultiTenancyEnabled()) {
            knexInstance = knexManager.getTenantInstance(dbType, tenantId);
          } else {
            knexInstance = getKnexForType(dbType);
          }
        }

        // Test the connection and validate schema
        await this.testConnection(knexInstance, dbType, schema);

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
   * @param {string|null} cacheKey - Optional cache key for connection pooling
   */
  async getDefaultService(tenantId = null, odsInstanceId = null, cacheKey = null) {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType, 'oneroster12', tenantId, odsInstanceId, cacheKey);
  }

  /**
   * Test database connection and validate schema existence
   * @param {object} knexInstance - Knex database connection instance
   * @param {string} dbType - Database type ('postgres' or 'mssql')
   * @param {string} schema - Schema name to validate (e.g., 'oneroster12')
   */
  async testConnection(knexInstance, dbType, schema = 'oneroster12') {
    try {
      // Step 1: Test basic connectivity
      await knexInstance.raw('SELECT 1 as test');
      console.log(`[DatabaseServiceFactory] ${dbType} connection test passed`);

      // Step 2: Validate schema exists
      let schemaExists = false;

      if (dbType === 'mssql') {
        // MSSQL: Check sys.schemas
        const result = await knexInstance.raw(`
          SELECT COUNT(*) as count
          FROM sys.schemas
          WHERE name = ?
        `, [schema]);
        schemaExists = result[0]?.count > 0;
      } else {
        // PostgreSQL: Check information_schema.schemata
        const result = await knexInstance.raw(`
          SELECT COUNT(*) as count
          FROM information_schema.schemata
          WHERE schema_name = ?
        `, [schema]);
        schemaExists = result.rows?.[0]?.count > 0;
      }

      if (!schemaExists) {
        const error = `Schema '${schema}' does not exist in the database`;
        console.error(`[DatabaseServiceFactory] ${error}`);
        throw new Error(error);
      }

      console.log(`[DatabaseServiceFactory] Schema '${schema}' validation passed`);

    } catch (error) {
      console.error(`[DatabaseServiceFactory] ${dbType} connection/schema validation failed:`, error.message);
      throw error;
    }
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
}

// Singleton instance
const databaseServiceFactory = new DatabaseServiceFactory();

/**
 * Get the default database service with two-level resolution
 * @param {string|null} tenantId - Tenant identifier (from route in multi-tenant mode)
 * @param {number|null} odsInstanceId - ODS Instance ID (from JWT token)
 * @param {string|null} cacheKey - Optional cache key for connection pooling
 */
async function getDefaultDatabaseService(tenantId = null, odsInstanceId = null, cacheKey = null) {
  return databaseServiceFactory.getDefaultService(tenantId, odsInstanceId, cacheKey);
}

export {
  DatabaseServiceFactory,
  databaseServiceFactory,
  getDefaultDatabaseService
};
