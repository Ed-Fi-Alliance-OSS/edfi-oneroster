const { Pool } = require('pg');
const PgBoss = require('pg-boss');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
});
exports.pool = pool;

class PgBossInstance extends PgBoss {
  async onApplicationShutdown() {
    await this.stop({ graceful: false, destroy: true });
  }
}
exports.pg_boss = async () => {
  try {
    const boss = new PgBossInstance({
      "host": process.env.DB_HOST,
      "port": process.env.DB_PORT || 5432,
      "database": process.env.PGBOSS_DB || "oneroster_pgboss",
      "user": process.env.DB_USER,
      "password": process.env.DB_PASS
    });
    const config = {
      cronMonitorIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
      noDefault: true
    }
    await boss.start(config);
    boss.on('error', console.error);
    const endpoints = ['academicSessions', 'classes', 'courses', 'demographics', 'enrollments', 'orgs', 'users'];
    for (const endpoint of endpoints) {
      const queue = `oneroster-refresh-${endpoint}`;
      await boss.createQueue(queue);
      await boss.work(queue, async (job) => {
        const datetime = new Date();
        console.log(`[${datetime}] refreshing view oneroster12.${endpoint}`);
        await pool.query(`refresh materialized view oneroster12.${endpoint}`);
      });
      await boss.schedule(queue, process.env.PGBOSS_CRON);
    }
  } catch (err) {
    console.error('error starting cron to update views');
  }
};;
