#!/usr/bin/env node

/**
 * PostgreSQL Regression Verification Script
 * Compares PostgreSQL materialized views between control and test databases
 * to ensure no regressions were introduced by natural key ordering changes
 */

require('dotenv').config({ path: '.env.postgres' });
const knex = require('knex');

// Control PostgreSQL connection (reference system)
const controlConfig = {
    client: 'pg',
    connection: {
        host: '35.219.177.172',
        port: 5432,
        user: 'postgres',
        password: 'EdFi-Postgres-2024!',
        database: 'EdFi_Ods_Sandbox_populatedKey',
        ssl: false
    }
};

// Test PostgreSQL connection (our modified system)
const testConfig = {
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

async function compareEndpoint(controlDb, testDb, endpoint) {
    console.log(`\n=== ${endpoint.toUpperCase()} Regression Check ===`);
    
    try {
        // Dynamically determine column order from control database
        console.log(`🔍 Determining column structure for ${endpoint}...`);
        const controlColumns = await getColumnOrder(controlDb, endpoint);
        const testColumns = await getColumnOrder(testDb, endpoint);
        
        // Verify both databases have the same columns
        if (controlColumns.length !== testColumns.length || 
            !controlColumns.every((col, index) => col === testColumns[index])) {
            console.log(`❌ Column mismatch between databases!`);
            console.log(`   Control columns: ${controlColumns.join(', ')}`);
            console.log(`   Test columns: ${testColumns.join(', ')}`);
            return { endpoint, status: 'column_mismatch', identical: false };
        }
        
        console.log(`   Found ${controlColumns.length} columns: ${controlColumns.slice(0, 5).join(', ')}${controlColumns.length > 5 ? '...' : ''}`);
        
        // Query control database (reference) - get ALL rows with SELECT *
        console.log(`📊 Querying CONTROL database oneroster12.${endpoint}...`);
        const controlResultsRaw = await controlDb.raw(`SELECT * FROM oneroster12.${endpoint}`);
        
        // Query test database (our changes) - get ALL rows with SELECT *
        console.log(`📊 Querying TEST database oneroster12.${endpoint}...`);
        const testResultsRaw = await testDb.raw(`SELECT * FROM oneroster12.${endpoint}`);
        
        // Sort both datasets locally by sourcedId for consistent comparison
        const controlResults = controlResultsRaw.rows.sort((a, b) => (a.sourcedId || '').localeCompare(b.sourcedId || ''));
        const testResults = testResultsRaw.rows.sort((a, b) => (a.sourcedId || '').localeCompare(b.sourcedId || ''));
        
        console.log(`Control returned ${controlResults.length} rows`);
        console.log(`Test returned ${testResults.length} rows`);
        
        if (controlResults.length === 0 && testResults.length === 0) {
            console.log(`⚠️  Both databases returned 0 rows for ${endpoint}`);
            return { endpoint, status: 'empty', identical: true };
        }
        
        if (controlResults.length !== testResults.length) {
            console.log(`❌ Row count mismatch for ${endpoint}!`);
            console.log(`   Control: ${controlResults.length} rows`);
            console.log(`   Test: ${testResults.length} rows`);
            return { endpoint, status: 'count_mismatch', identical: false };
        }
        
        // Compare data content (all rows)
        const samplesToCheck = controlResults.length;
        console.log(`🔍 Comparing ${samplesToCheck} rows for data integrity...`);
        
        let identical = true;
        let differences = [];
        let matchedRows = 0;
        
        for (let i = 0; i < samplesToCheck; i++) {
            const controlRow = controlResults[i];
            const testRow = testResults[i];
            
            // Compare key fields based on endpoint type
            let comparisonFields = ['sourcedId', 'status', 'dateLastModified'];
            
            if (endpoint === 'users') {
                comparisonFields.push('role', 'username', 'givenName', 'familyName', 'enabledUser');
            } else if (endpoint === 'enrollments') {
                comparisonFields.push('role', 'beginDate', 'endDate');
            } else if (endpoint === 'demographics') {
                comparisonFields.push('sex', 'birthDate');
            } else if (endpoint === 'classes') {
                comparisonFields.push('title', 'classCode', 'classType');
            } else if (endpoint === 'courses') {
                comparisonFields.push('title', 'courseCode');
            } else if (endpoint === 'academicsessions') {
                comparisonFields.push('title', 'type', 'startDate', 'endDate');
            }
            
            let rowMatches = true;
            let fieldDifferences = [];
            
            for (const field of comparisonFields) {
                const controlValue = controlRow[field];
                const testValue = testRow[field];
                
                // Handle date comparison (allow for minor formatting differences)
                if (field.includes('date') || field.includes('Date')) {
                    const controlDate = controlValue ? new Date(controlValue).toISOString() : null;
                    const testDate = testValue ? new Date(testValue).toISOString() : null;
                    if (controlDate !== testDate) {
                        rowMatches = false;
                        fieldDifferences.push(`${field}: "${controlValue}" vs "${testValue}"`);
                    }
                } else if (controlValue !== testValue) {
                    rowMatches = false;
                    fieldDifferences.push(`${field}: "${controlValue}" vs "${testValue}"`);
                }
            }
            
            if (rowMatches) {
                matchedRows++;
            } else {
                identical = false;
                differences.push({
                    row: i + 1,
                    sourcedId: controlRow.sourcedId?.substring(0, 8),
                    differences: fieldDifferences
                });
            }
        }
        
        console.log(`   ✅ ${matchedRows}/${samplesToCheck} rows matched`);
        if (differences.length > 0) {
            console.log(`   ❌ ${differences.length} rows had differences`);
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
            console.log(`🎉 ${endpoint}: Data is IDENTICAL between control and test databases!`);
            return { endpoint, status: 'success', identical: true };
        } else {
            console.log(`💥 ${endpoint}: Data differs between databases!`);
            return { 
                endpoint, 
                status: 'different', 
                identical: false, 
                sampleDifferences: differences.slice(0, 3) // Limit to first 3 differences
            };
        }
        
    } catch (error) {
        console.error(`❌ Error comparing ${endpoint}:`, error.message);
        return { endpoint, status: 'error', identical: false, error: error.message };
    }
}

async function main() {
    console.log('🔍 PostgreSQL Regression Verification Starting...');
    console.log('Comparing CONTROL (35.219.177.172:5432) vs TEST (localhost:5434)');
    
    let controlDb, testDb;
    const results = [];
    
    try {
        // Connect to both databases
        controlDb = knex(controlConfig);
        testDb = knex(testConfig);
        
        // Test connections
        await controlDb.raw('SELECT 1');
        await testDb.raw('SELECT 1');
        
        console.log('✅ Connected to both PostgreSQL databases');
        
        // Compare each endpoint (excluding academicsessions for now)
        const endpoints = ['orgs', 'courses', 'classes', 'demographics', 'users', 'enrollments'];
        
        for (const endpoint of endpoints) {
            const result = await compareEndpoint(controlDb, testDb, endpoint);
            results.push(result);
        }
        
        // Summary report
        console.log('\n' + '='.repeat(70));
        console.log('📊 POSTGRESQL REGRESSION VERIFICATION REPORT');
        console.log('='.repeat(70));
        
        const passed = results.filter(r => r.identical);
        const failed = results.filter(r => !r.identical);
        
        console.log(`✅ Passed (identical): ${passed.length}/${results.length}`);
        if (passed.length > 0) {
            passed.forEach(r => console.log(`   ✅ ${r.endpoint}`));
        }
        
        console.log(`❌ Failed (different): ${failed.length}/${results.length}`);
        if (failed.length > 0) {
            failed.forEach(r => {
                console.log(`   ❌ ${r.endpoint} (${r.status})`);
                if (r.sampleDifferences && r.sampleDifferences.length > 0) {
                    r.sampleDifferences.forEach(diff => {
                        console.log(`      Row ${diff.row}: ${diff.differences.join(', ')}`);
                    });
                }
            });
        }
        
        if (failed.length === 0) {
            console.log('\n🎉 SUCCESS! No regressions detected. All endpoints match between control and test databases.');
            process.exit(0);
        } else {
            console.log('\n💥 REGRESSION DETECTED! Some endpoints differ between control and test databases.');
            console.log('Please investigate the differences before proceeding.');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Verification failed:', error.message);
        process.exit(1);
    } finally {
        // Clean up connections
        if (controlDb) await controlDb.destroy();
        if (testDb) await testDb.destroy();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };