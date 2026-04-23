#!/usr/bin/env node

/**
 * MSSQL OneRoster Schema Deployment Script
 *
 * Executes SQL files in order to deploy OneRoster 1.2 schema.
 * Includes prerequisite checking and automatic data refresh.
 * Supports both Ed-Fi Data Standard 4 and 5.
 *
 * Usage:
 *   node standard/deploy-mssql.js [ds4|ds5]
 *   node standard/deploy-mssql.js ds4    # Deploy to DS4 database
 *   node standard/deploy-mssql.js ds5    # Deploy to DS5 database (default)
 *   node standard/deploy-mssql.js        # Deploy to DS5 database (default)
 */

import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments for data standard
const args = process.argv.slice(2);
let dataStandard = 'ds5'; // default

// Parse arguments: first arg might be data standard (ds4/ds5)
if (args.length > 0) {
    if (args[0] === 'ds4' || args[0] === 'ds5') {
        dataStandard = args[0];
    } else {
        console.error(`❌ Invalid data standard: ${args[0]}`);
        console.log('Usage: node standard/deploy-mssql.js [ds4|ds5]');
        console.log('Examples:');
        console.log('  node standard/deploy-mssql.js ds4    # Deploy to DS4 database');
        console.log('  node standard/deploy-mssql.js ds5    # Deploy to DS5 database (default)');
        console.log('  node standard/deploy-mssql.js        # Deploy to DS5 database (default)');
        process.exit(1);
    }
}

// Load environment from .env.deploy in the same folder as this script
const envPath = path.join(__dirname, '.env.deploy');
if (!fs.existsSync(envPath)) {
    console.error('❌ Could not load .env.deploy — file not found.');
    console.error('Copy standard/.env.deploy.example to standard/.env.deploy and fill in your values.');
    process.exit(1);
}
dotenv.config({ path: envPath });

// Connection config
const config = {
    server: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    port: parseInt(process.env.DB_PORT) || 1433,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true
    },
    requestTimeout: 120000
};

function versionBasedDirectory(ds) {
    if (ds === 'ds4') {
        return path.join(__dirname, './4.0.0/artifacts/mssql');
    } else {
        return path.join(__dirname, './5.2.0/artifacts/mssql');
    }
}

// Build SQL file list dynamically from folder structure, maintaining order by numeric prefixes
function getSqlFilesInOrder(ds) {
    let baseDir, coreDir, jobsDir;
    baseDir = versionBasedDirectory(ds);
    coreDir = path.join(baseDir, 'core');
    jobsDir = path.join(baseDir, 'orchestration');

    const readSqlFiles = (dir, subdir) => {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(f => f.toLowerCase().endsWith('.sql'))
            .map(f => ({
                fullPath: path.join(dir, f),
                relPath: path.join(subdir, f).replace(/\\/g, '/'),
                name: f
            }));
    };

    const parsePrefix = (fileName) => {
        const m = /^([0-9]+)[-_]/.exec(fileName);
        return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
    };

    const coreFiles = readSqlFiles(coreDir, 'core');
    const jobFiles = readSqlFiles(jobsDir, 'orchestration');

    // Sort by numeric prefix; files without prefix go to the end
    const sortedCore = coreFiles.sort((a, b) => {
        const pa = parsePrefix(a.name);
        const pb = parsePrefix(b.name);
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
    });
    const sortedJobs = jobFiles.sort((a, b) => {
        const pa = parsePrefix(a.name);
        const pb = parsePrefix(b.name);
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
    });

    // Return relative paths for execution: core scripts first, then orchestration scripts
    return [...sortedCore.map(x => x.relPath), ...sortedJobs.map(x => x.relPath)];
}

const sqlFiles = getSqlFilesInOrder(dataStandard);

async function executeSQLFile(pool, filename) {
    var baseDir = versionBasedDirectory(dataStandard);
    const filePath = path.join(baseDir, filename);

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
    const refreshProcess = spawn('node', [path.join(__dirname, 'refresh-data-mssql.js'), dataStandard], {
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
            console.log('Executing file:', path.basename(filename));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    deploy();
}

export { deploy };
