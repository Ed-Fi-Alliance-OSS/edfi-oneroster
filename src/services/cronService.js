
import { PgBoss } from 'pg-boss';
import { buildPostgresSslConfig } from '../config/postgres-ssl.js';
import { knexManager } from '../config/knex-factory.js';
import { parseConnectionString } from '../config/multi-tenancy-config.js';

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
    console.error('[CronService] PG_BOSS_CONNECTION_CONFIG environment variable is not set');
    return null;
  }

  try {
    const connectionConfig = JSON.parse(connectionConfigJson);
    const connectionString = connectionConfig.adminConnection;
    if (!connectionString) {
      console.error('[CronService] adminConnection not found in PG_BOSS_CONNECTION_CONFIG');
      return null;
    }
    return parseConnectionString(connectionString, 'postgres');
  } catch (error) {
    console.error('[CronService] Failed to parse PG_BOSS_CONNECTION_CONFIG:', error.message);
    return null;
  }
}

/**
 * Initialize CRON jobs for materialized view refresh
 */
export async function initializeCronJobs() {
  // Only run CRON jobs for PostgreSQL
  if (process.env.DB_TYPE !== 'postgres') {
    console.log('[CronService] Skipping CRON jobs - only supported for PostgreSQL');
    return;
  }

  try {
    // Get PostgreSQL connection configuration
    const connectionConfig = getPgBossConnectionConfig();
    if (!connectionConfig) {
      console.error('[CronService] Cannot initialize - no PostgreSQL connection configuration');
      return;
    }

    // Set up SSL configuration
    const dbssl = buildPostgresSslConfig('CronService');

    // Create pg-boss instance using PostgreSQL connection details
    const boss = new PgBossInstance({
      host: connectionConfig.host,
      port: connectionConfig.port,
      database: connectionConfig.database,
      user: connectionConfig.user,
      password: connectionConfig.password,
      ssl: dbssl
    });

    const config = {
      cronMonitorIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
      noDefault: true
    };

    await boss.start(config);
    boss.on('error', console.error);

    // Get Knex instance manager for executing refresh queries
    // (actual instances are resolved lazily as ODS databases are accessed)

    // OneRoster endpoints that have materialized views
    const endpoints = ['academicsessions', 'classes', 'courses', 'demographics', 'enrollments', 'orgs', 'users'];

    for (const endpoint of endpoints) {
      const queue = `oneroster-refresh-${endpoint}`;

      await boss.createQueue(queue);

      await boss.work(queue, async (job) => {
        const datetime = new Date();
        console.log(`[${datetime}] refreshing materialized view oneroster12.${endpoint}`);

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
                console.warn(`[CronService] Schema 'oneroster12' not found on ODS instance - skipping refresh for oneroster12.${endpoint}`);
                continue;
              }
              await knexInstance.raw(`REFRESH MATERIALIZED VIEW oneroster12.${endpoint}`);
              console.log(`[${datetime}] successfully refreshed oneroster12.${endpoint}`);
            }
          }
        } catch (error) {
          console.error(`[${datetime}] error refreshing oneroster12.${endpoint}:`, error.message);
          throw error; // Let pg-boss handle retry logic
        }
      });

      // Schedule the job using CRON expression from environment
      if (process.env.PGBOSS_CRON) {
        await boss.schedule(queue, process.env.PGBOSS_CRON);
        console.log(`[CronService] Scheduled ${queue} with cron: ${process.env.PGBOSS_CRON}`);
      }
    }

    console.log('[CronService] CRON jobs initialized successfully for PostgreSQL');

    // When a new ODS instance is registered for the first time, immediately
    // send one-off refresh jobs so the materialized views are up-to-date
    // before the next scheduled cron tick.
    knexManager.on('ods-instance-registered', async ({ instanceKey, odsInstanceId }) => {
      console.log(`[CronService] New ODS instance registered (${instanceKey}) - triggering immediate view refresh`);
      for (const endpoint of endpoints) {
        const queue = `oneroster-refresh-${endpoint}`;
        try {
          await boss.send(queue, { trigger: 'ods-instance-registered', odsInstanceId });
        } catch (err) {
          console.error(`[CronService] Failed to send immediate refresh job for ${queue}:`, err.message);
        }
      }
    });

    // Return boss instance for potential cleanup
    return boss;

  } catch (err) {
    console.error('[CronService] Error starting CRON jobs:', err);
    // Don't throw - let the application continue without CRON jobs
  }
}


