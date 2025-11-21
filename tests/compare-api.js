#!/usr/bin/env node

/**
 * Compare OneRoster API endpoint results between PostgreSQL and MSSQL implementations
 * to verify they return identical data sets
 * 
 * Usage:
 *   node compare-api.js                   # Test all endpoints with DS5 (default)
 *   node compare-api.js ds4                # Test all endpoints with DS4
 *   node compare-api.js ds5                # Test all endpoints with DS5
 *   node compare-api.js ds4 orgs          # Test /orgs endpoint with DS4
 *   node compare-api.js orgs              # Test /orgs endpoint with DS5 (default)
 *   node compare-api.js students          # Test only /students endpoint with DS5
 *   node compare-api.js teachers          # Test only /teachers endpoint with DS5
 *   node compare-api.js parents           # Test only /parents endpoint with DS5
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

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

// Configure API bases based on data standard and environment
const LOCAL_POSTGRES_PORT = parseInt(process.env.PORT) || (dataStandard === 'ds4' ? 3002 : 3000);
const LOCAL_MSSQL_PORT = dataStandard === 'ds4' ? 3003 : 3001;

const LOCAL_POSTGRES_BASE = `http://localhost:${LOCAL_POSTGRES_PORT}`;
const LOCAL_MSSQL_BASE = `http://localhost:${LOCAL_MSSQL_PORT}`;

// Local OAuth credentials from environment
const LOCAL_ISSUER_BASE_URL = process.env.OAUTH2_ISSUERBASEURL;
const LOCAL_AUDIENCE = process.env.OAUTH2_AUDIENCE;
const LOCAL_CLIENT_ID = process.env.OAUTH2_CLIENT_ID;
const LOCAL_CLIENT_SECRET = process.env.OAUTH2_CLIENT_SECRET;

// Remote OAuth credentials (based on actual remote service config)
const REMOTE_ISSUER_BASE_URL = 'https://dev-5n8uf6ov.us.auth0.com/';
const REMOTE_AUDIENCE = 'https://oneroster.touchdownllc.com';
const REMOTE_CLIENT_ID = 'eYtxXFUzHYs7jERVMw7MhPuq2kzLdIal';
const REMOTE_CLIENT_SECRET = 'TH3gUITMEfo6RUN8k7MdjlX3ao807OybHK0cZd3B1Z9DbsPuQmwkkyGlih0YmADt';

// Endpoint configurations
const ENDPOINTS = {
    orgs: {
        path: '/ims/oneroster/rostering/v1p2/orgs',
        responseProperty: 'orgs',
        name: 'organizations'
    },
    students: {
        path: '/ims/oneroster/rostering/v1p2/students?limit=100',
        responseProperty: 'users',
        name: 'students'
    },
    teachers: {
        path: '/ims/oneroster/rostering/v1p2/teachers?limit=100',
        responseProperty: 'users',
        name: 'teachers'
    },
    parents: {
        path: '/ims/oneroster/rostering/v1p2/users?role=parent&limit=100',
        responseProperty: 'users',
        name: 'parents'
    },
    courses: {
        path: '/ims/oneroster/rostering/v1p2/courses?limit=100',
        responseProperty: 'courses',
        name: 'courses'
    },
    classes: {
        path: '/ims/oneroster/rostering/v1p2/classes',
        responseProperty: 'classes',
        name: 'classes'
    },
    demographics: {
        path: '/ims/oneroster/rostering/v1p2/demographics?limit=100',
        responseProperty: 'demographics',
        name: 'demographics'
    },
    academicSessions: {
        path: '/ims/oneroster/rostering/v1p2/academicSessions',
        responseProperty: 'academicsessions',
        name: 'academic sessions'
    },
    enrollments: {
        path: '/ims/oneroster/rostering/v1p2/enrollments?limit=100',
        responseProperty: 'enrollments',
        name: 'enrollments'
    }
};

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const requestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            // Allow self-signed certificates for testing
            rejectUnauthorized: false
        };

        const req = httpModule.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: res.statusMessage, json: () => jsonData });
                } catch (e) {
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: res.statusMessage, text: data });
                }
            });
        });

        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

// async function getLocalAccessToken() {
//     if (!LOCAL_ISSUER_BASE_URL || !LOCAL_AUDIENCE || !LOCAL_CLIENT_ID || !LOCAL_CLIENT_SECRET) {
//         throw new Error('Missing local OAuth2 configuration');
//     }

//     const tokenUrl = `${LOCAL_ISSUER_BASE_URL}oauth/token`;
//     const params = `grant_type=client_credentials&client_id=${encodeURIComponent(LOCAL_CLIENT_ID)}&client_secret=${encodeURIComponent(LOCAL_CLIENT_SECRET)}&audience=${encodeURIComponent(LOCAL_AUDIENCE)}`;

//     const response = await httpRequest(tokenUrl, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/x-www-form-urlencoded',
//         },
//         body: params
//     });

//     if (!response.ok) {
//         throw new Error(`Failed to get local token: ${response.status} ${response.statusText}`);
//     }

//     const data = response.json();
//     return data.access_token;
// }

// async function getRemoteAccessToken() {
//     const tokenUrl = `${REMOTE_ISSUER_BASE_URL}oauth/token`;
//     const params = `grant_type=client_credentials&client_id=${encodeURIComponent(REMOTE_CLIENT_ID)}&client_secret=${encodeURIComponent(REMOTE_CLIENT_SECRET)}&audience=${encodeURIComponent(REMOTE_AUDIENCE)}`;

//     const response = await httpRequest(tokenUrl, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/x-www-form-urlencoded',
//         },
//         body: params
//     });

//     if (!response.ok) {
//         throw new Error(`Failed to get remote token: ${response.status} ${response.statusText}`);
//     }

//     const data = response.json();
//     return data.access_token;
// }

async function fetchEndpoint(baseUrl, endpointConfig, accessToken, skipAuth = false) {
    const endpointUrl = `${baseUrl}${endpointConfig.path}`;
    
    const headers = {
        'Accept': 'application/json'
    };
    
    if (!skipAuth && accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const response = await httpRequest(endpointUrl, {
        headers: headers
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch ${endpointConfig.path} from ${baseUrl}: ${response.status} ${response.statusText}`);
    }

    const data = response.json();
    return {
        rawResponse: data,
        items: data[endpointConfig.responseProperty] || []
    };
}

function hasSourcedIdValue(obj) {
    if (obj === null || obj === undefined) return false;
    
    if (typeof obj === 'string') {
        // Check if the string itself looks like a sourcedId (MD5-like hash)
        return /^[a-f0-9]{32}$/i.test(obj) || obj.includes('sourcedId') || obj.includes('href');
    }
    
    if (Array.isArray(obj)) {
        return obj.some(item => hasSourcedIdValue(item));
    }
    
    if (typeof obj === 'object') {
        return Object.values(obj).some(value => hasSourcedIdValue(value));
    }
    
    return false;
}

function removeSourcedIdFields(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => removeSourcedIdFields(item));
    }
    
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        // Skip fields that are sourcedId, href, or dateLastModified
        if (key === 'sourcedId' || key === 'href' || key === 'dateLastModified') {
            continue;
        }
        
        // Skip entire key-value pair if value contains sourcedId references
        if (hasSourcedIdValue(value)) {
            continue;
        }
        
        // Keep the value as-is (no recursive processing)
        cleaned[key] = value;
    }
    
    return cleaned;
}

function normalizeForComparison(response, responseProperty) {
    // Deep clone the response
    const normalized = JSON.parse(JSON.stringify(response));
    
    // Remove sourcedId fields and values from each item in the array
    if (normalized[responseProperty] && Array.isArray(normalized[responseProperty])) {
        normalized[responseProperty] = normalized[responseProperty].map(item => removeSourcedIdFields(item));
    }
    
    return normalized;
}

function deepDiff(obj1, obj2, path = '') {
    const differences = [];
    
    // Handle null/undefined cases
    if (obj1 === null || obj1 === undefined || obj2 === null || obj2 === undefined) {
        if (obj1 !== obj2) {
            differences.push({
                path: path || 'root',
                type: 'value',
                pg: obj1,
                mssql: obj2
            });
        }
        return differences;
    }
    
    // Handle primitive types
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') {
        if (obj1 !== obj2) {
            differences.push({
                path: path || 'root',
                type: 'value',
                pg: obj1,
                mssql: obj2
            });
        }
        return differences;
    }
    
    // Handle arrays
    if (Array.isArray(obj1) || Array.isArray(obj2)) {
        if (!Array.isArray(obj1) || !Array.isArray(obj2)) {
            differences.push({
                path: path || 'root',
                type: 'type',
                pg: Array.isArray(obj1) ? 'array' : typeof obj1,
                mssql: Array.isArray(obj2) ? 'array' : typeof obj2
            });
            return differences;
        }
        
        if (obj1.length !== obj2.length) {
            differences.push({
                path: path || 'root',
                type: 'length',
                pg: obj1.length,
                mssql: obj2.length
            });
        }
        
        const maxLength = Math.max(obj1.length, obj2.length);
        for (let i = 0; i < maxLength; i++) {
            const newPath = path ? `${path}[${i}]` : `[${i}]`;
            const itemDiffs = deepDiff(obj1[i], obj2[i], newPath);
            differences.push(...itemDiffs);
        }
        
        return differences;
    }
    
    // Handle objects
    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
    
    for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;
        
        if (!(key in obj1)) {
            differences.push({
                path: newPath,
                type: 'missing_in_pg',
                pg: undefined,
                mssql: obj2[key]
            });
        } else if (!(key in obj2)) {
            differences.push({
                path: newPath,
                type: 'missing_in_mssql',
                pg: obj1[key],
                mssql: undefined
            });
        } else {
            const keyDiffs = deepDiff(obj1[key], obj2[key], newPath);
            differences.push(...keyDiffs);
        }
    }
    
    return differences;
}

function formatDifference(diff) {
    const typeIcons = {
        'value': '🔄',
        'type': '⚠️',
        'length': '📏',
        'missing_in_pg': '➕',
        'missing_in_mssql': '➖'
    };
    
    const icon = typeIcons[diff.type] || '❓';
    
    switch (diff.type) {
        case 'value':
            return `${icon} ${diff.path}: "${diff.pg}" → "${diff.mssql}"`;
        case 'type':
            return `${icon} ${diff.path}: type mismatch (${diff.pg} vs ${diff.mssql})`;
        case 'length':
            return `${icon} ${diff.path}: length mismatch (${diff.pg} vs ${diff.mssql})`;
        case 'missing_in_pg':
            return `${icon} ${diff.path}: missing in PostgreSQL (MSSQL has: "${diff.mssql}")`;
        case 'missing_in_mssql':
            return `${icon} ${diff.path}: missing in MSSQL (PostgreSQL has: "${diff.pg}")`;
        default:
            return `${icon} ${diff.path}: unknown difference type`;
    }
}


function compareResponses(localPgResponse, localMssqlResponse, endpointConfig) {
    console.log(`\n=== Response Envelope Comparison ===`);
    
    const responseProperty = endpointConfig.responseProperty;
    
    // First check if both have the same structure
    const pgHasProperty = localPgResponse.hasOwnProperty(responseProperty);
    const mssqlHasProperty = localMssqlResponse.hasOwnProperty(responseProperty);
    
    if (!pgHasProperty || !mssqlHasProperty) {
        console.log(`❌ Response structure mismatch!`);
        console.log(`PostgreSQL has '${responseProperty}' property: ${pgHasProperty}`);
        console.log(`MSSQL has '${responseProperty}' property: ${mssqlHasProperty}`);
        return false;
    }
    
    console.log(`Local PostgreSQL: ${localPgResponse[responseProperty].length} ${endpointConfig.name}`);
    console.log(`Local MSSQL: ${localMssqlResponse[responseProperty].length} ${endpointConfig.name}`);
    
    // Show sample raw response row for visual identification when counts match
    if (localPgResponse[responseProperty].length > 0 && 
        localMssqlResponse[responseProperty].length > 0 && 
        localPgResponse[responseProperty].length === localMssqlResponse[responseProperty].length) {
        console.log(`\n📋 Sample raw response row for visual identification:`);
        console.log(`🐘 PostgreSQL sample:`);
        console.log(JSON.stringify(localPgResponse[responseProperty][0], null, 2));
        console.log(`🔷 MSSQL sample:`);
        console.log(JSON.stringify(localMssqlResponse[responseProperty][0], null, 2));
    }
    
    // Normalize responses by removing sourcedId fields for all endpoints
    const normalizedPg = normalizeForComparison(localPgResponse, responseProperty);
    const normalizedMssql = normalizeForComparison(localMssqlResponse, responseProperty);
    
    // Compare the normalized response objects
    const localPgJson = JSON.stringify(normalizedPg, null, 2);
    const localMssqlJson = JSON.stringify(normalizedMssql, null, 2);
    
    if (localPgJson === localMssqlJson) {
        console.log(`\n🎉 ${endpointConfig.name}: All ${localPgResponse[responseProperty].length} rows are IDENTICAL!`);
        return true;
    } else {
        console.log(`\n❌ FAILURE: Response envelopes differ!`);
        
        // Enhanced difference analysis
        const differences = deepDiff(normalizedPg, normalizedMssql);
        
        if (differences.length > 0) {
            console.log(`\n=== Detailed Difference Analysis ===`);
            console.log(`Found ${differences.length} difference(s):\n`);
            
            // Group differences by type for better readability
            const diffsByType = {};
            differences.forEach(diff => {
                if (!diffsByType[diff.type]) {
                    diffsByType[diff.type] = [];
                }
                diffsByType[diff.type].push(diff);
            });
            
            // Display differences grouped by type
            Object.entries(diffsByType).forEach(([type, diffs]) => {
                console.log(`${type.toUpperCase().replace(/_/g, ' ')} (${diffs.length}):`);
                diffs.slice(0, 10).forEach(diff => { // Limit to first 10 per type
                    console.log(`  ${formatDifference(diff)}`);
                });
                if (diffs.length > 10) {
                    console.log(`  ... and ${diffs.length - 10} more ${type} differences`);
                }
                console.log('');
            });
        }
        
        // Show detailed differences for each item (using normalized data) - but limit output
        if (normalizedPg[responseProperty].length === normalizedMssql[responseProperty].length) {
            console.log(`=== Item-by-Item Comparison (first 3 differences) ===`);
            let shownDiffs = 0;
            let firstFailedItem = null;
            
            for (let i = 0; i < normalizedPg[responseProperty].length && shownDiffs < 3; i++) {
                const pgItem = normalizedPg[responseProperty][i];
                const mssqlItem = normalizedMssql[responseProperty][i];
                
                if (JSON.stringify(pgItem) !== JSON.stringify(mssqlItem)) {
                    // Capture the first failed item for detailed output
                    if (firstFailedItem === null) {
                        firstFailedItem = { index: i, pg: pgItem, mssql: mssqlItem };
                    }
                    
                    console.log(`\n❌ ${endpointConfig.name} at index ${i} differs:`);
                    
                    // Show item-level differences
                    const itemDiffs = deepDiff(pgItem, mssqlItem);
                    if (itemDiffs.length <= 5) {
                        // Show detailed diff if few differences
                        itemDiffs.forEach(diff => {
                            console.log(`  ${formatDifference(diff)}`);
                        });
                    } else {
                        // Show summary if many differences
                        console.log(`  ${itemDiffs.length} differences found in this item`);
                        console.log(`  PostgreSQL sourcedId: ${pgItem.sourcedId || 'unknown'}`);
                        console.log(`  MSSQL sourcedId: ${mssqlItem.sourcedId || 'unknown'}`);
                    }
                    shownDiffs++;
                }
            }
            
            const totalDifferentItems = normalizedPg[responseProperty].filter((pgItem, i) => 
                JSON.stringify(pgItem) !== JSON.stringify(normalizedMssql[responseProperty][i])
            ).length;
            
            if (totalDifferentItems > shownDiffs) {
                console.log(`\n... and ${totalDifferentItems - shownDiffs} more items with differences`);
            }
            
            // Show complete payload of first failed item for detailed analysis
            if (firstFailedItem !== null) {
                console.log(`\n=== Complete Payload of First Failed Item (index ${firstFailedItem.index}) ===`);
                console.log(`\n🐘 PostgreSQL payload:`);
                console.log(JSON.stringify(firstFailedItem.pg, null, 2));
                console.log(`\n🔷 MSSQL payload:`);
                console.log(JSON.stringify(firstFailedItem.mssql, null, 2));
            }
        }
        
        return false;
    }
}

async function testEndpoint(endpointKey, endpointConfig) {
    console.log(`🔍 Comparing /${endpointKey} endpoint between PostgreSQL and MSSQL...\n`);
    
    try {
        // Ensure tests/data directory exists
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log('📁 Created tests/data directory');
        }
        
        // Skip authentication for local testing
        console.log(`📊 Fetching ${endpointConfig.name} from local sources (auth disabled)...`);
        const [localPgResponse, localMssqlResponse] = await Promise.all([
            fetchEndpoint(LOCAL_POSTGRES_BASE, endpointConfig, null, true),  // skipAuth = true
            fetchEndpoint(LOCAL_MSSQL_BASE, endpointConfig, null, true)      // skipAuth = true
        ]);
        console.log(`✅ ${endpointConfig.name} fetched from local sources`);
        
        // Save complete envelope responses to tests/data directory with DS version in filename
        fs.writeFileSync(path.join(dataDir, `${dataStandard}-postgres-${endpointKey}.json`), JSON.stringify(localPgResponse.rawResponse, null, 2));
        fs.writeFileSync(path.join(dataDir, `${dataStandard}-mssql-${endpointKey}.json`), JSON.stringify(localMssqlResponse.rawResponse, null, 2));
        console.log(`💾 Complete envelope responses saved to tests/data/${dataStandard}-*-${endpointKey}.json files`);
        
        // Compare the full response envelopes
        const identical = compareResponses(localPgResponse.rawResponse, localMssqlResponse.rawResponse, endpointConfig);
        
        return {
            endpoint: endpointKey,
            success: identical,
            pgCount: localPgResponse.rawResponse[endpointConfig.responseProperty]?.length || 0,
            mssqlCount: localMssqlResponse.rawResponse[endpointConfig.responseProperty]?.length || 0
        };
        
    } catch (error) {
        console.error(`❌ Error testing ${endpointKey}:`, error.message);
        return {
            endpoint: endpointKey,
            success: false,
            error: error.message
        };
    }
}

async function main() {
    // targetEndpoint already parsed above in the global scope
    
    if (targetEndpoint && !ENDPOINTS[targetEndpoint]) {
        console.error(`❌ Unknown endpoint: ${targetEndpoint}`);
        console.log(`Available endpoints: ${Object.keys(ENDPOINTS).join(', ')}`);
        console.log(`\nUsage examples:`);
        console.log(`  node compare-api.js                   # Test all endpoints with DS5 (default)`);
        console.log(`  node compare-api.js ds4                # Test all endpoints with DS4`);
        console.log(`  node compare-api.js ds4 orgs          # Test /orgs endpoint with DS4`);
        console.log(`  node compare-api.js orgs              # Test /orgs endpoint with DS5`);
        process.exit(1);
    }
    
    const endpointsToTest = targetEndpoint 
        ? { [targetEndpoint]: ENDPOINTS[targetEndpoint] }
        : ENDPOINTS;
    
    console.log(`🚀 Starting API comparison tests...`);
    console.log(`📊 Data Standard: ${dataStandard.toUpperCase()}`);
    console.log(`📋 Testing ${Object.keys(endpointsToTest).length} endpoint(s): ${Object.keys(endpointsToTest).join(', ')}`);
    console.log(`🔌 API Ports - PostgreSQL: ${LOCAL_POSTGRES_PORT}, MSSQL: ${LOCAL_MSSQL_PORT}\n`);
    
    const results = [];
    
    for (const [endpointKey, endpointConfig] of Object.entries(endpointsToTest)) {
        const result = await testEndpoint(endpointKey, endpointConfig);
        results.push(result);
        console.log(''); // Add spacing between tests
    }
    
    // Summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful: ${successful.length}/${results.length}`);
    console.log(`❌ Failed: ${failed.length}/${results.length}\n`);
    
    if (successful.length > 0) {
        console.log('✅ Passing endpoints:');
        successful.forEach(r => {
            console.log(`   ${r.endpoint} (PostgreSQL: ${r.pgCount}, MSSQL: ${r.mssqlCount})`);
        });
        console.log('');
    }
    
    if (failed.length > 0) {
        console.log('❌ Failing endpoints:');
        failed.forEach(r => {
            if (r.error) {
                console.log(`   ${r.endpoint}: ${r.error}`);
            } else {
                console.log(`   ${r.endpoint} (PostgreSQL: ${r.pgCount}, MSSQL: ${r.mssqlCount})`);
            }
        });
        console.log('');
    }
    
    if (failed.length === 0) {
        console.log('🎉 SUCCESS: All endpoints return identical response envelopes!');
        process.exit(0);
    } else {
        console.log('💥 FAILURE: Some endpoints differ between PostgreSQL and MSSQL!');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main, testEndpoint, ENDPOINTS };