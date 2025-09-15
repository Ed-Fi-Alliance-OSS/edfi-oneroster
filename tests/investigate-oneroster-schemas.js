#!/usr/bin/env node

/**
 * OneRoster Schema Investigation Script
 * Compare PostgreSQL materialized views vs MSSQL tables in oneroster12 schema
 */

require('dotenv').config({ path: '.env.postgres' });
const knex = require('knex');

// PostgreSQL connection - use the exposed port from ed-fi-db-ods container
const pgConfig = {
    client: 'pg',
    connection: {
        host: 'localhost',  // Container exposes to localhost
        port: 5434,         // Port 5434 is mapped to ed-fi-db-ods:5432
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true'
    }
};

// MSSQL connection
const mssqlConfig = {
    client: 'mssql',
    connection: {
        server: process.env.MSSQL_SERVER,
        database: process.env.MSSQL_DATABASE,
        user: process.env.MSSQL_USER,
        password: process.env.MSSQL_PASSWORD,
        options: {
            encrypt: process.env.MSSQL_ENCRYPT === 'true',
            trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === 'true'
        }
    }
};

async function compareEndpoint(pgDb, mssqlDb, endpoint) {
    console.log(`\n=== ${endpoint.toUpperCase()} Comparison ===`);
    
    try {
        // Query PostgreSQL materialized view
        console.log(`📊 Querying PostgreSQL oneroster12.${endpoint} materialized view...`);
        const pgResults = await pgDb(`oneroster12.${endpoint}`)
            .select('*')
            .limit(10);
        
        // Query MSSQL table
        console.log(`📊 Querying MSSQL oneroster12.${endpoint} table...`);
        const mssqlResults = await mssqlDb(`oneroster12.${endpoint}`)
            .select('*')
            .limit(10);
        
        console.log(`PostgreSQL returned ${pgResults.length} rows`);
        console.log(`MSSQL returned ${mssqlResults.length} rows`);
        
        if (pgResults.length === 0 && mssqlResults.length === 0) {
            console.log(`⚠️  Both databases returned 0 rows for ${endpoint}`);
            return { endpoint, status: 'empty', identical: true };
        }
        
        if (pgResults.length !== mssqlResults.length) {
            console.log(`❌ Row count mismatch for ${endpoint}!`);
            return { endpoint, status: 'count_mismatch', identical: false };
        }
        
        // Compare first few rows
        console.log(`\n🔍 Comparing first ${Math.min(5, pgResults.length)} rows:`);
        let identical = true;
        
        for (let i = 0; i < Math.min(5, pgResults.length); i++) {
            const pgRow = pgResults[i];
            const mssqlRow = mssqlResults[i];
            
            // Compare key identifying fields based on endpoint
            let pgKey, mssqlKey, pgTitle, mssqlTitle;
            
            if (endpoint === 'classes') {
                pgKey = `${pgRow.courseCode || 'N/A'}-${pgRow.classCode || 'N/A'}`;
                mssqlKey = `${mssqlRow.courseCode || 'N/A'}-${mssqlRow.classCode || 'N/A'}`;
                pgTitle = pgRow.title;
                mssqlTitle = mssqlRow.title;
            } else if (endpoint === 'courses') {
                pgKey = pgRow.courseCode || 'N/A';
                mssqlKey = mssqlRow.courseCode || 'N/A';
                pgTitle = pgRow.title;
                mssqlTitle = mssqlRow.title;
            } else if (endpoint === 'academicsessions') {
                pgKey = pgRow.title || 'N/A';
                mssqlKey = mssqlRow.title || 'N/A';
                pgTitle = `${pgRow.type}`;
                mssqlTitle = `${mssqlRow.type}`;
            } else if (endpoint === 'enrollments') {
                // For enrollments, use role and first part of sourcedId as key
                pgKey = `${pgRow.role || 'N/A'}-${pgRow.sourcedId?.substring(0, 8) || 'N/A'}`;
                mssqlKey = `${mssqlRow.role || 'N/A'}-${mssqlRow.sourcedId?.substring(0, 8) || 'N/A'}`;
                pgTitle = `${pgRow.beginDate || 'N/A'}`;
                mssqlTitle = `${mssqlRow.beginDate || 'N/A'}`;
            } else {
                // Generic comparison using sourcedId
                pgKey = pgRow.sourcedId?.substring(0, 8) || 'N/A';
                mssqlKey = mssqlRow.sourcedId?.substring(0, 8) || 'N/A';
                pgTitle = pgRow.title || pgRow.name || 'N/A';
                mssqlTitle = mssqlRow.title || mssqlRow.name || 'N/A';
            }
            
            if (pgKey === mssqlKey && pgTitle === mssqlTitle) {
                console.log(`  ✅ Row ${i + 1}: ${pgKey} - ${pgTitle}`);
            } else {
                console.log(`  ❌ Row ${i + 1}:`);
                console.log(`     PostgreSQL: ${pgKey} - ${pgTitle}`);
                console.log(`     MSSQL:      ${mssqlKey} - ${mssqlTitle}`);
                identical = false;
            }
        }
        
        if (identical) {
            console.log(`🎉 ${endpoint}: First ${Math.min(5, pgResults.length)} rows are IDENTICAL!`);
            return { endpoint, status: 'success', identical: true };
        } else {
            console.log(`💥 ${endpoint}: Rows differ between databases!`);
            return { endpoint, status: 'different', identical: false };
        }
        
    } catch (error) {
        console.error(`❌ Error comparing ${endpoint}:`, error.message);
        return { endpoint, status: 'error', identical: false, error: error.message };
    }
}

async function main() {
    console.log('🔍 OneRoster Schema Investigation Starting...');
    console.log('Comparing PostgreSQL materialized views vs MSSQL tables');
    
    let pgDb, mssqlDb;
    const results = [];
    
    try {
        // Connect to both databases
        pgDb = knex(pgConfig);
        mssqlDb = knex(mssqlConfig);
        
        // Test connections
        await pgDb.raw('SELECT 1');
        await mssqlDb.raw('SELECT 1');
        
        console.log('✅ Connected to both databases');
        
        // Compare each endpoint
        const endpoints = ['classes', 'courses', 'academicsessions', 'enrollments'];
        
        for (const endpoint of endpoints) {
            const result = await compareEndpoint(pgDb, mssqlDb, endpoint);
            results.push(result);
        }
        
        // Summary report
        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY REPORT');
        console.log('='.repeat(60));
        
        const successful = results.filter(r => r.identical);
        const failed = results.filter(r => !r.identical);
        
        console.log(`✅ Identical endpoints: ${successful.length}/${results.length}`);
        if (successful.length > 0) {
            successful.forEach(r => console.log(`   ✅ ${r.endpoint}`));
        }
        
        console.log(`❌ Different endpoints: ${failed.length}/${results.length}`);
        if (failed.length > 0) {
            failed.forEach(r => console.log(`   ❌ ${r.endpoint} (${r.status})`));
        }
        
        if (failed.length === 0) {
            console.log('\n🎉 ALL ENDPOINTS MATCH! PostgreSQL and MSSQL schemas are consistent.');
        } else {
            console.log('\n💥 SOME ENDPOINTS DIFFER! Manual investigation needed.');
        }
        
    } catch (error) {
        console.error('❌ Investigation failed:', error.message);
        process.exit(1);
    } finally {
        // Clean up connections
        if (pgDb) await pgDb.destroy();
        if (mssqlDb) await mssqlDb.destroy();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };