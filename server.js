// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Load environment variables FIRST before importing any modules
import dotenv from 'dotenv';
dotenv.config();

// Use dynamic imports to ensure dotenv is loaded before app initialization
const { default: app } = await import('./src/app.js');
const { initializeCronJobs } = await import('./src/services/cronService.js');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Initialize CRON jobs for materialized view refresh (PostgreSQL only)
initializeCronJobs().catch(err => {
  console.error('Failed to initialize CRON jobs:', err);
  // Server continues running even if CRON jobs fail to start
});
