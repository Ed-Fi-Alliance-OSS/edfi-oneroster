// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

require('dotenv').config();
const { getDefaultDatabaseService } = require('../services/database/DatabaseServiceFactory');

exports.list = async (req, res) => {
  try {
    const dbType = process.env.DB_TYPE === 'mssql' ? 'MSSQLSERVER' : 'POSTGRESQL';
    
    // Test database connection using Knex.js service
    const dbService = await getDefaultDatabaseService();
    await dbService.testConnection();
    
    res.json({ 
      status: "pass",
      database: dbType,
      abstraction: "Knex.js"
    });
  } catch (err) {
    console.error('[HealthController] Database health check failed:', err);
    res.status(503).json({ 
      status: "fail", 
      error: "database unreachable",
      message: err.message 
    });
  }
};
