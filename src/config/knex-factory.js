import knex from 'knex';
import { EventEmitter } from 'events';
import { buildMssqlTlsOptions } from './mssql-tls.js';
import { getConnectionConfig, parseConnectionString } from './multi-tenancy-config.js';
import { buildRequestTimeoutOptions } from './db-timeouts.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('KnexFactory');

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
    }
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
          ...buildMssqlTlsOptions(connectionConfig),
          enableArithAbort: true,
          useUTC: false
        },
        connectionTimeout: 30000,
        ...buildRequestTimeoutOptions('mssql')
      }
    };
  } else {
    // Default to PostgreSQL
    return {
      ...baseConfig,
      client: 'pg',
      connection: {
        host: connectionConfig.host,
        port: connectionConfig.port,
        user: connectionConfig.user,
        password: connectionConfig.password,
        database: connectionConfig.database,
        ...(connectionConfig.ssl && { ssl: connectionConfig.ssl }),
        ...buildRequestTimeoutOptions('postgres')
      }
    };
  }
}

/**
 * Knex Instance Manager
 * Singleton pattern for connection management
 */
class KnexManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map();
    this.odsInstanceMeta = new Map(); // instanceKey -> { dbType }
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
        logger.debug({ dbType, sql: query.sql, bindings: query.bindings }, 'Query');
      });

      knexInstance.on('query-error', (error, query) => {
        logger.error({ dbType, sql: query.sql, err: error }, 'Query error');
      });

      this.instances.set(dbType, knexInstance);
      logger.info(`Created ${dbType.toUpperCase()} instance`);
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
      logger.info(`${dbType.toUpperCase()} connection test successful`);
      return true;
    } catch (error) {
      logger.error({ dbType, err: error }, 'Connection test failed');
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
      logger.debug({ dbType, tenantId, sql: query.sql, bindings: query.bindings }, 'Query');
    });

    tenantInstance.on('query-error', (error, query) => {
      logger.error({ dbType, tenantId, sql: query.sql, err: error }, 'Query error');
    });

    // Store with tenant-specific key
    this.instances.set(tenantKey, tenantInstance);

    logger.info(`Created tenant instance for ${tenantId}`);
    return tenantInstance;
  }

  /**
   * Create Knex instance connected to the ODS database using dynamically resolved connection string
   * This is used after resolving the ODS connection from EdFi_Admin.OdsInstances table
   */
  createOdsInstance(dbType, connectionString, odsInstanceId, cacheKey = null) {

    const instanceKey = cacheKey || `odsinstance-${odsInstanceId}`;

    // Return cached instance if exists
    if (this.instances.has(instanceKey)) {
      logger.debug(`Using cached ODS instance: ${instanceKey}`);
      return this.instances.get(instanceKey);
    }

    logger.info(`Creating ODS instance: ${instanceKey}`);

    // Parse the connection string to get connection config
    const connectionConfig = parseConnectionString(connectionString, dbType);

    // Build Knex configuration
    const baseConfig = {
      pool: {
        min: 0,
        max: parseInt(process.env.DB_POOL_MAX) || 10,
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30000
      },
      acquireConnectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS) || 60000
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
            ...buildMssqlTlsOptions(connectionConfig),
            enableArithAbort: true,
            useUTC: false
          },
          connectionTimeout: 30000,
          ...buildRequestTimeoutOptions('mssql')
        }
      };
    } else {
      // PostgreSQL
      knexConfig = {
        ...baseConfig,
        client: 'pg',
        connection: {
          host: connectionConfig.host,
          port: connectionConfig.port,
          database: connectionConfig.database,
          user: connectionConfig.user,
          password: connectionConfig.password,
          ...(connectionConfig.ssl && { ssl: connectionConfig.ssl }),
          ...buildRequestTimeoutOptions('postgres')
        }
      };
    }

    const odsInstance = knex(knexConfig);

    // Add connection event logging
    odsInstance.on('query', (query) => {
      logger.debug({ odsInstanceId, sql: query.sql }, 'Query');
    });

    odsInstance.on('query-error', (error, query) => {
      logger.error({ odsInstanceId, sql: query.sql, err: error }, 'Query error');
    });

    // Cache the instance
    this.instances.set(instanceKey, odsInstance);
    this.odsInstanceMeta.set(instanceKey, { dbType });

    logger.info(`Created ODS instance for OdsInstanceId ${odsInstanceId}, database: ${connectionConfig.database}`);

    // Notify listeners that a new ODS instance is available (only for postgres - mssql uses no materialized views)
    if (dbType === 'postgres') {
      this.emit('ods-instance-registered', { instanceKey, odsInstanceId, knexInstance: odsInstance });
    }

    return odsInstance;
  }

  /**
   * Return all cached ODS Knex instances for a given database type.
   * Only instances created via createOdsInstance are returned.
   */
  getOdsInstances(dbType) {
    const result = [];
    for (const [key, meta] of this.odsInstanceMeta.entries()) {
      if (meta.dbType === dbType && this.instances.has(key)) {
        result.push(this.instances.get(key));
      }
    }
    return result;
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
    this.odsInstanceMeta.clear();
    logger.info('All connections closed');
  }

  /**
   * Close specific connection
   */
  async close(dbType) {
    const instance = this.instances.get(dbType);
    if (instance) {
      await instance.destroy();
      this.instances.delete(dbType);
      logger.info(`${dbType.toUpperCase()} connection closed`);
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
