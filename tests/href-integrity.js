#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * OneRoster Resource href Integrity Test
 *
 * Verifies that JSON link columns (class, school, user, course, org, terms, parent, etc.)
 * in the oneroster12 schema contain href values whose embedded sourcedId actually exists
 * in the target resource table.
 *
 * Usage:
 *   node tests/href-integrity.js
 *
 * Connection is configured via tests/.env.href-test  (copy from tests/.env.href-test.example).
 * Supports both PostgreSQL (DB_CLIENT=pg) and MSSQL (DB_CLIENT=mssql).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.href-test from the tests/ directory
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.href-test') });

const knex = require('knex');

// ─── Configuration ────────────────────────────────────────────────────────────

const DB_CLIENT = process.env.DB_CLIENT || 'pg'; // 'pg' or 'mssql'
const SAMPLE_LIMIT = parseInt(process.env.SAMPLE_LIMIT) || 200; // rows to sample per table

function buildKnexConfig() {
    if (DB_CLIENT === 'pg') {
        return {
            client: 'pg',
            connection: {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 5432,
                database: process.env.DB_NAME,
                user: process.env.DB_USER,
                password: process.env.DB_PASS,
                ssl: process.env.DB_SSL === 'true'
            }
        };
    }

    // MSSQL
    return {
        client: 'mssql',
        connection: {
            server: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 1433,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            options: {
                encrypt: process.env.DB_ENCRYPT === 'true',
                trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
            }
        }
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a JSON field that may already be an object (PostgreSQL) or a string (MSSQL).
 */
function parseJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
}

/**
 * Extract the sourcedId embedded inside an href string: /resource/SOURCEDID
 */
function sourcedIdFromHref(href) {
    if (!href || typeof href !== 'string') return null;
    const parts = href.split('/');
    return parts[parts.length - 1] || null;
}

/**
 * Fetch all sourcedId values (up to SAMPLE_LIMIT) from a table as a Set.
 */
async function fetchSourcedIds(db, table) {
    const rows = await db('oneroster12.' + table)
        .select('sourcedId')
        .limit(SAMPLE_LIMIT * 10); // wider net so referenced IDs are likely present

    return new Set(rows.map(r => r.sourcedId ?? r.sourcedid));
}

// ─── Individual link checkers ─────────────────────────────────────────────────

/**
 * Test one JSON link column on a table.
 *
 * @param {object} db           - Knex instance
 * @param {string} sourceTable  - oneroster12 table name
 * @param {string} jsonColumn   - column name holding the JSON link (or array of links)
 * @param {string} targetTable  - oneroster12 table the href should resolve into
 * @param {boolean} isArray     - true when the column holds a JSON array of link objects
 * @returns {object} result summary
 */
async function checkHrefColumn(db, sourceTable, jsonColumn, targetTable, isArray = false) {
    const label = `${sourceTable}.${jsonColumn} → ${targetTable}`;

    // Sample rows that have the column populated
    let query = db('oneroster12.' + sourceTable)
        .select('sourcedId', jsonColumn)
        .whereNotNull(jsonColumn)
        .limit(SAMPLE_LIMIT);

    // Knex column names must be quoted for mixed-case PostgreSQL columns
    const rows = await query;

    if (rows.length === 0) {
        return { label, status: 'SKIP', detail: 'no rows with this column populated' };
    }

    const targetIds = await fetchSourcedIds(db, targetTable);

    let checked = 0;
    const broken = [];

    for (const row of rows) {
        const raw = row[jsonColumn] ?? row[jsonColumn.toLowerCase()];
        const parsed = parseJson(raw);
        if (!parsed) continue;

        const links = isArray ? (Array.isArray(parsed) ? parsed : [parsed]) : [parsed];

        for (const link of links) {
            if (!link || typeof link !== 'object') continue;
            const href = link.href;
            const linkedId = sourcedIdFromHref(href);
            checked++;

            if (!linkedId) {
                broken.push({ sourceId: row.sourcedId ?? row.sourcedid, href, reason: 'no sourcedId in href' });
                continue;
            }

            // Also verify the sourcedId field embedded in the link object matches the href
            const embeddedId = link.sourcedId ?? link.sourcedid;
            if (embeddedId && embeddedId !== linkedId) {
                broken.push({
                    sourceId: row.sourcedId ?? row.sourcedid,
                    href,
                    reason: `href sourcedId (${linkedId}) ≠ link.sourcedId (${embeddedId})`
                });
                continue;
            }

            if (!targetIds.has(linkedId)) {
                broken.push({ sourceId: row.sourcedId ?? row.sourcedid, href, reason: 'target record not found' });
            }
        }
    }

    if (broken.length === 0) {
        return { label, status: 'PASS', checked };
    }
    return { label, status: 'FAIL', checked, broken: broken.slice(0, 10) }; // cap output
}

// ─── Test definitions ─────────────────────────────────────────────────────────

/**
 * All href link relationships across oneroster12 resources.
 * Each entry: [sourceTable, jsonColumn, targetTable, isArray]
 */
const HREF_CHECKS = [
    // enrollments
    ['enrollments', 'class',   'classes',          false],
    ['enrollments', 'user',    'users',             false],
    ['enrollments', 'school',  'orgs',              false],

    // classes
    ['classes',     'course',  'courses',           false],
    ['classes',     'school',  'orgs',              false],
    ['classes',     'terms',   'academicsessions',  true],  // array

    // courses
    ['courses',     'org',        'orgs',             false],
    ['courses',     'schoolYear', 'academicsessions', false],

    // academicSessions — term sessions link up to their parent school-year session
    ['academicsessions', 'parent', 'academicsessions', false],

    // orgs — school links to parent LEA, LEA links to parent SEA
    ['orgs', 'parent', 'orgs', false],

    // users — org links are nested inside roles[].org (not a top-level column)
    // Handled separately by checkUsersRolesOrgs() below.
];

/**
 * Special check: users.roles[*].org → orgs
 * The `roles` column holds a JSON array of role objects; each role has an `org`
 * sub-object with `href` and `sourcedId`.
 */
async function checkUsersRolesOrgs(db) {
    const label = 'users.roles[].org → orgs';

    const rows = await db('oneroster12.users')
        .select('sourcedId', 'roles')
        .whereNotNull('roles')
        .limit(SAMPLE_LIMIT);

    if (rows.length === 0) {
        return { label, status: 'SKIP', detail: 'no rows with roles populated' };
    }

    const targetIds = await fetchSourcedIds(db, 'orgs');
    let checked = 0;
    const broken = [];

    for (const row of rows) {
        const roles = parseJson(row.roles ?? row.Roles);
        if (!Array.isArray(roles)) continue;
        for (const role of roles) {
            if (!role || typeof role !== 'object') continue;
            const org = role.org;
            if (!org || typeof org !== 'object') continue;
            const href = org.href;
            const linkedId = sourcedIdFromHref(href);
            checked++;

            if (!linkedId) {
                broken.push({ sourceId: row.sourcedId ?? row.sourcedid, href, reason: 'no sourcedId in href' });
                continue;
            }
            const embeddedId = org.sourcedId ?? org.sourcedid;
            if (embeddedId && embeddedId !== linkedId) {
                broken.push({ sourceId: row.sourcedId ?? row.sourcedid, href,
                    reason: `href sourcedId (${linkedId}) ≠ org.sourcedId (${embeddedId})` });
                continue;
            }
            if (!targetIds.has(linkedId)) {
                broken.push({ sourceId: row.sourcedId ?? row.sourcedid, href, reason: 'target record not found' });
            }
        }
    }

    if (broken.length === 0) return { label, status: 'PASS', checked };
    return { label, status: 'FAIL', checked, broken: broken.slice(0, 10) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const db = knex(buildKnexConfig());

    console.log(`\nOneRoster href Integrity Test`);
    console.log(`DB engine : ${DB_CLIENT}`);
    console.log(`DB host   : ${process.env.DB_HOST}`);
    console.log(`DB name   : ${process.env.DB_NAME}`);
    console.log(`Sample cap: ${SAMPLE_LIMIT} rows per table\n`);
    console.log('─'.repeat(70));

    const results = [];
    let passed = 0, failed = 0, skipped = 0;

    // Add the nested roles[].org check after the standard checks
    const allChecks = [
        ...HREF_CHECKS.map(([s, c, t, a]) => ({ type: 'standard', args: [s, c, t, a] })),
        { type: 'usersRolesOrgs' }
    ];

    for (const check of allChecks) {
    if (check.type === 'usersRolesOrgs') {
        process.stdout.write(`Checking users.roles[].org → orgs ... `);
        try {
            const result = await checkUsersRolesOrgs(db);
            results.push(result);
            if (result.status === 'PASS') { passed++; console.log(`PASS  (${result.checked} links checked)`); }
            else if (result.status === 'FAIL') { failed++; console.log(`FAIL  (${result.broken.length} broken out of ${result.checked} checked)`); for (const b of result.broken) console.log(`  source=${b.sourceId}  href=${b.href}  reason=${b.reason}`); }
            else { skipped++; console.log(`SKIP  (${result.detail})`); }
        } catch (err) { failed++; console.log(`ERROR  ${err.message}`); }
        continue;
    }
    const [sourceTable, jsonColumn, targetTable, isArray] = check.args;
        process.stdout.write(`Checking ${sourceTable}.${jsonColumn} → ${targetTable} ... `);
        try {
            const result = await checkHrefColumn(db, sourceTable, jsonColumn, targetTable, isArray);
            results.push(result);

            if (result.status === 'PASS') {
                passed++;
                console.log(`PASS  (${result.checked} links checked)`);
            } else if (result.status === 'FAIL') {
                failed++;
                console.log(`FAIL  (${result.broken.length} broken out of ${result.checked} checked)`);
                for (const b of result.broken) {
                    console.log(`source=${b.sourceId}  href=${b.href}  reason=${b.reason}`);
                }
            } else {
                skipped++;
                console.log(`SKIP  (${result.detail})`);
            }
        } catch (err) {
            failed++;
            console.log(`ERROR  ${err.message}`);
            results.push({ label: `${sourceTable}.${jsonColumn} → ${targetTable}`, status: 'ERROR', error: err.message });
        }
    } // end for allChecks

    console.log('\n' + '─'.repeat(70));
    console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('─'.repeat(70) + '\n');

    await db.destroy();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
