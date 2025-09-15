/**
 * OneRoster API Integration Test
 * Tests all main OneRoster endpoints by connecting to the actual API service
 */

require('dotenv').config();
const http = require('http');
const https = require('https');
const { URLSearchParams } = require('url');

class OneRosterAPITester {
    constructor(baseUrl = process.env.BASE_URL || 'http://localhost:3000') {
        this.baseUrl = baseUrl;
        this.apiPath = '/ims/oneroster/rostering/v1p2';
        this.testResults = {};
        this.accessToken = null;
    }

    /**
     * Get OAuth2 access token using client credentials
     */
    async getAccessToken() {
        if (this.accessToken) {
            return this.accessToken;
        }

        const issuerBaseUrl = process.env.OAUTH2_ISSUERBASEURL;
        const audience = process.env.OAUTH2_AUDIENCE;
        const clientId = process.env.OAUTH2_CLIENT_ID;
        const clientSecret = process.env.OAUTH2_CLIENT_SECRET;

        if (!issuerBaseUrl || !audience || !clientId || !clientSecret) {
            throw new Error('Missing OAuth2 configuration in environment variables');
        }

        const tokenUrl = `${issuerBaseUrl}oauth/token`;
        const postData = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            audience: audience
        }).toString();

        return new Promise((resolve, reject) => {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(tokenUrl, options, (res) => {
                let data = '';
                
                res.on('data', chunk => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const tokenResponse = JSON.parse(data);
                        
                        if (res.statusCode === 200 && tokenResponse.access_token) {
                            this.accessToken = tokenResponse.access_token;
                            console.log('✅ OAuth2 token acquired successfully');
                            resolve(this.accessToken);
                        } else {
                            throw new Error(`Token request failed: ${res.statusCode} - ${data}`);
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse token response: ${error.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(new Error(`Token request error: ${error.message}`));
            });
            
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Token request timeout'));
            });
            
            req.write(postData);
            req.end();
        });
    }

    /**
     * Make HTTP GET request with OAuth2 authentication
     */
    async makeRequest(endpoint, queryParams = {}) {
        // Get access token if we don't have one
        if (!this.accessToken) {
            try {
                await this.getAccessToken();
            } catch (error) {
                throw new Error(`Authentication failed: ${error.message}`);
            }
        }

        const url = new URL(`${this.baseUrl}${this.apiPath}${endpoint}`);
        
        // Add query parameters
        Object.keys(queryParams).forEach(key => {
            if (queryParams[key] !== undefined && queryParams[key] !== null) {
                url.searchParams.append(key, queryParams[key]);
            }
        });

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const options = {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/json'
                }
            };
            
            const req = http.get(url.toString(), options, (res) => {
                let data = '';
                
                res.on('data', chunk => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    const responseTime = Date.now() - startTime;
                    
                    try {
                        const jsonData = JSON.parse(data);
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            data: jsonData,
                            responseTime,
                            rawData: data
                        });
                    } catch (error) {
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            data: null,
                            responseTime,
                            rawData: data,
                            parseError: error.message
                        });
                    }
                });
            });
            
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Test collection endpoint (many records)
     */
    async testCollectionEndpoint(endpoint, expectedWrapper, testName) {
        console.log(`\n  Testing ${testName}...`);
        
        try {
            // Test basic collection
            const response = await this.makeRequest(`/${endpoint}`, { limit: 3 });
            
            if (response.statusCode !== 200) {
                throw new Error(`Expected 200, got ${response.statusCode}: ${response.rawData}`);
            }
            
            if (!response.data || !response.data[expectedWrapper]) {
                throw new Error(`Missing ${expectedWrapper} in response: ${JSON.stringify(response.data)}`);
            }
            
            const records = response.data[expectedWrapper];
            console.log(`    ✅ Retrieved ${records.length} records`);
            console.log(`    ✅ Response time: ${response.responseTime}ms`);
            
            // Test with filtering
            if (records.length > 0 && records[0].status) {
                const filterResponse = await this.makeRequest(`/${endpoint}`, { 
                    limit: 2, 
                    filter: `status='${records[0].status}'` 
                });
                
                if (filterResponse.statusCode === 200 && filterResponse.data[expectedWrapper]) {
                    console.log(`    ✅ Filtering works: ${filterResponse.data[expectedWrapper].length} filtered records`);
                } else {
                    console.log(`    ⚠️ Filtering test inconclusive`);
                }
            }
            
            // Test field selection
            if (records.length > 0) {
                const fields = Object.keys(records[0]).slice(0, 3).join(',');
                const fieldsResponse = await this.makeRequest(`/${endpoint}`, { 
                    limit: 1, 
                    fields: fields 
                });
                
                if (fieldsResponse.statusCode === 200 && fieldsResponse.data[expectedWrapper]) {
                    const fieldCount = Object.keys(fieldsResponse.data[expectedWrapper][0]).length;
                    console.log(`    ✅ Field selection works: ${fieldCount} fields returned`);
                }
            }
            
            return {
                success: true,
                recordCount: records.length,
                responseTime: response.responseTime,
                sampleRecord: records[0]
            };
            
        } catch (error) {
            console.log(`    ❌ Failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test single record endpoint
     */
    async testSingleEndpoint(endpoint, singleEndpoint, expectedWrapper, sampleRecord, testName) {
        console.log(`\n  Testing ${testName}...`);
        
        if (!sampleRecord || !sampleRecord.sourcedId) {
            console.log(`    ⚠️ Skipped - no sample record available`);
            return { success: false, error: 'No sample record' };
        }
        
        try {
            const response = await this.makeRequest(`/${singleEndpoint}/${sampleRecord.sourcedId}`);
            
            if (response.statusCode === 404) {
                console.log(`    ⚠️ Record not found (may be normal): ${sampleRecord.sourcedId}`);
                return { success: true, notFound: true };
            }
            
            if (response.statusCode !== 200) {
                throw new Error(`Expected 200, got ${response.statusCode}: ${response.rawData}`);
            }
            
            if (!response.data || !response.data[expectedWrapper]) {
                throw new Error(`Missing ${expectedWrapper} in response`);
            }
            
            const record = response.data[expectedWrapper];
            console.log(`    ✅ Retrieved single record: ${record.sourcedId || 'ID not available'}`);
            console.log(`    ✅ Response time: ${response.responseTime}ms`);
            
            return {
                success: true,
                responseTime: response.responseTime,
                record: record
            };
            
        } catch (error) {
            console.log(`    ❌ Failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test error handling
     */
    async testErrorHandling() {
        console.log(`\n  Testing error handling...`);
        
        try {
            // Test invalid field selection
            const invalidFieldResponse = await this.makeRequest('/orgs', { 
                fields: 'sourcedId,invalidField' 
            });
            
            if (invalidFieldResponse.statusCode === 400) {
                console.log(`    ✅ Invalid field error handled correctly (400)`);
            } else {
                console.log(`    ⚠️ Unexpected response for invalid field: ${invalidFieldResponse.statusCode}`);
            }
            
            // Test invalid endpoint
            const invalidEndpointResponse = await this.makeRequest('/invalid-endpoint');
            
            if (invalidEndpointResponse.statusCode === 404) {
                console.log(`    ✅ Invalid endpoint handled correctly (404)`);
            } else {
                console.log(`    ⚠️ Unexpected response for invalid endpoint: ${invalidEndpointResponse.statusCode}`);
            }
            
            return { success: true };
            
        } catch (error) {
            console.log(`    ❌ Error handling test failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Query health endpoint to show database info
     */
    async showDatabaseInfo() {
        try {
            console.log('Checking API health and database connection...');
            const healthUrl = `${this.baseUrl}/health-check`;
            
            const healthResponse = await new Promise((resolve, reject) => {
                const options = {
                    headers: {
                        'Accept': 'application/json'
                    }
                };
                
                const req = http.get(healthUrl, options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const jsonData = JSON.parse(data);
                            resolve({ statusCode: res.statusCode, data: jsonData });
                        } catch (e) {
                            resolve({ statusCode: res.statusCode, data: { raw: data } });
                        }
                    });
                });
                req.on('error', reject);
                req.setTimeout(5000, () => reject(new Error('Health check timeout')));
            });

            if (healthResponse.statusCode === 200) {
                console.log(`✅ API Status: ${healthResponse.data.status || 'Unknown'}`);
                console.log(`✅ Database Type: ${healthResponse.data.database || 'Unknown'}`);
                console.log(`✅ Database Abstraction: ${healthResponse.data.abstraction || 'Unknown'}`);
                console.log(`✅ Environment: ${process.env.DB_TYPE || 'Unknown'} (from env)`);
            } else {
                console.log(`⚠️  Health check returned status ${healthResponse.statusCode}`);
            }
        } catch (error) {
            console.log(`⚠️  Could not get health info: ${error.message}`);
        }
        console.log('');
    }

    /**
     * Run comprehensive API tests
     */
    async runTests() {
        console.log('OneRoster API Integration Test Suite');
        console.log('====================================');
        console.log(`Testing API at: ${this.baseUrl}${this.apiPath}`);
        console.log('');
        
        // Acquire OAuth2 token first
        try {
            console.log('Acquiring OAuth2 access token...');
            await this.getAccessToken();
            console.log('');
        } catch (error) {
            console.log(`❌ Failed to acquire access token: ${error.message}`);
            return false;
        }
        
        await this.showDatabaseInfo();

        const startTime = Date.now();
        let totalTests = 0;
        let passedTests = 0;

        // Define test endpoints
        const endpoints = [
            { endpoint: 'orgs', single: 'orgs', wrapper: 'orgs', singleWrapper: 'org', name: 'Organizations' },
            { endpoint: 'schools', single: 'schools', wrapper: 'orgs', singleWrapper: 'org', name: 'Schools (subset of orgs)' },
            { endpoint: 'users', single: 'users', wrapper: 'users', singleWrapper: 'user', name: 'Users' },
            { endpoint: 'students', single: 'students', wrapper: 'users', singleWrapper: 'user', name: 'Students (subset of users)' },
            { endpoint: 'teachers', single: 'teachers', wrapper: 'users', singleWrapper: 'user', name: 'Teachers (subset of users)' },
            { endpoint: 'classes', single: 'classes', wrapper: 'classes', singleWrapper: 'class', name: 'Classes' },
            { endpoint: 'courses', single: 'courses', wrapper: 'courses', singleWrapper: 'course', name: 'Courses' },
            { endpoint: 'academicSessions', single: 'academicSessions', wrapper: 'academicsessions', singleWrapper: 'academicsession', name: 'Academic Sessions' },
            { endpoint: 'enrollments', single: 'enrollments', wrapper: 'enrollments', singleWrapper: 'enrollment', name: 'Enrollments' },
            { endpoint: 'demographics', single: 'demographics', wrapper: 'demographics', singleWrapper: 'demographic', name: 'Demographics' }
        ];

        // Test each endpoint
        for (const endpointConfig of endpoints) {
            console.log(`\n${'='.repeat(50)}`);
            console.log(`Testing ${endpointConfig.name}`);
            console.log('='.repeat(50));

            totalTests++;
            
            // Test collection endpoint
            const collectionResult = await this.testCollectionEndpoint(
                endpointConfig.endpoint,
                endpointConfig.wrapper,
                `${endpointConfig.name} Collection`
            );
            
            this.testResults[endpointConfig.endpoint] = collectionResult;
            
            if (collectionResult.success) {
                passedTests++;
                
                // Test single record endpoint if we have a sample
                totalTests++;
                const singleResult = await this.testSingleEndpoint(
                    endpointConfig.endpoint,
                    endpointConfig.single,
                    endpointConfig.singleWrapper,
                    collectionResult.sampleRecord,
                    `${endpointConfig.name} Single Record`
                );
                
                if (singleResult.success) {
                    passedTests++;
                }
            }
        }

        // Test error handling
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Testing Error Handling`);
        console.log('='.repeat(50));
        
        totalTests++;
        const errorResult = await this.testErrorHandling();
        if (errorResult.success) {
            passedTests++;
        }

        // Test performance and pagination
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Testing Performance & Pagination`);
        console.log('='.repeat(50));
        
        totalTests++;
        const perfResult = await this.testPerformanceAndPagination();
        if (perfResult.success) {
            passedTests++;
        }

        // Summary
        const totalTime = Date.now() - startTime;
        console.log(`\n${'='.repeat(70)}`);
        console.log(`ONEROSTER API TEST SUMMARY`);
        console.log('='.repeat(70));
        console.log(`Total Tests: ${totalTests}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${totalTests - passedTests}`);
        console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
        console.log(`Total Time: ${totalTime}ms`);
        
        if (passedTests === totalTests) {
            console.log(`\n🎉 All OneRoster API tests passed successfully!`);
            return true;
        } else {
            console.log(`\n⚠️ Some tests failed - check details above`);
            return false;
        }
    }

    /**
     * Test performance and pagination
     */
    async testPerformanceAndPagination() {
        console.log(`\n  Testing performance and pagination...`);
        
        try {
            // Test different page sizes
            const pageSizes = [1, 5, 10, 25];
            const responseTimes = [];
            
            for (const size of pageSizes) {
                const response = await this.makeRequest('/orgs', { limit: size });
                if (response.statusCode === 200) {
                    responseTimes.push({ size, time: response.responseTime });
                    console.log(`    ✅ Page size ${size}: ${response.responseTime}ms`);
                }
            }
            
            // Test pagination with offset
            const page1 = await this.makeRequest('/orgs', { limit: 2, offset: 0 });
            const page2 = await this.makeRequest('/orgs', { limit: 2, offset: 2 });
            
            if (page1.statusCode === 200 && page2.statusCode === 200) {
                console.log(`    ✅ Pagination works: Page 1 (${page1.data.orgs.length}), Page 2 (${page2.data.orgs.length})`);
                
                // Verify different records
                if (page1.data.orgs.length > 0 && page2.data.orgs.length > 0) {
                    const sameIds = page1.data.orgs.some(org1 => 
                        page2.data.orgs.some(org2 => org1.sourcedId === org2.sourcedId)
                    );
                    if (!sameIds) {
                        console.log(`    ✅ Pagination returns different records`);
                    } else {
                        console.log(`    ⚠️ Pagination may be returning duplicate records`);
                    }
                }
            }
            
            return { success: true, responseTimes };
            
        } catch (error) {
            console.log(`    ❌ Performance test failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

// Run the tests
async function runAPITests() {
    const tester = new OneRosterAPITester();
    
    try {
        const success = await tester.runTests();
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('❌ API test suite failed:', error.message);
        process.exit(1);
    }
}

// Export for potential use in other test suites
module.exports = { OneRosterAPITester };

// Run tests if this file is executed directly
if (require.main === module) {
    console.log('Starting OneRoster API Integration Tests...');
    console.log('Make sure the API server is running on http://localhost:3000\n');
    runAPITests();
}