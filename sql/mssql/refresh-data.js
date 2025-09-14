#!/usr/bin/env node

/**
 * MSSQL OneRoster Data Refresh Script
 * 
 * This script runs the OneRoster refresh procedures to populate tables with Ed-Fi data.
 * Run this after deployment to populate the OneRoster tables.
 * 
 * Usage:
 *   node sql/mssql/refresh-data.js
 *   
 * Requirements:
 *   - OneRoster deployment completed successfully
 *   - .env file with MSSQL connection settings
 */

const sql = require('mssql');
const path = require('path');

// Load environment variables from project root
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// MSSQL Connection Configuration
const config = {
    server: process.env.MSSQL_SERVER || 'localhost',
    database: process.env.MSSQL_DATABASE || 'EdFi_Ods_Populated_Template',
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    port: parseInt(process.env.MSSQL_PORT) || 1433,
    options: {
        encrypt: process.env.MSSQL_ENCRYPT === 'true',
        trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true
    },
    connectionTimeout: 30000,
    requestTimeout: 120000
};

/**
 * Run OneRoster data refresh procedures
 */
async function refreshOneRosterData() {
    console.log('========================================');
    console.log('OneRoster 1.2 Data Refresh');
    console.log('========================================');
    console.log(`Target Server: ${config.server}`);
    console.log(`Target Database: ${config.database}`);
    console.log(`User: ${config.user}`);
    console.log(`Refresh Time: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    try {
        console.log('🔌 Connecting to SQL Server...');
        const pool = await sql.connect(config);
        console.log('✅ Connected successfully\n');
        
        // Run individual refresh procedures in logical order
        const refreshOrder = [
            'sp_refresh_orgs',
            'sp_refresh_academicsessions', 
            'sp_refresh_courses',
            'sp_refresh_classes',
            'sp_refresh_demographics',
            'sp_refresh_users',
            'sp_refresh_enrollments'
        ];
        
        let successCount = 0;
        const startTime = Date.now();
        
        console.log('🔄 Running OneRoster refresh procedures...\n');
        
        for (const proc of refreshOrder) {
            try {
                console.log(`⚡ Executing oneroster12.${proc}...`);
                
                const request = pool.request();
                request.timeout = 120000; // 2 minute timeout per procedure
                await request.query(`EXEC oneroster12.${proc}`);
                
                successCount++;
                console.log(`   ✅ ${proc} completed successfully`);
            } catch (procErr) {
                console.log(`   ❌ ${proc} failed: ${procErr.message.split('\n')[0]}`);
            }
        }
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`\n✅ Refresh completed: ${successCount}/${refreshOrder.length} procedures succeeded in ${duration} seconds\n`);
        
        // Show record counts after refresh
        console.log('📊 Record counts after refresh:');
        const tables = ['academicsessions', 'classes', 'courses', 'demographics', 'enrollments', 'orgs', 'users'];
        
        for (const table of tables) {
            try {
                const countResult = await pool.request().query(`SELECT COUNT(*) as RecordCount FROM oneroster12.${table}`);
                const count = countResult.recordset[0].RecordCount;
                console.log(`   ${table}: ${count.toLocaleString()} records`);
            } catch (countErr) {
                console.log(`   ${table}: Error getting count - ${countErr.message.split('\n')[0]}`);
            }
        }
        
        await pool.close();
        
        console.log('\n========================================');
        if (successCount === refreshOrder.length) {
            console.log('🎉 DATA REFRESH COMPLETED SUCCESSFULLY!');
        } else if (successCount > 0) {
            console.log(`⚠️  DATA REFRESH COMPLETED WITH WARNINGS (${refreshOrder.length - successCount} procedures failed)`);
        } else {
            console.log('❌ DATA REFRESH FAILED');
        }
        console.log('========================================');
        
        process.exit(successCount === refreshOrder.length ? 0 : 1);
        
    } catch (err) {
        console.error('\n❌ DATA REFRESH FAILED!');
        console.error('Error:', err.message);
        console.log('\nPlease ensure:');
        console.log('1. OneRoster deployment has completed successfully');
        console.log('2. Database connection settings are correct in .env');
        console.log('3. Database user has appropriate permissions');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    refreshOneRosterData();
}

module.exports = { refreshOneRosterData };