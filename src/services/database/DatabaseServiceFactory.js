const OneRosterQueryService = require('./OneRosterQueryService');
const MSSQLQueryService = require('./MSSQLQueryService');
const { getKnexForType } = require('../../config/knex-factory');

/**
 * Database Service Factory
 * Creates OneRoster query services with appropriate database connections
 */

class DatabaseServiceFactory {
  constructor() {
    this.services = new Map();
  }

  /**
   * Create OneRoster query service for default database type
   */
  async createService(schema = 'oneroster12') {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType, schema);
  }

  /**
   * Create OneRoster query service for specific database type
   */
  async createServiceForType(dbType, schema = 'oneroster12') {
    const serviceKey = `${dbType}_${schema}`;
    
    // Clear cache for debugging (remove in production)
    if (this.services.has(serviceKey)) {
      console.log(`[DatabaseServiceFactory] Clearing cached service for ${serviceKey}`);
      this.services.delete(serviceKey);
    }
    
    if (!this.services.has(serviceKey)) {
      console.log(`[DatabaseServiceFactory] Creating ${dbType.toUpperCase()} service for schema '${schema}'`);
      
      try {
        // Get Knex instance for the database type
        const knexInstance = getKnexForType(dbType);
        
        // Test the connection
        await this.testConnection(knexInstance, dbType);
        
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
   * Create tenant-specific service (for future multi-tenant support)
   */
  async createTenantService(tenantConfig) {
    const { tenantId, dbType, schema, connectionOverrides } = tenantConfig;
    const serviceKey = `${dbType}_${tenantId}_${schema}`;

    if (!this.services.has(serviceKey)) {
      console.log(`[DatabaseServiceFactory] Creating tenant service for ${tenantId}`);
      
      try {
        let knexInstance;
        
        if (connectionOverrides) {
          // Create tenant-specific connection
          const { knexManager } = require('../../config/knex-factory');
          knexInstance = knexManager.createTenantInstance(dbType, {
            tenantId,
            connection: connectionOverrides
          });
        } else {
          // Use default connection for the database type
          knexInstance = getKnexForType(dbType);
        }

        // Test the connection
        await this.testConnection(knexInstance, `${dbType}_${tenantId}`);
        
        // Create tenant-aware service
        const service = new TenantAwareQueryService(knexInstance, schema, tenantId);
        
        // Store for reuse
        this.services.set(serviceKey, service);
        
        console.log(`[DatabaseServiceFactory] Tenant service for ${tenantId} created successfully`);
      } catch (error) {
        console.error(`[DatabaseServiceFactory] Failed to create tenant service for ${tenantId}:`, error.message);
        throw new Error(`Failed to create tenant service: ${error.message}`);
      }
    }

    return this.services.get(serviceKey);
  }

  /**
   * Get or create the default service based on DB_TYPE environment variable
   */
  async getDefaultService() {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType);
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
    const { knexManager } = require('../../config/knex-factory');
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
 * Get the default database service
 */
async function getDefaultDatabaseService() {
  return databaseServiceFactory.getDefaultService();
}

/**
 * Get database service for specific type
 */
async function getDatabaseServiceForType(dbType) {
  return databaseServiceFactory.createServiceForType(dbType);
}

module.exports = {
  DatabaseServiceFactory,
  TenantAwareQueryService,
  databaseServiceFactory,
  getDefaultDatabaseService,
  getDatabaseServiceForType
};