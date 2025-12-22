#!/usr/bin/env node

/**
 * MSSQL OneRoster Schema Deployment Script
 *
 * Executes SQL files in order to deploy OneRoster 1.2 schema.
 * Includes prerequisite checking and automatic data refresh.
 * Supports both Ed-Fi Data Standard 4 and 5.
 *
 * Usage:
 *   node sql/mssql/deploy-mssql.js [ds4|ds5]
 *   node sql/mssql/deploy-mssql.js ds4    # Deploy to DS4 database
 *   node sql/mssql/deploy-mssql.js ds5    # Deploy to DS5 database (default)
 *   node sql/mssql/deploy-mssql.js        # Deploy to DS5 database (default)
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Parse command line arguments for data standard
const args = process.argv.slice(2);
let dataStandard = 'ds5'; // default

// Parse arguments: first arg might be data standard (ds4/ds5)
if (args.length > 0) {
    if (args[0] === 'ds4' || args[0] === 'ds5') {
        dataStandard = args[0];
    } else {
        console.error(`❌ Invalid data standard: ${args[0]}`);
        console.log('Usage: node sql/mssql/deploy-mssql.js [ds4|ds5]');
        console.log('Examples:');
        console.log('  node sql/mssql/deploy-mssql.js ds4    # Deploy to DS4 database');
        console.log('  node sql/mssql/deploy-mssql.js ds5    # Deploy to DS5 database (default)');
        console.log('  node sql/mssql/deploy-mssql.js        # Deploy to DS5 database (default)');
        process.exit(1);
    }
}

// Load appropriate environment files based on data standard
const projectRoot = path.join(__dirname, '../..');

if (dataStandard === 'ds4') {
    console.log('🔧 Using Ed-Fi Data Standard 4 configuration');
    try {
        require('dotenv').config({ path: path.join(projectRoot, '.env.ds4.mssql') });
    } catch (err) {
        console.error('❌ Could not load .env.ds4.mssql file');
        console.error('Please ensure .env.ds4.mssql exists in project root');
        process.exit(1);
    }
} else {
    console.log('🔧 Using Ed-Fi Data Standard 5 configuration (default)');
    try {
        require('dotenv').config({ path: path.join(projectRoot, '.env.mssql') });
    } catch (err) {
        console.error('❌ Could not load .env.mssql file');
        console.error('Please ensure .env.mssql exists in project root');
        process.exit(1);
    }
}

// Connection config
const config = {
    server: process.env.MSSQL_SERVER || 'localhost',
    database: process.env.MSSQL_DATABASE,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    port: parseInt(process.env.MSSQL_PORT) || 1433,
    options: {
        encrypt: process.env.MSSQL_ENCRYPT === 'true',
        trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true
    },
    requestTimeout: 120000
};

// Build SQL file list dynamically from folder structure, maintaining order by numeric prefixes
function getSqlFilesInOrder(ds) {
    const commonDir = path.join(__dirname, 'core');
    const dsFolderName = ds === 'ds4' ? 'ds4' : 'ds5';
    const dsDir = path.join(__dirname, dsFolderName);
    const jobsDir = path.join(__dirname, 'orchestration');

    const readSqlFiles = (dir) => {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(f => f.toLowerCase().endsWith('.sql'))
            .map(f => ({
                fullPath: path.join(dir, f),
                relPath: path.join(path.basename(dir), f).replace(/\\/g, '/'),
                name: f
            }));
    };

    const parsePrefix = (fileName) => {
        const m = /^([0-9]+)[-_]/.exec(fileName);
        return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
    };

    const commonFiles = readSqlFiles(commonDir);
    const dsFiles = readSqlFiles(dsDir);
    const jobFiles = readSqlFiles(jobsDir);

    // Combine and sort by numeric prefix; files without prefix go to the end
    const combined = [...commonFiles, ...dsFiles].sort((a, b) => {
        const pa = parsePrefix(a.name);
        const pb = parsePrefix(b.name);
        if (pa !== pb) return pa - pb;
        // Tie-breaker: common before ds, then by name
        const aIsCommon = a.relPath.startsWith('common/');
        const bIsCommon = b.relPath.startsWith('common/');
        if (aIsCommon !== bIsCommon) return aIsCommon ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    // Sort job files by numeric prefix as well
    const sortedJobFiles = jobFiles.sort((a, b) => {
        const pa = parsePrefix(a.name);
        const pb = parsePrefix(b.name);
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
    });

    // Extract relative paths for execution: main scripts first, then job scripts last
    return [...combined.map(x => x.relPath), ...sortedJobFiles.map(x => x.relPath)];
}

const sqlFiles = getSqlFilesInOrder(dataStandard);

async function executeSQLFile(pool, filename) {
    const filePath = path.join(__dirname, filename);

    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filename}`);
        return false;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Split on GO statements
        const batches = content
            .split(/^\s*GO\s*$/gmi)
            .map(batch => batch.trim())
            .filter(batch => batch.length > 5);

        console.log(`⚡ Executing ${filename} (${batches.length} batches)`);

        let batchNum = 0;
        for (const batch of batches) {
            batchNum++;
            try {
                await pool.request().query(batch);
            } catch (batchErr) {
                console.log(`\n❌ ${filename} failed in batch ${batchNum}/${batches.length}`);
                console.log(`   Error: ${batchErr.message}`);

                // Show context around the error
                if (batchErr.lineNumber && batchErr.procName) {
                    console.log(`   Location: Line ${batchErr.lineNumber} in ${batchErr.procName}`);
                }

                // Show a snippet of the failing batch
                const batchLines = batch.split('\n');
                if (batchLines.length <= 10) {
                    console.log(`\n   Failing SQL (full batch):\n   ${batchLines.join('\n   ')}`);
                } else {
                    const preview = batchLines.slice(0, 5);
                    console.log(`\n   Failing SQL (first 5 lines of batch):\n   ${preview.join('\n   ')}`);
                    console.log(`   ... (${batchLines.length - 5} more lines)`);
                }
                throw batchErr;
            }
        }

        console.log(`✅ ${filename} completed`);
        return true;

    } catch (err) {
        // Error already logged in the batch loop
        return false;
    }
}

async function checkPrerequisites(pool) {
    console.log('🔍 Checking prerequisites...\n');

    try {
        // Check SQL Server version (need 2016+ for JSON support)
        const versionResult = await pool.request().query(`
            SELECT
                SERVERPROPERTY('ProductMajorVersion') as MajorVersion,
                @@VERSION as VersionString,
                DB_NAME() as DatabaseName
        `);

        const majorVersion = versionResult.recordset[0].MajorVersion;
        const versionString = versionResult.recordset[0].VersionString;
        const databaseName = versionResult.recordset[0].DatabaseName;

        console.log(`✅ Database: ${databaseName}`);
        console.log(`✅ SQL Server Version: ${majorVersion} (${versionString.split('\\n')[0]})`);

        if (majorVersion < 13) {
            throw new Error(`SQL Server 2016 or later is required for JSON support. Current version: ${majorVersion}`);
        }

        // Check if this looks like an Ed-Fi database
        const edfiCheck = await pool.request().query(`
            SELECT COUNT(*) as SchemaCount
            FROM sys.schemas
            WHERE name = 'edfi'
        `);

        if (edfiCheck.recordset[0].SchemaCount > 0) {
            console.log('✅ Ed-Fi schema detected');
        } else {
            console.log('⚠️  WARNING: No "edfi" schema found. Ensure this is an Ed-Fi ODS database.');
        }

        console.log('');

    } catch (err) {
        console.error('❌ Prerequisites check failed:', err.message);
        throw err;
    }
}

async function runDataRefresh() {
    console.log('\\n=== Data Population ===');
    console.log('🔄 Running data refresh process...');

    // Run the refresh script in a separate process, passing the data standard
    const refreshProcess = spawn('node', [path.join(__dirname, 'refresh-data.js'), dataStandard], {
        stdio: 'inherit',
        cwd: process.cwd()
    });

    return new Promise((resolve) => {
        refreshProcess.on('close', (code) => {
            if (code === 0) {
                console.log('\\n✅ Data population completed successfully!');
            } else {
                console.log('\\n⚠️  Data population completed with warnings or errors.');
            }
            resolve(code === 0);
        });
        refreshProcess.on('error', (err) => {
            console.error('\\n❌ Failed to run data refresh:', err.message);
            resolve(false);
        });
    });
}

async function deploy() {
    console.log('========================================');
    console.log('OneRoster 1.2 MSSQL Deployment');
    console.log('========================================');
    console.log(`📊 Data Standard: ${dataStandard.toUpperCase()}`);
    console.log(`Target Server: ${config.server}`);
    console.log(`Target Database: ${config.database}`);
    console.log(`User: ${config.user}`);
    console.log(`Deployment Time: ${new Date().toISOString()}`);
    console.log('========================================\\n');

    try {
        console.log('🔌 Connecting to SQL Server...');
        const pool = await sql.connect(config);
        console.log('✅ Connected successfully\\n');

        // Check prerequisites
        await checkPrerequisites(pool);

        let successCount = 0;
        let failCount = 0;

        for (const filename of sqlFiles) {
            console.log('Executing file:', filename);
            const success = await executeSQLFile(pool, filename);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
        }

        await pool.close();

        if (failCount === 0) {
            // Run data refresh if deployment was successful
            let refreshSuccess = await runDataRefresh();

            if (refreshSuccess) {
                console.log('\\n✅ Data refresh completed successfully!');
            }
        }

        console.log('\\n========================================');
        if (failCount === 0) {
            console.log('🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!');
        } else {
            console.log(`⚠️  DEPLOYMENT COMPLETED WITH WARNINGS (${failCount} files had errors)`);
        }
        console.log(`📊 Files: ${successCount} successful, ${failCount} failed`);
        console.log('');
        console.log('🧪 Test deployment with:');
        console.log(`node tests/compare-database.js ${dataStandard}  # Test data parity`);
        console.log('========================================');

        process.exit(failCount === 0 ? 0 : 1);

    } catch (err) {
        console.error('\\n❌ DEPLOYMENT FAILED!');
        console.error('Error:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    deploy();
}

module.exports = { deploy };
