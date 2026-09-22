import OneRosterQueryService from './OneRosterQueryService.js';
import MSSQLQueryService from './MSSQLQueryService.js';
import { knexManager } from '../../config/knex-factory.js';
import { getAdminConnectionString } from '../../config/multi-tenancy-config.js';
import { odsInstanceService } from './OdsInstanceService.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger('DatabaseServiceFactory');

/**
 * Database Service Factory
 * Creates OneRoster query services with appropriate ODS database connections
 */

class DatabaseServiceFactory {
  constructor() {
    this.services = new Map();
  }

  /**
   * Create OneRoster query service for database type
   * Requires OdsInstanceId to resolve correct ODS database
   */
  async createServiceForType(dbType, schema = 'oneroster12', tenantId = null, odsInstanceId = null, cacheKey = null) {
    // Use provided cache key or build default service key
    const serviceKey = cacheKey || `${dbType}_${tenantId || 'default'}_${odsInstanceId || 'default'}_${schema}`;

    if (!this.services.has(serviceKey)) {
      logger.info(`Creating ${dbType.toUpperCase()} service for schema '${schema}'${tenantId ? ` (tenant: ${tenantId})` : ''}${odsInstanceId ? ` (ODS: ${odsInstanceId})` : ''}${cacheKey ? ` [${cacheKey}]` : ''}`);

      try {
        let knexInstance;

        if (odsInstanceId) {
          // Two-level database resolution
          // Step 1: Get EdFi_Admin connection string (tenant-specific or default)
          const adminConnectionString = getAdminConnectionString(tenantId, dbType);
          logger.debug(`Resolving ODS connection via EdFi_Admin for OdsInstanceId: ${odsInstanceId}`);

          // Step 2: Resolve ODS connection string from EdFi_Admin database (or external config)
          const odsConnectionString = await odsInstanceService.resolveOdsConnectionString({
            adminConnectionString,
            dbType,
            odsInstanceId,
            tenantId
          });

          // Step 3: Create Knex instance with ODS connection using flow-specific cache key
          knexInstance = knexManager.createOdsInstance(dbType, odsConnectionString, odsInstanceId, cacheKey);
        } else {
          throw new Error('OdsInstanceId is required to resolve an ODS database connection.');
        }

        // Test the connection and validate schema
        await this.testConnection(knexInstance, dbType, schema);

        // Create the service (use MSSQL-specific service for mssql database type)
        let service;
        if (dbType === 'mssql') {
          logger.debug(`Creating MSSQLQueryService for schema '${schema}'`);
          service = new MSSQLQueryService(knexInstance, schema);
        } else {
          logger.debug(`Creating OneRosterQueryService for schema '${schema}'`);
          service = new OneRosterQueryService(knexInstance, schema);
        }

        // Store for reuse
        this.services.set(serviceKey, service);

        logger.info(`${dbType.toUpperCase()} service created successfully`);
      } catch (error) {
        logger.error({ dbType, err: error }, 'Failed to create service');
        throw new Error(`Failed to create database service for ${dbType}: ${error.message}`);
      }
    }

    return this.services.get(serviceKey);
  }

  /**
   * Test database connection and validate schema existence
   */
  async testConnection(knexInstance, dbType, schema = 'oneroster12') {
    try {
      // Step 1: Test basic connectivity
      await knexInstance.raw('SELECT 1 as test');
      logger.debug(`${dbType} connection test passed`);

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
        logger.error(error);
        throw new Error(error);
      }

      logger.debug(`Schema '${schema}' validation passed`);

    } catch (error) {
      logger.error({ dbType, err: error }, 'Connection/schema validation failed');
      throw error;
    }
  }

  /**
   * Close all services and connections
   */
  async closeAll() {
    logger.info('Closing all services...');

    // Close all query services
    const closePromises = Array.from(this.services.values()).map(service =>
      service.close()
    );

    await Promise.all(closePromises);
    this.services.clear();

    // Close Knex manager connections
    await knexManager.closeAll();

    logger.info('All services closed');
  }
}

// Singleton instance
const databaseServiceFactory = new DatabaseServiceFactory();

/**
 * Get the default database service with two-level resolution
 */
async function getDefaultDatabaseService(tenantId = null, odsInstanceId = null, cacheKey = null) {
  const dbType = process.env.DB_TYPE || 'postgres';
  return databaseServiceFactory.createServiceForType(dbType, 'oneroster12', tenantId, odsInstanceId, cacheKey);
}

export {
  DatabaseServiceFactory,
  databaseServiceFactory,
  getDefaultDatabaseService
};
