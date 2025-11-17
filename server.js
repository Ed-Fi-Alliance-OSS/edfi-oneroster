// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const app = require('./src/app');
const { initializeCronJobs } = require('./src/services/cronService');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Initialize CRON jobs for materialized view refresh (PostgreSQL only)
initializeCronJobs().catch(err => {
  console.error('Failed to initialize CRON jobs:', err);
  // Server continues running even if CRON jobs fail to start
});