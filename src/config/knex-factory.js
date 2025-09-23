const knex = require('knex');

/**
 * Knex.js Configuration Factory
 * Creates database-specific configurations for PostgreSQL and MSSQL
 */

function createKnexConfig(dbType = process.env.DB_TYPE || 'postgres') {
  const baseConfig = {
    pool: { 
      min: 0, 
      max: 10,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200
    },
    acquireConnectionTimeout: 30000,
    migrations: { 
      directory: './migrations',
      tableName: 'knex_migrations'
    },
    debug: process.env.NODE_ENV === 'dev'
  };

  if (dbType === 'mssql') {
    return {
      ...baseConfig,
      client: 'mssql',
      connection: {
        server: process.env.MSSQL_SERVER || 'localhost',
        database: process.env.MSSQL_DATABASE,
        user: process.env.MSSQL_USER,
        password: process.env.MSSQL_PASSWORD,
        options: {
          encrypt: process.env.MSSQL_ENCRYPT === 'true',
          trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === 'true',
          enableArithAbort: true,
          useUTC: false
        },
        connectionTimeout: 30000,
        requestTimeout: 30000
      }
    };
  } else {
    // Default to PostgreSQL
    return {
      ...baseConfig,
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      }
    };
  }
}

/**
 * Knex Instance Manager
 * Singleton pattern for connection management
 */
class KnexManager {
  constructor() {
    this.instances = new Map();
  }

  /**
   * Get or create a Knex instance for the specified database type
   */
  getInstance(dbType = process.env.DB_TYPE || 'postgres') {
    if (!this.instances.has(dbType)) {
      const config = createKnexConfig(dbType);
      const knexInstance = knex(config);
      
      // Add connection event logging
      knexInstance.on('query', (query) => {
        if (process.env.NODE_ENV === 'dev') {
          console.log(`[${dbType.toUpperCase()}] Query:`, query.sql);
          if (query.bindings && query.bindings.length > 0) {
            console.log(`[${dbType.toUpperCase()}] Bindings:`, query.bindings);
          }
        }
      });

      knexInstance.on('query-error', (error, query) => {
        console.error(`[${dbType.toUpperCase()}] Query Error:`, error.message);
        console.error(`[${dbType.toUpperCase()}] Failed Query:`, query.sql);
      });

      this.instances.set(dbType, knexInstance);
      console.log(`[KnexFactory] Created ${dbType.toUpperCase()} instance`);
    }

    return this.instances.get(dbType);
  }

  /**
   * Test connection for a database type
   */
  async testConnection(dbType = process.env.DB_TYPE || 'postgres') {
    try {
      const knexInstance = this.getInstance(dbType);
      await knexInstance.raw('SELECT 1 as test');
      console.log(`[KnexFactory] ${dbType.toUpperCase()} connection test successful`);
      return true;
    } catch (error) {
      console.error(`[KnexFactory] ${dbType.toUpperCase()} connection test failed:`, error.message);
      throw error;
    }
  }

  /**
   * Create a tenant-specific instance (for future multi-tenant support)
   */
  createTenantInstance(dbType, tenantConfig) {
    const baseConfig = createKnexConfig(dbType);
    
    // Override connection details for tenant-specific database/schema
    const tenantKnexConfig = {
      ...baseConfig,
      connection: {
        ...baseConfig.connection,
        ...tenantConfig.connection
      }
    };

    const tenantInstance = knex(tenantKnexConfig);
    
    // Store with tenant-specific key
    const tenantKey = `${dbType}_${tenantConfig.tenantId}`;
    this.instances.set(tenantKey, tenantInstance);
    
    console.log(`[KnexFactory] Created tenant instance for ${tenantConfig.tenantId}`);
    return tenantInstance;
  }

  /**
   * Close all connections
   */
  async closeAll() {
    const closePromises = Array.from(this.instances.values()).map(instance => 
      instance.destroy()
    );
    
    await Promise.all(closePromises);
    this.instances.clear();
    console.log('[KnexFactory] All connections closed');
  }

  /**
   * Close specific connection
   */
  async close(dbType) {
    const instance = this.instances.get(dbType);
    if (instance) {
      await instance.destroy();
      this.instances.delete(dbType);
      console.log(`[KnexFactory] ${dbType.toUpperCase()} connection closed`);
    }
  }
}

// Singleton instance
const knexManager = new KnexManager();

/**
 * Get the default Knex instance based on DB_TYPE environment variable
 */
function getKnex() {
  return knexManager.getInstance();
}

/**
 * Get Knex instance for specific database type
 */
function getKnexForType(dbType) {
  return knexManager.getInstance(dbType);
}

module.exports = {
  getKnex,
  getKnexForType,
  createKnexConfig,
  knexManager
};