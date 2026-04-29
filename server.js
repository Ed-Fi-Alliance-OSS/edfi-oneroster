// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Load environment variables FIRST before importing any modules
import dotenv from 'dotenv';
dotenv.config();

// Validate environment variables before proceeding
const { validateAndExit } = await import('./src/utils/envValidator.js');
validateAndExit();

// Use dynamic imports to ensure dotenv is loaded before app initialization
const { default: app } = await import('./src/app.js');
const { initializeCronJobs } = await import('./src/services/cronService.js');
const { odsInstanceService } = await import('./src/services/database/OdsInstanceService.js');
const { knexManager } = await import('./src/config/knex-factory.js');

const PORT = process.env.PORT || 3000;

// Store server and pgBoss instances for graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Initialize CRON jobs for materialized view refresh (PostgreSQL only)
let pgBossInstance = null;
initializeCronJobs()
  .then(boss => {
    pgBossInstance = boss;
  })
  .catch(err => {
    console.error('Failed to initialize CRON jobs:', err);
    // Server continues running even if CRON jobs fail to start
  });

/**
 * Graceful shutdown handler
 * Cleans up resources when SIGTERM or SIGINT is received
 * Important for IIS app pool recycling (gracefulShutdownTimeout: 60s)
 */
async function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('[Server] HTTP server closed');

    try {
      // Clean up resources in parallel where possible
      const cleanupTasks = [];

      // Stop pg-boss CRON jobs
      if (pgBossInstance) {
        console.log('[Server] Stopping pg-boss...');
        cleanupTasks.push(
          pgBossInstance.stop({ graceful: true, timeout: 5000 })
            .then(() => console.log('[Server] pg-boss stopped'))
            .catch(err => console.error('[Server] Error stopping pg-boss:', err.message))
        );
      }

      // Close ODS Instance Service admin connections
      console.log('[Server] Closing ODS instance admin connections...');
      cleanupTasks.push(
        odsInstanceService.destroy()
          .then(() => console.log('[Server] ODS instance connections closed'))
          .catch(err => console.error('[Server] Error closing ODS instance connections:', err.message))
      );

      // Close all knex connection pools
      console.log('[Server] Closing knex connection pools...');
      cleanupTasks.push(
        knexManager.closeAll()
          .then(() => console.log('[Server] Knex connections closed'))
          .catch(err => console.error('[Server] Error closing knex connections:', err.message))
      );

      await Promise.allSettled(cleanupTasks);

      console.log('[Server] All resources cleaned up successfully');
      process.exit(0);
    } catch (error) {
      console.error('[Server] Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force shutdown after timeout (50s to fit within IIS 60s gracefulShutdownTimeout)
  setTimeout(() => {
    console.error('[Server] Forced shutdown after 50s timeout');
    process.exit(1);
  }, 50000);
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
