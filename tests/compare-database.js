#!/usr/bin/env node

/**
 * OneRoster Database Comparison Script
 * Compare PostgreSQL materialized views vs MSSQL tables in oneroster12 schema
 * Direct database-to-database data parity validation
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

// Helper function to check if a value contains sourcedId references
function containsSourcedId(value) {
    if (!value) {
        return false;
    }
    
    // Convert to string and check for sourcedId presence
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    return stringValue.includes('sourcedId') || stringValue.includes('href');
}

async function getColumnOrder(db, endpoint, dbType) {
    // Get column order by querying with SELECT * and examining the result structure
    try {
        let sampleQuery;
        if (dbType === 'postgres') {
            sampleQuery = await db.raw(`SELECT * FROM oneroster12.${endpoint} LIMIT 1`);
        } else {
            // MSSQL uses TOP instead of LIMIT
            sampleQuery = await db.raw(`SELECT TOP 1 * FROM oneroster12.${endpoint}`);
        }
        
        if (dbType === 'postgres') {
            if (sampleQuery.rows && sampleQuery.rows.length > 0) {
                return Object.keys(sampleQuery.rows[0]);
            }
        } else {
            // For MSSQL, the result might be an array directly or have different structure
            if (Array.isArray(sampleQuery) && sampleQuery.length > 0) {
                return Object.keys(sampleQuery[0]);
            } else if (sampleQuery[0] && Array.isArray(sampleQuery[0]) && sampleQuery[0].length > 0) {
                return Object.keys(sampleQuery[0][0]);
            } else if (sampleQuery.recordset && sampleQuery.recordset.length > 0) {
                return Object.keys(sampleQuery.recordset[0]);
            }
        }
        
        // If no data, get column info from schema
        if (dbType === 'postgres') {
            const columnsQuery = await db.raw(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = 'oneroster12' AND table_name = '${endpoint}' 
                ORDER BY ordinal_position
            `);
            return columnsQuery.rows?.map(row => row.column_name) || [];
        } else {
            // MSSQL schema query
            const columnsQuery = await db.raw(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = 'oneroster12' AND TABLE_NAME = '${endpoint}' 
                ORDER BY ORDINAL_POSITION
            `);
            return columnsQuery.recordset?.map(row => row.COLUMN_NAME) || [];
        }
    } catch (error) {
        console.error(`Error getting columns for ${endpoint}:`, error.message);
        return [];
    }
}

async function compareEndpoint(pgDb, mssqlDb, endpoint) {
    console.log(`\n=== ${endpoint.toUpperCase()} Comparison ===`);
    
    try {
        // Dynamically determine column order from both databases
        console.log(`🔍 Determining column structure for ${endpoint}...`);
        const pgColumns = await getColumnOrder(pgDb, endpoint, 'postgres');
        const mssqlColumns = await getColumnOrder(mssqlDb, endpoint, 'mssql');
        
        // Verify both databases have compatible columns
        if (pgColumns.length === 0 || mssqlColumns.length === 0) {
            console.log(`❌ Could not determine columns for ${endpoint}`);
            return { endpoint, status: 'column_detection_failed', identical: false };
        }
        
        console.log(`   PostgreSQL: ${pgColumns.length} columns`);
        console.log(`   MSSQL: ${mssqlColumns.length} columns`);
        
        // Check for column differences
        const pgColumnSet = new Set(pgColumns);
        const mssqlColumnSet = new Set(mssqlColumns);
        
        // Find columns in PostgreSQL but not in MSSQL
        const missingInMssql = pgColumns.filter(col => !mssqlColumnSet.has(col));
        // Find columns in MSSQL but not in PostgreSQL
        const extraInMssql = mssqlColumns.filter(col => !pgColumnSet.has(col));
        
        if (missingInMssql.length > 0) {
            console.log(`⚠️  Columns in PostgreSQL but missing in MSSQL: ${missingInMssql.join(', ')}`);
        }
        if (extraInMssql.length > 0) {
            console.log(`⚠️  Extra columns in MSSQL not in PostgreSQL: ${extraInMssql.join(', ')}`);
        }
        
        // Query PostgreSQL materialized view with SELECT * (ALL rows)
        console.log(`📊 Querying PostgreSQL oneroster12.${endpoint} materialized view (ALL rows)...`);
        const pgResultsRaw = await pgDb.raw(`SELECT * FROM oneroster12.${endpoint}`);
        const pgResults = pgResultsRaw.rows || [];
        
        // Query MSSQL table with SELECT * (ALL rows)
        console.log(`📊 Querying MSSQL oneroster12.${endpoint} table (ALL rows)...`);
        const mssqlResultsRaw = await mssqlDb.raw(`SELECT * FROM oneroster12.${endpoint}`);
        // Handle MSSQL result structure - it might be an array directly or nested
        let mssqlResults = [];
        if (Array.isArray(mssqlResultsRaw)) {
            mssqlResults = mssqlResultsRaw;
        } else if (mssqlResultsRaw[0] && Array.isArray(mssqlResultsRaw[0])) {
            mssqlResults = mssqlResultsRaw[0];
        } else if (mssqlResultsRaw.recordset) {
            mssqlResults = mssqlResultsRaw.recordset;
        } else if (mssqlResultsRaw.rows) {
            mssqlResults = mssqlResultsRaw.rows;
        }
        
        console.log(`PostgreSQL returned ${pgResults.length} rows`);
        console.log(`MSSQL returned ${mssqlResults.length} rows`);
        
        if (pgResults.length === 0 && mssqlResults.length === 0) {
            console.log(`⚠️  Both databases returned 0 rows for ${endpoint}`);
            return { 
                endpoint, 
                status: 'empty', 
                identical: missingInMssql.length === 0 && extraInMssql.length === 0,
                columnDifferences: {
                    missingInMssql,
                    extraInMssql
                }
            };
        }
        
        if (pgResults.length !== mssqlResults.length) {
            console.log(`❌ Row count mismatch for ${endpoint}!`);
            return { 
                endpoint, 
                status: 'count_mismatch', 
                identical: false,
                columnDifferences: {
                    missingInMssql,
                    extraInMssql
                }
            };
        }
        
        // Compare ALL rows but limit detailed logging
        const rowsToCompare = Math.min(pgResults.length, mssqlResults.length);
        let identical = true;
        let matchedRows = 0;
        let differences = [];
        
        for (let i = 0; i < rowsToCompare; i++) {
            const pgRow = pgResults[i];
            const mssqlRow = mssqlResults[i];
            
            // Field-by-field comparison (Option B)
            // Ignore sourcedId fields and any fields containing sourcedId references due to MD5 differences
            
            const ignoredFields = new Set([
                'sourcedId',
                'dateLastModified', // Always different due to refresh timing
                'sort_role_priority', 
                'sort_unique_id',
                'naturalKey_localEducationAgencyId',
                'naturalKey_localEducationAgency',  // Corrected field name
                'naturalKey_courseCode'
            ]);
            
            // Get all column names from PostgreSQL (authoritative structure)
            const pgColumns = Object.keys(pgRow);
            
            let rowIdentical = true;
            let fieldDifferences = [];
            
            // Only compare columns that exist in PostgreSQL (authoritative source)
            // Skip MSSQL-only columns like naturalKey_* and sort_* columns
            const pgColumnsOnly = pgColumns.filter(col => pgColumnSet.has(col));
            
            // Compare each field that exists in PostgreSQL
            for (const column of pgColumnsOnly) {
                if (ignoredFields.has(column)) {
                    continue; // Skip ignored fields
                }
                
                // Skip fields that contain sourcedId references
                if (column.toLowerCase().includes('sourceId') || column.toLowerCase().includes('sourcedid')) {
                    continue;
                }
                
                // Skip comparison if this column doesn't exist in MSSQL
                if (!mssqlColumnSet.has(column)) {
                    continue;
                }
                
                // Skip entire columns that contain sourcedId values in their JSON structures
                const pgValue = pgRow[column];
                const mssqlValue = mssqlRow[column];
                
                if (containsSourcedId(pgValue) || containsSourcedId(mssqlValue)) {
                    continue;
                }
                
                // Handle JSON fields specially
                if (typeof pgValue === 'object' && typeof mssqlValue === 'string') {
                    // Parse MSSQL JSON string for comparison
                    try {
                        const parsedMssqlValue = JSON.parse(mssqlValue);
                        
                        if (JSON.stringify(pgValue) !== JSON.stringify(parsedMssqlValue)) {
                            rowIdentical = false;
                            fieldDifferences.push({
                                field: column,
                                pgValue: pgValue,
                                mssqlValue: parsedMssqlValue,
                                type: 'json_content'
                            });
                        }
                    } catch (e) {
                        rowIdentical = false;
                        fieldDifferences.push({
                            field: column,
                            pgValue: pgValue,
                            mssqlValue: mssqlValue,
                            type: 'json_parse_error'
                        });
                    }
                } else if (typeof pgValue === 'string' && typeof mssqlValue === 'object') {
                    // Parse PostgreSQL JSON string for comparison
                    try {
                        const parsedPgValue = JSON.parse(pgValue);
                        if (JSON.stringify(parsedPgValue) !== JSON.stringify(mssqlValue)) {
                            rowIdentical = false;
                            fieldDifferences.push({
                                field: column,
                                pgValue: parsedPgValue,
                                mssqlValue: mssqlValue,
                                type: 'json_content'
                            });
                        }
                    } catch (e) {
                        rowIdentical = false;
                        fieldDifferences.push({
                            field: column,
                            pgValue: pgValue,
                            mssqlValue: mssqlValue,
                            type: 'json_parse_error'
                        });
                    }
                } else if (Array.isArray(pgValue) && typeof mssqlValue === 'string') {
                    // Handle array vs JSON string
                    try {
                        const parsedMssqlValue = JSON.parse(mssqlValue);
                        // Sort arrays for comparison if they contain objects with 'type' field
                        if (Array.isArray(parsedMssqlValue) && pgValue.length > 0 && pgValue[0].type) {
                            const pgSorted = [...pgValue].sort((a, b) => a.type.localeCompare(b.type));
                            const mssqlSorted = [...parsedMssqlValue].sort((a, b) => a.type.localeCompare(b.type));
                            if (JSON.stringify(pgSorted) !== JSON.stringify(mssqlSorted)) {
                                rowIdentical = false;
                                fieldDifferences.push({
                                    field: column,
                                    pgValue: pgValue,
                                    mssqlValue: parsedMssqlValue,
                                    type: 'array_content'
                                });
                            }
                        } else if (JSON.stringify(pgValue) !== JSON.stringify(parsedMssqlValue)) {
                            rowIdentical = false;
                            fieldDifferences.push({
                                field: column,
                                pgValue: pgValue,
                                mssqlValue: parsedMssqlValue,
                                type: 'array_content'
                            });
                        }
                    } catch (e) {
                        rowIdentical = false;
                        fieldDifferences.push({
                            field: column,
                            pgValue: pgValue,
                            mssqlValue: mssqlValue,
                            type: 'array_parse_error'
                        });
                    }
                } else {
                    // Direct comparison for primitive types
                    if (pgValue !== mssqlValue) {
                        // Handle null vs undefined
                        if ((pgValue === null && mssqlValue === undefined) || 
                            (pgValue === undefined && mssqlValue === null)) {
                            // Consider null and undefined as equivalent
                            continue;
                        }
                        
                        // Handle boolean vs string boolean - detect and report format differences
                        if ((pgValue === true && mssqlValue === 'true') ||
                            (pgValue === false && mssqlValue === 'false') ||
                            (pgValue === 'true' && mssqlValue === true) ||
                            (pgValue === 'false' && mssqlValue === false)) {
                            // Report as boolean format difference
                            rowIdentical = false;
                            fieldDifferences.push({
                                field: column,
                                pgValue: pgValue,
                                mssqlValue: mssqlValue,
                                type: 'boolean_format'
                            });
                            continue;
                        }
                        
                        rowIdentical = false;
                        fieldDifferences.push({
                            field: column,
                            pgValue: pgValue,
                            mssqlValue: mssqlValue,
                            type: 'value'
                        });
                    }
                }
            }
            
            // Create display keys for summary (use natural keys when possible)
            let pgKey, mssqlKey, pgTitle, mssqlTitle;
            
            // Extract natural identifier for display
            if (pgRow.identifier) {
                pgKey = `${pgRow.role || 'N/A'} | ${pgRow.identifier}`;
                mssqlKey = `${mssqlRow.role || 'N/A'} | ${mssqlRow.identifier}`;
            } else if (pgRow.courseCode) {
                pgKey = pgRow.courseCode;
                mssqlKey = mssqlRow.courseCode;
            } else if (pgRow.title) {
                pgKey = pgRow.title;
                mssqlKey = mssqlRow.title;
            } else {
                pgKey = pgRow.sourcedId?.substring(0, 8) || 'N/A';
                mssqlKey = mssqlRow.sourcedId?.substring(0, 8) || 'N/A';
            }
            
            pgTitle = pgRow.username || pgRow.title || pgRow.name || 'N/A';
            mssqlTitle = mssqlRow.username || mssqlRow.title || mssqlRow.name || 'N/A';
            
            if (rowIdentical) {
                matchedRows++;
            } else {
                identical = false;
                differences.push({
                    row: i + 1,
                    rowIndex: i,
                    pgKey,
                    mssqlKey,
                    pgTitle,
                    mssqlTitle,
                    pgRow: pgResults[i],
                    mssqlRow: mssqlResults[i],
                    fieldDifferences: fieldDifferences
                });
            }
        }
        
        // Show summary
        console.log(`\n📊 Comparison summary:`);
        console.log(`   ✅ Matched: ${matchedRows}/${rowsToCompare} rows`);
        if (differences.length > 0) {
            console.log(`   ❌ Differences: ${differences.length}/${rowsToCompare} rows`);
            
            // Show detailed differences for any endpoint with differences <= 50, or first few for users/classes
            if (differences.length > 0 && (differences.length <= 50 || endpoint === 'users' || endpoint === 'classes')) {
                const maxDetailedDifferences = endpoint === 'users' ? 10 : endpoint === 'classes' ? 5 : differences.length;
                console.log(`\n🔍 DETAILED ${endpoint.toUpperCase()} DIFFERENCES (${differences.length} total${endpoint === 'users' || endpoint === 'classes' ? `, showing first ${maxDetailedDifferences}` : ''}):`);
                differences.slice(0, maxDetailedDifferences).forEach((diff, idx) => {
                    console.log(`\n--- Difference ${idx + 1} ---`);
                    console.log(`Row ${diff.rowIndex + 1}: ${diff.pgKey}`);
                    
                    if (diff.fieldDifferences && diff.fieldDifferences.length > 0) {
                        console.log(`Field-level differences (${diff.fieldDifferences.length} fields):`);
                        diff.fieldDifferences.forEach(fieldDiff => {
                            console.log(`\n  📝 ${fieldDiff.field} (${fieldDiff.type}):`);
                            console.log(`    PostgreSQL: ${JSON.stringify(fieldDiff.pgValue)}`);
                            console.log(`    MSSQL:      ${JSON.stringify(fieldDiff.mssqlValue)}`);
                        });
                        
                        // Show entire rows for context
                        console.log(`\n🔍 Complete Row Data:`);
                        console.log(`\n  PostgreSQL (entire row):`);
                        console.log(`    ${JSON.stringify(diff.pgRow, null, 4)}`);
                        console.log(`\n  MSSQL (entire row):`);
                        console.log(`    ${JSON.stringify(diff.mssqlRow, null, 4)}`);
                    } else {
                        // Fallback for legacy format
                        console.log(`PostgreSQL:`, JSON.stringify(diff.pgRow, null, 2));
                        console.log(`MSSQL:`, JSON.stringify(diff.mssqlRow, null, 2));
                    }
                });
            }
        }
        
        // Determine if data is identical (column differences are informational only)
        const hasColumnDifferences = missingInMssql.length > 0 || extraInMssql.length > 0;
        
        if (identical) {
            console.log(`🎉 ${endpoint}: All ${rowsToCompare} rows are IDENTICAL across both databases!`);
            return { 
                endpoint, 
                status: 'success', 
                identical: true, 
                totalCompared: rowsToCompare,
                differences: 0,
                columnDifferences: {
                    missingInMssql,
                    extraInMssql
                }
            };
        } else {
            // Count boolean format differences
            const booleanFormatDiffs = differences.reduce((count, diff) => {
                return count + (diff.fieldDifferences?.filter(fd => fd.type === 'boolean_format').length || 0);
            }, 0);
            
            console.log(`💥 ${endpoint}: Found ${differences.length} differences in ${rowsToCompare} total rows!`);
            if (booleanFormatDiffs > 0) {
                console.log(`⚠️  ${endpoint}: ${booleanFormatDiffs} boolean format differences detected (OneRoster spec requires string "true"/"false")`);
            }
            
            return { 
                endpoint, 
                status: 'different', 
                identical: false,
                totalCompared: rowsToCompare,
                differences: differences.length,
                booleanFormatDiffs: booleanFormatDiffs,
                sampleDifferences: differences.slice(0, 3), // First 3 differences for summary
                columnDifferences: {
                    missingInMssql,
                    extraInMssql
                }
            };
        }
        
    } catch (error) {
        console.error(`❌ Error comparing ${endpoint}:`, error.message);
        return { endpoint, status: 'error', identical: false, error: error.message };
    }
}

async function main() {
    console.log('🔍 OneRoster Database Comparison Starting...');
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
        const endpoints = ['classes', 'courses', 'academicsessions', 'enrollments', 'demographics', 'users', 'orgs'];
        
        for (const endpoint of endpoints) {
            const result = await compareEndpoint(pgDb, mssqlDb, endpoint);
            results.push(result);
        }
        
        // Summary report
        console.log('\n' + '='.repeat(60));
        console.log('📊 DATA COMPARISON SUMMARY');
        console.log('='.repeat(60));
        
        const successful = results.filter(r => r.identical);
        const failed = results.filter(r => !r.identical);
        
        console.log(`✅ Data identical endpoints: ${successful.length}/${results.length}`);
        if (successful.length > 0) {
            successful.forEach(r => console.log(`   ✅ ${r.endpoint} (${r.totalCompared || 'unknown'} rows compared)`));
        }
        
        console.log(`❌ Data different endpoints: ${failed.length}/${results.length}`);
        if (failed.length > 0) {
            failed.forEach(r => {
                if (r.status === 'error' || r.status === 'column_detection_failed') {
                    console.log(`   ❌ ${r.endpoint} (${r.status})`);
                } else {
                    console.log(`   ❌ ${r.endpoint} (${r.differences}/${r.totalCompared} rows differ)`);
                }
            });
        }
        
        // Additional column structure report
        console.log('\n📋 COLUMN STRUCTURE REPORT');
        console.log('='.repeat(60));
        
        const endpointsWithColumnDiffs = results.filter(r => 
            r.columnDifferences && 
            (r.columnDifferences.missingInMssql?.length > 0 || r.columnDifferences.extraInMssql?.length > 0)
        );
        
        if (endpointsWithColumnDiffs.length === 0) {
            console.log('✅ All endpoints have matching column structures');
        } else {
            console.log(`⚠️  ${endpointsWithColumnDiffs.length} endpoints have column differences:`);
            endpointsWithColumnDiffs.forEach(r => {
                console.log(`\n   ${r.endpoint}:`);
                if (r.columnDifferences.missingInMssql?.length > 0) {
                    console.log(`      PostgreSQL columns missing in MSSQL: ${r.columnDifferences.missingInMssql.join(', ')}`);
                }
                if (r.columnDifferences.extraInMssql?.length > 0) {
                    console.log(`      Extra MSSQL columns not in PostgreSQL: ${r.columnDifferences.extraInMssql.join(', ')}`);
                }
            });
        }
        
        if (failed.length === 0) {
            console.log('\n🎉 ALL DATA MATCHES! PostgreSQL and MSSQL data content is identical.');
            if (endpointsWithColumnDiffs.length > 0) {
                console.log('📋 Note: Column structure differences exist but are informational only.');
            }
        } else {
            console.log('\n💥 DATA DIFFERENCES FOUND! Manual investigation needed.');
            console.log(`   ${failed.length} endpoint(s) have data content differences.`);
            if (endpointsWithColumnDiffs.length > 0) {
                console.log('📋 Note: Column structure differences also exist (informational only).');
            }
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