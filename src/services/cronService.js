const PgBoss = require('pg-boss');
const { getKnexForType } = require('../config/knex-factory');
require('dotenv').config();

class PgBossInstance extends PgBoss {
  async onApplicationShutdown() {
    await this.stop({ graceful: false, destroy: true });
  }
}

/**
 * Initialize CRON jobs for materialized view refresh
 * Only works with PostgreSQL - MSSQL doesn't use materialized views
 */
async function initializeCronJobs() {
  // Only run CRON jobs for PostgreSQL
  if (process.env.DB_TYPE !== 'postgres') {
    console.log('[CronService] Skipping CRON jobs - only supported for PostgreSQL');
    return;
  }

  try {
    // Set up SSL configuration
    let dbssl = { rejectUnauthorized: true };
    if (process.env.NODE_ENV != 'prod' && process.env.NODE_ENV != '') {
      dbssl = false;
    }

    // Create pg-boss instance using PostgreSQL connection details
    const boss = new PgBossInstance({
      "host": process.env.POSTGRES_HOST || process.env.DB_HOST,
      "port": process.env.POSTGRES_PORT || process.env.DB_PORT || 5432,
      "database": process.env.POSTGRES_DB || process.env.DB_NAME,
      "user": process.env.POSTGRES_USER || process.env.DB_USER,
      "password": process.env.POSTGRES_PASSWORD || process.env.DB_PASS,
      "ssl": dbssl
    });

    const config = {
      cronMonitorIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
      noDefault: true
    };

    await boss.start(config);
    boss.on('error', console.error);

    // Get Knex instance for executing refresh queries
    const knex = getKnexForType('postgres');

    // OneRoster endpoints that have materialized views
    const endpoints = ['academicsessions', 'classes', 'courses', 'demographics', 'enrollments', 'orgs', 'users'];

    for (const endpoint of endpoints) {
      const queue = `oneroster-refresh-${endpoint}`;
      
      await boss.createQueue(queue);
      
      await boss.work(queue, async (job) => {
        const datetime = new Date();
        console.log(`[${datetime}] refreshing materialized view oneroster12.${endpoint}`);
        
        try {
          // Use Knex to execute the refresh command
          await knex.raw(`REFRESH MATERIALIZED VIEW oneroster12.${endpoint}`);
          console.log(`[${datetime}] successfully refreshed oneroster12.${endpoint}`);
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
    
    // Return boss instance for potential cleanup
    return boss;

  } catch (err) {
    console.error('[CronService] Error starting CRON jobs:', err);
    // Don't throw - let the application continue without CRON jobs
  }
}

module.exports = {
  initializeCronJobs
};