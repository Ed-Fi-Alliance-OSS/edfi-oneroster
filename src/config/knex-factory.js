import knex from 'knex';
import { buildPostgresSslConfig } from './postgres-ssl.js';
import { getConnectionConfig, parseConnectionString } from './multi-tenancy-config.js';

/**
 * Knex.js Configuration Factory
 * Creates database-specific configurations for PostgreSQL and MSSQL
 * Supports tenant-specific connections when multi-tenancy is enabled
 */

function createKnexConfig(dbType = process.env.DB_TYPE || 'postgres', tenantId = null) {
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

  // Get connection configuration (tenant-aware or default)
  const connectionConfig = getConnectionConfig(tenantId, dbType);

  if (dbType === 'mssql') {
    return {
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
    // Default to PostgreSQL
    const sslConfig = buildPostgresSslConfig('KnexFactory');

    return {
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
   * Create or get a tenant-specific instance
   * Uses multi-tenancy configuration to determine connection settings
   */
  getTenantInstance(dbType, tenantId) {
    // Generate tenant-specific key
    const tenantKey = `${dbType}_${tenantId}`;

    // Return existing instance if available
    if (this.instances.has(tenantKey)) {
      return this.instances.get(tenantKey);
    }

    // Create new tenant-specific instance using multi-tenancy config
    const tenantConfig = createKnexConfig(dbType, tenantId);
    const tenantInstance = knex(tenantConfig);

    // Add connection event logging
    tenantInstance.on('query', (query) => {
      if (process.env.NODE_ENV === 'dev') {
        console.log(`[${dbType.toUpperCase()}-${tenantId}] Query:`, query.sql);
        if (query.bindings && query.bindings.length > 0) {
          console.log(`[${dbType.toUpperCase()}-${tenantId}] Bindings:`, query.bindings);
        }
      }
    });

    tenantInstance.on('query-error', (error, query) => {
      console.error(`[${dbType.toUpperCase()}-${tenantId}] Query Error:`, error.message);
      console.error(`[${dbType.toUpperCase()}-${tenantId}] Failed Query:`, query.sql);
    });

    // Store with tenant-specific key
    this.instances.set(tenantKey, tenantInstance);

    console.log(`[KnexFactory] Created tenant instance for ${tenantId}`);
    return tenantInstance;
  }

  /**
   * Create ODS instance using dynamically resolved connection string
   * This is used after resolving the ODS connection from EdFi_Admin.OdsInstances table
   * @param {string} dbType - Database type ('mssql' or 'postgres')
   * @param {string} connectionString - Decrypted ODS connection string
   * @param {number} odsInstanceId - ODS Instance ID for caching
   * @param {string} cacheKey - Optional cache key following flow-specific format
   * @returns {Object} Knex instance connected to the ODS database
   */
  createOdsInstance(dbType, connectionString, odsInstanceId, cacheKey = null) {
    // Use provided flow-specific cache key or fallback to OdsInstanceId-only format
    const instanceKey = cacheKey || `odsinstance-${odsInstanceId}`;

    // Return cached instance if exists
    if (this.instances.has(instanceKey)) {
      console.log(`[KnexFactory] Using cached ODS instance: ${instanceKey}`);
      return this.instances.get(instanceKey);
    }

    console.log(`[KnexFactory] Creating ODS instance: ${instanceKey}`);

    // Parse the connection string to get connection config
    const connectionConfig = parseConnectionString(connectionString, dbType);

    // Build Knex configuration
    const baseConfig = {
      pool: {
        min: 2,
        max: parseInt(process.env.DB_POOL_MAX) || 10,
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30000
      },
      acquireConnectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS) || 60000,
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
      const sslConfig = buildPostgresSslConfig('OdsInstance');
      knexConfig = {
        ...baseConfig,
        client: 'pg',
        connection: {
          host: connectionConfig.host,
          port: connectionConfig.port,
          database: connectionConfig.database,
          user: connectionConfig.username,
          password: connectionConfig.password,
          ssl: connectionConfig.ssl || sslConfig
        }
      };
    }

    const odsInstance = knex(knexConfig);

    // Add connection event logging
    odsInstance.on('query', (query) => {
      if (process.env.NODE_ENV === 'dev') {
        console.log(`[ODS-${odsInstanceId}] Query:`, query.sql);
      }
    });

    odsInstance.on('query-error', (error, query) => {
      console.error(`[ODS-${odsInstanceId}] Query Error:`, error.message);
      console.error(`[ODS-${odsInstanceId}] Failed Query:`, query.sql);
    });

    // Cache the instance
    this.instances.set(instanceKey, odsInstance);

    console.log(`[KnexFactory] Created ODS instance for OdsInstanceId ${odsInstanceId}, database: ${connectionConfig.database}`);
    return odsInstance;
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

export { getKnex, getKnexForType, createKnexConfig, knexManager };
