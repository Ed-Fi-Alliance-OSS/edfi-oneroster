#!/usr/bin/env node

/**
 * DS4 vs DS5 Users Comparison Test
 * Comprehensive comparison of users endpoint between Ed-Fi Data Standard 4 and 5
 * Assumes identical sample data exists in both databases
 */

const knex = require('knex');

// DS4 PostgreSQL connection (Docker container on port 5435)
const ds4Config = {
    client: 'pg',
    connection: {
        host: 'localhost',
        port: 5435,
        user: 'postgres',
        password: 'P@ssw0rd',
        database: 'EdFi_Ods_Populated_Template',
        ssl: false
    }
};

// DS5 PostgreSQL connection (check if local or use environment)
const ds5Config = {
    client: 'pg',
    connection: {
        host: 'localhost', // Try localhost first, may need to adjust
        port: 5434, // Common local port for DS5
        user: 'postgres',
        password: 'EdFi-Postgres-2024!',
        database: 'EdFi_Ods_Sandbox_populatedKey',
        ssl: false
    }
};

async function getColumnOrder(db, endpoint) {
    // Get column order by querying with SELECT * and examining the result structure
    const sampleQuery = await db.raw(`SELECT * FROM oneroster12.${endpoint} LIMIT 1`);
    if (sampleQuery.rows.length === 0) {
        // If no data, get column info from schema
        const columnsQuery = await db.raw(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'oneroster12' AND table_name = '${endpoint}' 
            ORDER BY ordinal_position
        `);
        return columnsQuery.rows.map(row => row.column_name);
    }
    
    // Return column names in the order they appear in SELECT *
    return Object.keys(sampleQuery.rows[0]);
}

async function setupDS4Database(ds4Db) {
    console.log('🔧 Setting up DS4 users materialized view...');
    
    // Read and execute the DS4 users SQL
    const fs = require('fs');
    const usersDS4SQL = fs.readFileSync('/home/cmoffatt/sunday/edfi-oneroster/sql/users_ds4.sql', 'utf8');
    
    await ds4Db.raw(usersDS4SQL);
    console.log('✅ DS4 materialized view created successfully');
}

async function setupDS5Database(ds5Db) {
    console.log('🔧 Setting up DS5 users materialized view...');
    
    // Read and execute the DS5 users SQL
    const fs = require('fs');
    const usersDS5SQL = fs.readFileSync('/home/cmoffatt/sunday/edfi-oneroster/sql/users.sql', 'utf8');
    
    await ds5Db.raw(usersDS5SQL);
    console.log('✅ DS5 materialized view created successfully');
}

async function compareUsersEndpoint(ds4Db, ds5Db, compareAllFields = false) {
    const checkTitle = compareAllFields ? "USERS Full Field Check" : "USERS Regression Check";
    console.log(`\n=== ${checkTitle} ===`);
    
    try {
        // Dynamically determine column order from control database (DS5)
        console.log(`🔍 Determining column structure for users...`);
        const controlColumns = await getColumnOrder(ds5Db, 'users');
        const testColumns = await getColumnOrder(ds4Db, 'users');
        
        // Verify both databases have the same columns
        if (controlColumns.length !== testColumns.length || 
            !controlColumns.every((col, index) => col === testColumns[index])) {
            console.log(`❌ Column mismatch between databases!`);
            console.log(`   Control columns: ${controlColumns.join(', ')}`);
            console.log(`   Test columns: ${testColumns.join(', ')}`);
            return { endpoint: 'users', status: 'column_mismatch', identical: false };
        }
        
        console.log(`   Found ${controlColumns.length} columns: ${controlColumns.slice(0, 5).join(', ')}${controlColumns.length > 5 ? '...' : ''}`);
        
        // Query control database (DS5) - get ALL rows with natural ordering
        console.log(`📊 Querying CONTROL database oneroster12.users...`);
        const controlResultsRaw = await ds5Db.raw(`SELECT * FROM oneroster12.users`);
        
        // Query test database (DS4) - get ALL rows with natural ordering  
        console.log(`📊 Querying TEST database oneroster12.users...`);
        const testResultsRaw = await ds4Db.raw(`SELECT * FROM oneroster12.users`);
        
        // Sort both datasets locally by sourcedId for consistent comparison
        const controlResults = controlResultsRaw.rows.sort((a, b) => (a.sourcedId || '').localeCompare(b.sourcedId || ''));
        const testResults = testResultsRaw.rows.sort((a, b) => (a.sourcedId || '').localeCompare(b.sourcedId || ''));
        
        console.log(`Control returned ${controlResults.length} rows`);
        console.log(`Test returned ${testResults.length} rows`);
        
        if (controlResults.length === 0 && testResults.length === 0) {
            console.log(`⚠️  Both databases returned 0 rows for users`);
            return { endpoint: 'users', status: 'empty', identical: true };
        }
        
        if (controlResults.length !== testResults.length) {
            console.log(`❌ Row count mismatch for users!`);
            console.log(`   Control: ${controlResults.length} rows`);
            console.log(`   Test: ${testResults.length} rows`);
            return { endpoint: 'users', status: 'count_mismatch', identical: false };
        }
        
        // Compare data content
        const samplesToCheck = controlResults.length;
        console.log(`🔍 Comparing ${samplesToCheck} rows for data integrity...`);
        
        let identical = true;
        let matchedRows = 0;
        let differences = [];
        
        // Choose comparison fields based on mode
        const comparisonFields = compareAllFields 
            ? controlColumns.filter(col => col !== 'dateLastModified') // All fields except dateLastModified
            : ['sourcedId', 'status', 'role', 'username', 'givenName', 'familyName', 'enabledUser', 'identifier']; // Core fields only
        
        if (compareAllFields) {
            console.log(`   Comparing ALL ${comparisonFields.length} fields (excluding dateLastModified)`);
        }
        
        for (let i = 0; i < samplesToCheck; i++) {
            const controlRow = controlResults[i];
            const testRow = testResults[i];
            
            let rowMatches = true;
            let fieldDifferences = [];
            
            for (const field of comparisonFields) {
                const controlValue = controlRow[field];
                const testValue = testRow[field];
                
                // Handle JSON fields for detailed comparison
                if (compareAllFields && (field === 'userIds' || field === 'roles' || field === 'metadata')) {
                    const controlStr = typeof controlValue === 'object' ? JSON.stringify(controlValue) : controlValue;
                    const testStr = typeof testValue === 'object' ? JSON.stringify(testValue) : testValue;
                    if (controlStr !== testStr) {
                        rowMatches = false;
                        fieldDifferences.push(`${field}: CONTROL=${controlStr?.substring(0, 150)}... vs TEST=${testStr?.substring(0, 150)}...`);
                    }
                } else if (controlValue !== testValue) {
                    rowMatches = false;
                    if (compareAllFields) {
                        fieldDifferences.push(`${field}: CONTROL="${controlValue}" vs TEST="${testValue}"`);
                    } else {
                        break; // Exit early for core field comparison
                    }
                }
            }
            
            if (rowMatches) {
                matchedRows++;
            } else {
                identical = false;
                if (compareAllFields && differences.length < 5) {
                    differences.push({
                        row: i + 1,
                        sourcedId: controlRow.sourcedId?.substring(0, 12),
                        role: controlRow.role,
                        differences: fieldDifferences
                    });
                }
            }
        }
        
        console.log(`   ✅ ${matchedRows}/${samplesToCheck} rows matched`);
        
        // Show sample differences if comparing all fields
        if (compareAllFields && differences.length > 0) {
            console.log(`\n🔍 Sample Field Differences (first 5):`);
            differences.forEach(diff => {
                console.log(`   Row ${diff.row} (${diff.role} ${diff.sourcedId}):`);
                diff.differences.slice(0, 3).forEach(fieldDiff => {
                    console.log(`     • ${fieldDiff}`);
                });
                if (diff.differences.length > 3) {
                    console.log(`     ... and ${diff.differences.length - 3} more field differences`);
                }
            });
        }
        
        // Additional check: verify all sourcedIds match (order-independent)
        const controlIds = new Set(controlResults.map(row => row.sourcedId));
        const testIds = new Set(testResults.map(row => row.sourcedId));
        
        const missingInTest = [...controlIds].filter(id => !testIds.has(id));
        const extraInTest = [...testIds].filter(id => !controlIds.has(id));
        
        if (missingInTest.length > 0 || extraInTest.length > 0) {
            console.log(`❌ SourcedId mismatch detected:`);
            if (missingInTest.length > 0) {
                console.log(`   Missing in test: ${missingInTest.slice(0, 5).join(', ')}${missingInTest.length > 5 ? '...' : ''}`);
            }
            if (extraInTest.length > 0) {
                console.log(`   Extra in test: ${extraInTest.slice(0, 5).join(', ')}${extraInTest.length > 5 ? '...' : ''}`);
            }
            identical = false;
        }
        
        if (identical) {
            console.log(`🎉 users: Data is IDENTICAL between control and test databases!`);
            return { endpoint: 'users', status: 'success', identical: true };
        } else {
            const diffMessage = compareAllFields ? `users: Data differs between control and test databases (expected DS4/DS5 schema differences)!` : `users: Data differs between control and test databases!`;
            console.log(`💥 ${diffMessage}`);
            return { 
                endpoint: 'users', 
                status: 'different', 
                identical: false,
                totalDifferences: samplesToCheck - matchedRows
            };
        }
        
    } catch (error) {
        console.error(`❌ Error comparing users:`, error.message);
        return { endpoint: 'users', status: 'error', identical: false, error: error.message };
    }
}

async function main() {
    console.log('🔍 DS4 vs DS5 Users Regression Verification Starting...');
    console.log('Comparing CONTROL (DS5 localhost:5434) vs TEST (DS4 localhost:5435)');
    
    let ds4Db, ds5Db;
    
    try {
        // Connect to both databases
        ds4Db = knex(ds4Config);
        ds5Db = knex(ds5Config);
        
        // Test connections
        await ds4Db.raw('SELECT 1');
        await ds5Db.raw('SELECT 1');
        
        console.log('✅ Connected to both PostgreSQL databases');
        
        // Setup both databases
        await setupDS4Database(ds4Db);
        await setupDS5Database(ds5Db);
        
        // First comparison: Core fields only (regression check)
        const coreResult = await compareUsersEndpoint(ds4Db, ds5Db, false);
        
        // Second comparison: All fields (to show differences)
        const fullResult = await compareUsersEndpoint(ds4Db, ds5Db, true);
        
        if (coreResult.identical) {
            console.log('\n🎉 SUCCESS! No regressions detected. Users endpoint matches between control and test databases.');
            if (!fullResult.identical) {
                console.log(`📊 Note: Full field comparison showed ${fullResult.totalDifferences} differences due to expected DS4/DS5 schema variations.`);
            }
            process.exit(0);
        } else {
            console.log('\n💥 REGRESSION DETECTED! Users endpoint differs between control and test databases.');
            console.log('Please investigate the differences before proceeding.');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Comparison failed:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Make sure both databases are running:');
            console.log('   DS4: docker start edfi-ds4-ods');
            console.log('   DS5: Check ed-fi-db-ods connection');
        }
        process.exit(1);
    } finally {
        // Clean up connections
        if (ds4Db) await ds4Db.destroy();
        if (ds5Db) await ds5Db.destroy();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main, compareUsersEndpoint };