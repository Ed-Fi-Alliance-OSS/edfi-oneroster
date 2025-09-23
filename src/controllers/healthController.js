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