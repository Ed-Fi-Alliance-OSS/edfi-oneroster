// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Load environment variables FIRST before importing any modules
import dotenv from 'dotenv';
import fs from 'fs';
import https from 'https';
dotenv.config();

const { getLogger } = await import('./src/utils/logger.js');
const logger = getLogger('Server');

const { bootstrapAppSecretsIfNeeded } = await import('./src/config/app-secrets-bootstrap.js');
try {
  await bootstrapAppSecretsIfNeeded();
} catch (err) {
  logger.fatal({ err }, 'App secrets bootstrap failed');
  process.exit(1);
}

// Validate environment variables before proceeding
const { validateAndExit } = await import('./src/utils/envValidator.js');
validateAndExit();

// When TENANTS_CONFIG_MODULE is set, preload tenant map from that module before listening.
const { initializeTenantsConfig, refreshTenantsConfig } = await import('./src/config/multi-tenancy-config.js');
try {
  await initializeTenantsConfig();
} catch (err) {
  logger.fatal({ err }, 'Failed to load tenant configuration');
  process.exit(1);
}

// Reload tenant list without HTTP (e.g. kill -USR2). No-op when TENANTS_CONFIG_MODULE is not set.
process.on('SIGUSR2', () => {
  refreshTenantsConfig('signal').catch(err =>
    logger.warn({ err }, 'SIGUSR2 tenant refresh failed')
  );
});

// Use dynamic imports to ensure dotenv is loaded before app initialization
const { default: app } = await import('./src/app.js');
const { initializeCronJobs } = await import('./src/services/cronService.js');
const { odsInstanceService } = await import('./src/services/database/OdsInstanceService.js');
const { knexManager } = await import('./src/config/knex-factory.js');

const PORT = process.env.PORT || 3000;
const HTTPS_ENABLED = (process.env.ENABLE_HTTPS || 'false').toLowerCase() === 'true';

function loadTlsCredentials() {
  const keyPath = process.env.TLS_KEY_PATH;
  const certPath = process.env.TLS_CERT_PATH;

  if (!keyPath || !certPath) {
    throw new Error('ENABLE_HTTPS=true requires TLS_KEY_PATH and TLS_CERT_PATH.');
  }

  const credentials = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    minVersion: 'TLSv1.2'
  };

  if (process.env.TLS_CA_PATH) {
    credentials.ca = fs.readFileSync(process.env.TLS_CA_PATH);
  }

  return credentials;
}

// Store server and pgBoss instances for graceful shutdown
let server;

if (HTTPS_ENABLED) {
  const tlsCredentials = loadTlsCredentials();
  server = https.createServer(tlsCredentials, app).listen(PORT, () => {
    logger.info(`HTTPS server running on port ${PORT}`);
  });
} else {
  server = app.listen(PORT, () => {
    logger.info(`HTTP server running on port ${PORT}`);
  });
}

// Initialize CRON jobs for materialized view refresh (PostgreSQL only)
let pgBossInstance = null;
initializeCronJobs()
  .then(boss => {
    pgBossInstance = boss;
  })
  .catch(err => {
    logger.error({ err }, 'Failed to initialize CRON jobs');
    // Server continues running even if CRON jobs fail to start
  });

/**
 * Graceful shutdown handler
 * Cleans up resources when SIGTERM or SIGINT is received
 * Important for IIS app pool recycling (gracefulShutdownTimeout: 60s)
 */
async function gracefulShutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      // Clean up resources in parallel where possible
      const cleanupTasks = [];

      // Stop pg-boss CRON jobs
      if (pgBossInstance) {
        logger.info('Stopping pg-boss...');
        cleanupTasks.push(
          pgBossInstance.stop({ graceful: true, timeout: 5000 })
            .then(() => logger.info('pg-boss stopped'))
            .catch(err => logger.error({ err }, 'Error stopping pg-boss'))
        );
      }

      // Close ODS Instance Service admin connections
      logger.info('Closing ODS instance admin connections...');
      cleanupTasks.push(
        odsInstanceService.destroy()
          .then(() => logger.info('ODS instance connections closed'))
          .catch(err => logger.error({ err }, 'Error closing ODS instance connections'))
      );

      // Close all knex connection pools
      logger.info('Closing knex connection pools...');
      cleanupTasks.push(
        knexManager.closeAll()
          .then(() => logger.info('Knex connections closed'))
          .catch(err => logger.error({ err }, 'Error closing knex connections'))
      );

      await Promise.allSettled(cleanupTasks);

      logger.info('All resources cleaned up successfully');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Force shutdown after timeout (50s to fit within IIS 60s gracefulShutdownTimeout)
  setTimeout(() => {
    logger.error('Forced shutdown after 50s timeout');
    process.exit(1);
  }, 50000);
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
