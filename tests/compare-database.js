#!/usr/bin/env node

/**
 * OneRoster Database Comparison Script
 * Compare PostgreSQL materialized views vs MSSQL tables in oneroster12 schema
 * Direct database-to-database data parity validation
 */

// Parse command line arguments for data standard
const args = process.argv.slice(2);
let dataStandard = 'ds5'; // default
let targetEndpoint = null;

// Parse arguments: first arg might be data standard (ds4/ds5) or endpoint
if (args.length > 0) {
    if (args[0] === 'ds4' || args[0] === 'ds5') {
        dataStandard = args[0];
        targetEndpoint = args[1]; // endpoint is second arg if data standard specified
    } else {
        // First arg is endpoint, use default DS5
        targetEndpoint = args[0];
    }
}

// Load appropriate environment files based on data standard
if (dataStandard === 'ds4') {
    console.log('🔧 Using Ed-Fi Data Standard 4 configuration');
    require('dotenv').config({ path: '.env.ds4.postgres' }); // DS4 PostgreSQL config
    require('dotenv').config({ path: '.env.ds4.mssql', override: false }); // DS4 MSSQL config (don't override PG vars)
} else {
    console.log('🔧 Using Ed-Fi Data Standard 5 configuration (default)');
    require('dotenv').config({ path: '.env.postgres' }); // DS5 PostgreSQL config  
    require('dotenv').config({ path: '.env.mssql', override: false }); // DS5 MSSQL config (don't override PG vars)
}
const knex = require('knex');

// Function to get database configurations based on data standard
function getDatabaseConfigs(dataStandard) {
    // PostgreSQL connection - configuration varies by data standard
    const pgConfig = {
        client: 'pg',
        connection: {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || (dataStandard === 'ds4' ? 5435 : 5434),
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            ssl: process.env.DB_SSL === 'true'
        }
    };

    // MSSQL connection - configuration varies by data standard
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
    
    return { pgConfig, mssqlConfig };
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
        
        // Query PostgreSQL materialized view with SELECT * (ALL rows) ordered by sourcedId
        console.log(`📊 Querying PostgreSQL oneroster12.${endpoint} materialized view (ALL rows)...`);
        const pgResultsRaw = await pgDb.raw(`SELECT * FROM oneroster12.${endpoint} ORDER BY "sourcedId"`);
        const pgResults = pgResultsRaw.rows || [];
        
        // Query MSSQL table with SELECT * (ALL rows) ordered by sourcedId
        console.log(`📊 Querying MSSQL oneroster12.${endpoint} table (ALL rows)...`);
        const mssqlResultsRaw = await mssqlDb.raw(`SELECT * FROM oneroster12.${endpoint} ORDER BY sourcedId`);
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
        
        // Sort both result sets by sourcedId for consistent comparison
        console.log(`🔄 Sorting both result sets by sourcedId for consistent comparison...`);
        pgResults.sort((a, b) => (a.sourcedId || '').localeCompare(b.sourcedId || ''));
        mssqlResults.sort((a, b) => (a.sourcedId || '').localeCompare(b.sourcedId || ''));
        
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
                
                const pgValue = pgRow[column];
                const mssqlValue = mssqlRow[column];
                
                // Handle JSON fields specially - check arrays first since arrays are objects in JS
                if (Array.isArray(pgValue) && typeof mssqlValue === 'string') {
                    // Handle array vs JSON string
                    try {
                        const parsedMssqlValue = JSON.parse(mssqlValue);
                        // Sort arrays for comparison if they contain objects with sourcedId field
                        if (Array.isArray(parsedMssqlValue) && pgValue.length > 0 && (pgValue[0].sourcedId || pgValue[0].type)) {
                            const sortKey = pgValue[0].sourcedId ? 'sourcedId' : 'type';
                            const pgSorted = [...pgValue].sort((a, b) => (a[sortKey] || '').localeCompare(b[sortKey] || ''));
                            const mssqlSorted = [...parsedMssqlValue].sort((a, b) => (a[sortKey] || '').localeCompare(b[sortKey] || ''));
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
                            type: 'json_parse_error'
                        });
                    }
                } else if (typeof pgValue === 'object' && typeof mssqlValue === 'string') {
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
            
            // Create display keys for summary using sourcedId
            const pgKey = pgRow.sourcedId?.substring(0, 8) || 'N/A';
            const mssqlKey = mssqlRow.sourcedId?.substring(0, 8) || 'N/A';
            
            const pgTitle = pgRow.username || pgRow.title || pgRow.name || 'N/A';
            const mssqlTitle = mssqlRow.username || mssqlRow.title || mssqlRow.name || 'N/A';
            
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
            
            // Show detailed differences for any endpoint with differences <= 50, or first few for users/classes/enrollments
            if (differences.length > 0 && (differences.length <= 50 || endpoint === 'users' || endpoint === 'classes' || endpoint === 'enrollments')) {
                const maxDetailedDifferences = endpoint === 'users' ? 3 : endpoint === 'classes' ? 3 : endpoint === 'enrollments' ? 3 : differences.length;
                console.log(`\n🔍 DETAILED ${endpoint.toUpperCase()} DIFFERENCES (${differences.length} total${endpoint === 'users' || endpoint === 'classes' || endpoint === 'enrollments' ? `, showing first ${maxDetailedDifferences}` : ''}):`);
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
    console.log(`📊 Data Standard: ${dataStandard.toUpperCase()}`);
    console.log('Comparing PostgreSQL materialized views vs MSSQL tables');
    console.log('');
    
    let pgDb, mssqlDb;
    const results = [];
    
    try {
        // Get database configurations for the selected data standard
        const { pgConfig, mssqlConfig } = getDatabaseConfigs(dataStandard);
        
        // Connect to both databases
        console.log('🔌 Establishing database connections...');
        pgDb = knex(pgConfig);
        mssqlDb = knex(mssqlConfig);
        
        // Test connections and get database versions
        console.log('🧪 Testing connections and retrieving database info...');
        
        // Get PostgreSQL version and verify correct database
        const pgVersionResult = await pgDb.raw(`
            SELECT version() as version, 
                   current_database() as database,
                   current_user as user,
                   inet_server_addr() as server_addr,
                   inet_server_port() as server_port
        `);
        const pgVersion = pgVersionResult.rows[0].version.split(' ')[1];
        
        // Get MSSQL version and verify correct database
        const mssqlVersionResult = await mssqlDb.raw(`
            SELECT 
                SERVERPROPERTY('ProductVersion') as version,
                DB_NAME() as db_name,
                CURRENT_USER as [user],
                @@SERVERNAME as server_name
        `);
        const mssqlVersion = mssqlVersionResult[0].version;
        
        // Detect Ed-Fi Data Standard versions
        
        // For PostgreSQL - check DeployJournal in public schema
        let pgEdFiVersion = 'Unknown';
        try {
            // Check if DeployJournal exists in public schema
            const pgDeployJournalExists = await pgDb.raw(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name = 'DeployJournal'
                ) as table_exists
            `);
            
            if (pgDeployJournalExists.rows[0].table_exists) {
                // Look for version indicators in DeployJournal
                const versionScript = await pgDb.raw(`
                    SELECT scriptname 
                    FROM public."DeployJournal" 
                    WHERE scriptname LIKE '%Standard.4.%' OR scriptname LIKE '%Standard.5.%'
                    ORDER BY scriptname
                    LIMIT 1
                `);
                
                if (versionScript.rows && versionScript.rows.length > 0) {
                    const scriptName = versionScript.rows[0].scriptname;
                    // Extract full version number (e.g., 4.0.0 or 5.2.0)
                    const versionMatch = scriptName.match(/Standard\.(\d+\.\d+\.\d+)\./);
                    if (versionMatch) {
                        pgEdFiVersion = `Data Standard ${versionMatch[1]}`;
                    } else if (scriptName.includes('Standard.4.')) {
                        pgEdFiVersion = 'Data Standard 4.x';
                    } else if (scriptName.includes('Standard.5.')) {
                        pgEdFiVersion = 'Data Standard 5.x';
                    }
                }
            }
            
            // Fallback: check for Contact vs Parent table if DeployJournal doesn't exist
            if (pgEdFiVersion === 'Unknown') {
                const pgContactCheck = await pgDb.raw(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_schema = 'edfi' AND table_name = 'contact'
                    ) as has_contact
                `);
                const pgParentCheck = await pgDb.raw(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_schema = 'edfi' AND table_name = 'parent'
                    ) as has_parent
                `);
                
                if (pgContactCheck.rows[0].has_contact === true) {
                    pgEdFiVersion = 'Data Standard 5.x';
                } else if (pgParentCheck.rows[0].has_parent === true) {
                    pgEdFiVersion = 'Data Standard 4.x';
                }
            }
        } catch (e) {
            // Ignore errors in version detection
        }
        
        // For MSSQL - check DeployJournal table
        let mssqlEdFiVersion = 'Unknown';
        try {
            // Check if DeployJournal exists
            const deployJournalExists = await mssqlDb.raw(`
                SELECT OBJECT_ID('dbo.DeployJournal', 'U') as table_exists
            `);
            
            if (deployJournalExists[0].table_exists) {
                // Look for version indicators in DeployJournal
                const versionScript = await mssqlDb.raw(`
                    SELECT TOP 1 ScriptName 
                    FROM dbo.DeployJournal 
                    WHERE ScriptName LIKE '%Standard.4.0.0%' OR ScriptName LIKE '%Standard.5.%'
                    ORDER BY ScriptName
                `);
                
                if (versionScript.length > 0) {
                    const scriptName = versionScript[0].ScriptName;
                    // Extract full version number (e.g., 4.0.0 or 5.2.0)
                    const versionMatch = scriptName.match(/Standard\.(\d+\.\d+\.\d+)\./);
                    if (versionMatch) {
                        mssqlEdFiVersion = `Data Standard ${versionMatch[1]}`;
                    } else if (scriptName.includes('Standard.4.')) {
                        mssqlEdFiVersion = 'Data Standard 4.x';
                    } else if (scriptName.includes('Standard.5.')) {
                        mssqlEdFiVersion = 'Data Standard 5.x';
                    }
                }
            }
            
            // Fallback: check for Contact vs Parent table if DeployJournal doesn't exist
            if (mssqlEdFiVersion === 'Unknown') {
                const mssqlContactCheck = await mssqlDb.raw(`
                    SELECT OBJECT_ID('edfi.Contact', 'U') as has_contact
                `);
                const mssqlParentCheck = await mssqlDb.raw(`
                    SELECT OBJECT_ID('edfi.Parent', 'U') as has_parent  
                `);
                
                if (mssqlContactCheck[0].has_contact) {
                    mssqlEdFiVersion = 'Data Standard 5.x';
                } else if (mssqlParentCheck[0].has_parent) {
                    mssqlEdFiVersion = 'Data Standard 4.x';
                }
            }
        } catch (e) {
            // Ignore errors in version detection
        }
        
        // Display connection details with detected Ed-Fi versions
        console.log('');
        console.log('📌 Database Connection Details:');
        console.log('');
        console.log('PostgreSQL:');
        console.log(`  Host: ${pgConfig.connection.host}:${pgConfig.connection.port}`);
        console.log(`  Database: ${pgConfig.connection.database}`);
        console.log(`  User: ${pgConfig.connection.user}`);
        console.log(`  DB Version: PostgreSQL ${pgVersion}`);
        console.log(`  Ed-Fi Version: ${pgEdFiVersion}`);
        console.log('');
        console.log('MSSQL:');
        console.log(`  Server: ${mssqlConfig.connection.server}`);
        console.log(`  Database: ${mssqlConfig.connection.database}`);
        console.log(`  User: ${mssqlConfig.connection.user}`);
        console.log(`  DB Version: SQL Server ${mssqlVersion}`);
        console.log(`  Ed-Fi Version: ${mssqlEdFiVersion}`);
        console.log('');
        
        // Warn if there's a version mismatch
        const expectedDS = dataStandard === 'ds4' ? '4' : '5';
        if (pgEdFiVersion !== 'Unknown' && !pgEdFiVersion.includes(`Standard ${expectedDS}`)) {
            console.log(`⚠️  WARNING: PostgreSQL database contains Data Standard ${pgEdFiVersion} but script is configured for DS${expectedDS}`);
        }
        if (mssqlEdFiVersion !== 'Unknown' && !mssqlEdFiVersion.includes(`Standard ${expectedDS}`)) {
            console.log(`⚠️  WARNING: MSSQL database contains Data Standard ${mssqlEdFiVersion} but script is configured for DS${expectedDS}`);
        }
        if ((pgEdFiVersion !== 'Unknown' && mssqlEdFiVersion !== 'Unknown') && pgEdFiVersion !== mssqlEdFiVersion) {
            console.log(`⚠️  WARNING: Version mismatch between databases - PostgreSQL: ${pgEdFiVersion}, MSSQL: ${mssqlEdFiVersion}`);
        }
        console.log('');
        
        // Configure endpoints based on parsed arguments
        let endpoints;
        
        if (targetEndpoint) {
            const allEndpoints = ['classes', 'courses', 'academicsessions', 'enrollments', 'demographics', 'users', 'orgs'];
            if (allEndpoints.includes(targetEndpoint)) {
                endpoints = [targetEndpoint];
                console.log(`🎯 Testing single endpoint: ${targetEndpoint} (${dataStandard.toUpperCase()})`);
            } else {
                console.error(`❌ Invalid endpoint: ${targetEndpoint}`);
                console.log(`Valid endpoints: ${allEndpoints.join(', ')}`);
                console.log(`Usage: node compare-database.js [ds4|ds5] [endpoint]`);
                console.log(`Examples:`);
                console.log(`  node compare-database.js ds4 users    # Test users endpoint with DS4`);
                console.log(`  node compare-database.js ds5          # Test all endpoints with DS5`);
                console.log(`  node compare-database.js users        # Test users endpoint with DS5 (default)`);
                process.exit(1);
            }
        } else {
            endpoints = ['classes', 'courses', 'academicsessions', 'enrollments', 'demographics', 'users', 'orgs'];
            console.log(`🔄 Testing all endpoints (${dataStandard.toUpperCase()})`);
        }
        
        // Compare each endpoint
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