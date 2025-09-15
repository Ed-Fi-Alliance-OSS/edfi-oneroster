#!/usr/bin/env node

/**
 * Investigation of hash calculation differences between PostgreSQL and MSSQL
 * Compare MD5 hashes for identical natural keys
 */

require('dotenv').config({ path: '.env.postgres' });
const knex = require('knex');

// PostgreSQL connection
const pgConfig = {
    client: 'pg',
    connection: {
        host: 'localhost',
        port: 5434,
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

async function compareHashesForSameKeys(pgDb, mssqlDb) {
    console.log(`\n=== Hash Comparison for Identical Natural Keys ===`);
    
    // Test a few specific natural keys that should exist in both databases
    const testKeys = [
        {
            course: 'ALG-1',
            school: 255901001,
            section: '25590100102Trad220ALG112011',
            session: '2021-2022 Fall Semester'
        },
        {
            course: 'PHYSICS',
            school: 255901001,
            section: '25590100106Trad223PHYSICS12011',
            session: '2021-2022 Fall Semester'
        },
        {
            course: 'US-HIST',
            school: 255901001,
            section: '25590100101Trad123USHIST12011',
            session: '2021-2022 Fall Semester'
        }
    ];
    
    for (const key of testKeys) {
        console.log(`\nTesting natural key: ${key.course}-${key.school}-${key.section}-${key.session}`);
        
        // PostgreSQL hash calculation
        const pgResult = await pgDb.raw(`
            SELECT md5(concat(
                lower(?)::varchar,
                '-', ?::varchar,
                '-', lower(?)::varchar,
                '-', lower(?::varchar)
            )) as hash
        `, [key.course, key.school, key.section, key.session]);
        
        const pgHash = pgResult.rows[0].hash;
        
        // MSSQL hash calculation
        const mssqlResult = await mssqlDb.raw(`
            SELECT LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                CONCAT(LOWER(?), '-', CAST(? AS VARCHAR), '-', LOWER(?), '-', LOWER(?))), 2)) as hash
        `, [key.course, key.school, key.section, key.session]);
        
        const mssqlHash = (mssqlResult.recordset || mssqlResult.rows || mssqlResult)[0].hash;
        
        console.log(`  PostgreSQL hash: ${pgHash}`);
        console.log(`  MSSQL hash:      ${mssqlHash}`);
        console.log(`  Match: ${pgHash === mssqlHash ? '✅' : '❌'}`);
        
        if (pgHash !== mssqlHash) {
            // Debug the input string construction
            const pgInputResult = await pgDb.raw(`
                SELECT concat(
                    lower(?)::varchar,
                    '-', ?::varchar,
                    '-', lower(?)::varchar,
                    '-', lower(?::varchar)
                ) as input_string
            `, [key.course, key.school, key.section, key.session]);
            
            const mssqlInputResult = await mssqlDb.raw(`
                SELECT CONCAT(LOWER(?), '-', CAST(? AS VARCHAR), '-', LOWER(?), '-', LOWER(?)) as input_string
            `, [key.course, key.school, key.section, key.session]);
            
            console.log(`  PostgreSQL input: "${pgInputResult.rows[0].input_string}"`);
            console.log(`  MSSQL input:      "${(mssqlInputResult.recordset || mssqlInputResult.rows || mssqlInputResult)[0].input_string}"`);
        }
    }
}

async function main() {
    console.log('🔍 Hash Calculation Investigation Starting...');
    
    let pgDb, mssqlDb;
    
    try {
        // Connect to both databases
        pgDb = knex(pgConfig);
        mssqlDb = knex(mssqlConfig);
        
        // Test connections
        await pgDb.raw('SELECT 1');
        await mssqlDb.raw('SELECT 1');
        
        console.log('✅ Connected to both databases');
        
        // Compare hashes for identical natural keys
        await compareHashesForSameKeys(pgDb, mssqlDb);
        
        console.log('\n🎉 Hash investigation completed!');
        
    } catch (error) {
        console.error('❌ Investigation failed:', error.message);
        console.error('Full error:', error);
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