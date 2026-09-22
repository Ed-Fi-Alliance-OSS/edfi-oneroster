
import { PgBoss } from 'pg-boss';
import { knexManager } from '../config/knex-factory.js';
import { parseConnectionString } from '../config/multi-tenancy-config.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('CronService');

class PgBossInstance extends PgBoss {
  async onApplicationShutdown() {
    await this.stop({ graceful: false, destroy: true });
  }
}

/**
 * Get PostgreSQL connection configuration for pg-boss.
 * Uses explicit PG_BOSS_CONNECTION_CONFIG so cron backing store does not depend on
 * tenant ordering or single-tenant admin database configuration.
 */
function getPgBossConnectionConfig() {
  const connectionConfigJson = process.env.PG_BOSS_CONNECTION_CONFIG;
  if (!connectionConfigJson) {
    logger.error('PG_BOSS_CONNECTION_CONFIG environment variable is not set');
    return null;
  }

  try {
    const connectionConfig = JSON.parse(connectionConfigJson);
    const connectionString = connectionConfig.adminConnection;
    if (!connectionString) {
      logger.error('adminConnection not found in PG_BOSS_CONNECTION_CONFIG');
      return null;
    }
    return parseConnectionString(connectionString, 'postgres');
  } catch (error) {
    logger.error(`Failed to parse PG_BOSS_CONNECTION_CONFIG: ${error.message}`);
    return null;
  }
}

/**
 * Initialize CRON jobs for materialized view refresh
 */
export async function initializeCronJobs() {
  // Only run CRON jobs for PostgreSQL
  if (process.env.DB_TYPE !== 'postgres') {
    logger.info('Skipping CRON jobs - only supported for PostgreSQL');
    return;
  }

  try {
    // Get PostgreSQL connection configuration
    const connectionConfig = getPgBossConnectionConfig();
    if (!connectionConfig) {
      logger.error('Cannot initialize - no PostgreSQL connection configuration');
      return;
    }

    // SSL comes from adminConnection (e.g. sslmode=require) via parseConnectionString — same as Knex paths
    const boss = new PgBossInstance({
      host: connectionConfig.host,
      port: connectionConfig.port,
      database: connectionConfig.database,
      user: connectionConfig.user,
      password: connectionConfig.password,
      ssl: connectionConfig.ssl
    });

    const config = {
      cronMonitorIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
      noDefault: true
    };

    await boss.start(config);
    boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

    // Get Knex instance manager for executing refresh queries
    // (actual instances are resolved lazily as ODS databases are accessed)

    // OneRoster endpoints that have materialized views
    const endpoints = ['academicsessions', 'classes', 'courses', 'demographics', 'enrollments', 'orgs', 'users'];

    for (const endpoint of endpoints) {
      const queue = `oneroster-refresh-${endpoint}`;

      await boss.createQueue(queue);

      await boss.work(queue, async (job) => {
        logger.debug(`Refreshing materialized view oneroster12.${endpoint}`);

        try {
          // Refresh against every cached ODS postgres instance.
          // If no instances have been resolved yet (no request has come in since startup),
          // skip the refresh — the 'ods-instance-registered' event will trigger an
          // immediate refresh as soon as the first ODS connection is established.
          const odsInstances = knexManager.getOdsInstances('postgres');
          if(odsInstances.length > 0) {
            for (const knexInstance of odsInstances) {
              // Verify the oneroster12 schema exists before attempting the refresh
              const schemaCheck = await knexInstance.raw(`
                SELECT COUNT(*) as count
                FROM information_schema.schemata
                WHERE schema_name = 'oneroster12'
              `);
              const schemaExists = schemaCheck.rows?.[0]?.count > 0;
              if (!schemaExists) {
                logger.warn(`Schema 'oneroster12' not found on ODS instance - skipping refresh for oneroster12.${endpoint}`);
                continue;
              }
              await knexInstance.raw(`REFRESH MATERIALIZED VIEW oneroster12.${endpoint}`);
              logger.debug(`Successfully refreshed oneroster12.${endpoint}`);
            }
          }
        } catch (error) {
          logger.error({ endpoint, err: error }, 'Error refreshing materialized view');
          throw error; // Let pg-boss handle retry logic
        }
      });

      // Schedule the job using CRON expression from environment
      if (process.env.PGBOSS_CRON) {
        await boss.schedule(queue, process.env.PGBOSS_CRON);
        logger.info(`Scheduled ${queue} with cron: ${process.env.PGBOSS_CRON}`);
      }
    }

    logger.info('CRON jobs initialized successfully for PostgreSQL');

    // When a new ODS instance is registered for the first time, immediately
    // send one-off refresh jobs so the materialized views are up-to-date
    // before the next scheduled cron tick.
    knexManager.on('ods-instance-registered', async ({ instanceKey, odsInstanceId }) => {
      logger.info(`New ODS instance registered (${instanceKey}) - triggering immediate view refresh`);
      for (const endpoint of endpoints) {
        const queue = `oneroster-refresh-${endpoint}`;
        try {
          await boss.send(queue, { trigger: 'ods-instance-registered', odsInstanceId });
        } catch (err) {
          logger.error({ queue, err }, 'Failed to send immediate refresh job');
        }
      }
    });

    // Return boss instance for potential cleanup
    return boss;

  } catch (err) {
    logger.error({ err }, 'Error starting CRON jobs');
    // Don't throw - let the application continue without CRON jobs
  }
}


