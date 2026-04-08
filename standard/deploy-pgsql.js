#!/usr/bin/env node

/**
 * PostgreSQL OneRoster Schema Deployment Script
 *
 * Executes SQL files in order to deploy OneRoster 1.2 schema artifacts
 * for PostgreSQL-backed Ed-Fi ODS instances. Mirrors the interface of the
 * MSSQL deployment script and supports Data Standard 4 and 5 environments.
 *
 * Usage:
 *   node standard/deploy-pgsql.js [ds4|ds5]
 *   node standard/deploy-pgsql.js ds4    # Deploy to DS4 database
 *   node standard/deploy-pgsql.js ds5    # Deploy to DS5 database (default)
 *   node standard/deploy-pgsql.js        # Deploy to DS5 database (default)
 */

import { Pool } from 'pg';
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

if (args.length > 0) {
    if (args[0] === 'ds4' || args[0] === 'ds5') {
        dataStandard = args[0];
    } else {
        console.error(`❌ Invalid data standard: ${args[0]}`);
        console.log('Usage: node standard/deploy-pgsql.js [ds4|ds5]');
        console.log('Examples:');
        console.log('  node standard/deploy-pgsql.js ds4    # Deploy to DS4 database');
        console.log('  node standard/deploy-pgsql.js ds5    # Deploy to DS5 database (default)');
        console.log('  node standard/deploy-pgsql.js        # Deploy to DS5 database (default)');
        process.exit(1);
    }
}

const projectRoot = path.join(__dirname, '../');
const envFile = dataStandard === 'ds4' ? '.env.ds4.postgres' : '.env.postgres';
const envPath = path.join(projectRoot, envFile);

if (!fs.existsSync(envPath)) {
    console.error(`❌ Could not load ${envFile}. Please ensure it exists in the project root.`);
    process.exit(1);
}

dotenv.config({ path: envPath });

const pgConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT, 10) || 120000,
    application_name: 'oneroster-deploy'
};

function versionBasedDirectory(ds) {
    if (ds === 'ds4') {
        return path.join(__dirname, './4.0.0/artifacts/pgsql');
    }
    return path.join(__dirname, './5.2.0/artifacts/pgsql');
}

function getSqlFilesInOrder(ds) {
    const baseDir = versionBasedDirectory(ds);
    const folders = ['core', 'orchestration'];

    const parsePrefix = (fileName) => {
        const match = /^([0-9]+)[-_]/.exec(fileName);
        return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
    };

    const ordered = [];

    for (const folder of folders) {
        const dir = path.join(baseDir, folder);
        if (!fs.existsSync(dir)) continue;

        const files = fs.readdirSync(dir)
            .filter((f) => f.toLowerCase().endsWith('.sql'))
            .map((name) => ({
                relPath: path.join(folder, name).replace(/\\/g, '/'),
                name,
                prefix: parsePrefix(name)
            }))
            .sort((a, b) => {
                if (a.prefix !== b.prefix) return a.prefix - b.prefix;
                return a.name.localeCompare(b.name);
            });

        ordered.push(...files.map((file) => file.relPath));
    }

    return ordered;
}

const sqlFiles = getSqlFilesInOrder(dataStandard);

function getErrorContext(sqlText, position) {
    const pos = parseInt(position, 10);
    if (Number.isNaN(pos)) return null;

    const before = sqlText.slice(0, pos - 1);
    const line = before.split(/\r?\n/).length;
    const lines = sqlText.split(/\r?\n/);
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 2);

    const snippet = lines.slice(start, end)
        .map((text, idx) => {
            const lineNumber = start + idx + 1;
            const pointer = lineNumber === line ? '>' : ' ';
            return `${pointer} ${lineNumber.toString().padStart(4, ' ')} | ${text}`;
        })
        .join('\n');

    return { line, snippet };
}

async function executeSQLFile(pool, filename) {
    const baseDir = versionBasedDirectory(dataStandard);
    const fullPath = path.join(baseDir, filename);

    if (!fs.existsSync(fullPath)) {
        console.log(`❌ File not found: ${filename}`);
        return false;
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    try {
        console.log(`⚡ Executing ${filename}`);
        await pool.query(content);
        console.log(`✅ ${filename} completed`);
        return true;
    } catch (err) {
        console.log(`❌ ${filename} failed`);
        console.log(`   Error: ${err.message}`);
        if (err.position) {
            const context = getErrorContext(content, err.position);
            if (context) {
                console.log(`   At line ${context.line}:`);
                console.log(context.snippet.split('\n').map((line) => `   ${line}`).join('\n'));
            }
        }
        return false;
    }
}

async function checkPrerequisites(pool) {
    console.log('🔍 Checking prerequisites...\n');

    try {
        const versionResult = await pool.query('SHOW server_version_num');
        const versionStringResult = await pool.query('SHOW server_version');
        const versionNum = parseInt(versionResult.rows[0].server_version_num, 10);
        const versionLabel = versionStringResult.rows[0].server_version;

        console.log(`✅ PostgreSQL Version: ${versionLabel}`);
        if (versionNum < 130000) {
            throw new Error('PostgreSQL 13 or later is required for OneRoster materialized views.');
        }

        const dbResult = await pool.query('SELECT current_database() AS database, current_user AS user_name');
        console.log(`✅ Database: ${dbResult.rows[0].database}`);
        console.log(`✅ Connected as: ${dbResult.rows[0].user_name}`);

        const schemaResult = await pool.query("SELECT COUNT(*)::int AS count FROM information_schema.schemata WHERE schema_name = 'edfi'");
        if (schemaResult.rows[0].count > 0) {
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
    console.log('\n=== Data Population ===');
    const refreshScript = path.join(__dirname, 'refresh-data-pgsql.js');

    if (!fs.existsSync(refreshScript)) {
        console.log('ℹ️  No PostgreSQL refresh script found. Skipping automatic data refresh.');
        return true;
    }

    console.log('🔄 Running data refresh process...');
    const refreshProcess = spawn('node', [refreshScript, dataStandard], {
        stdio: 'inherit',
        cwd: process.cwd()
    });

    return new Promise((resolve) => {
        refreshProcess.on('close', (code) => {
            if (code === 0) {
                console.log('\n✅ Data population completed successfully!');
            } else {
                console.log('\n⚠️  Data population completed with warnings or errors.');
            }
            resolve(code === 0);
        });
        refreshProcess.on('error', (err) => {
            console.error('\n❌ Failed to run data refresh:', err.message);
            resolve(false);
        });
    });
}

async function deploy() {
    console.log('========================================');
    console.log('OneRoster 1.2 PostgreSQL Deployment');
    console.log('========================================');
    console.log(`📊 Data Standard: ${dataStandard.toUpperCase()}`);
    console.log(`Target Server: ${pgConfig.host}:${pgConfig.port}`);
    console.log(`Target Database: ${pgConfig.database}`);
    console.log(`User: ${pgConfig.user}`);
    console.log(`Deployment Time: ${new Date().toISOString()}`);
    console.log('========================================\n');

    if (!sqlFiles.length) {
        console.error('❌ No SQL files were found to execute.');
        process.exit(1);
    }

    const pool = new Pool(pgConfig);

    try {
        console.log('🔌 Connecting to PostgreSQL...');
        await pool.query('SELECT 1');
        console.log('✅ Connected successfully\n');

        await checkPrerequisites(pool);

        let successCount = 0;
        let failCount = 0;

        for (const filename of sqlFiles) {
            const success = await executeSQLFile(pool, filename);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
        }

        await pool.end();

        if (failCount === 0) {
            await runDataRefresh();
        }

        console.log('\n========================================');
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
        await pool.end();
        console.error('\n❌ DEPLOYMENT FAILED!');
        console.error('Error:', err.message);
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    deploy();
}

export { deploy };
