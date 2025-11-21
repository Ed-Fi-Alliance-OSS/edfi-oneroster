# OneRoster API Testing Guide

This folder contains several items that may be useful for testing this tool:

1. `row-counts.sql` is a SQL script with queries that count rows of the OneRoster views and the underlying Ed-Fi ODS tables from which they're built. See the comments in the script; some counts should be identical, in other cases several counts must be summed to match the OneRoster count. This script should be helpful to test that row-counts match expected values.

2. The `vegeta-files/` folder contains input files used for performance testing the "GET many" endpoints with [Vegeta](https://github.com/tsenart/vegeta). Similar files for the "GET one" endpoints can be constructed by the user with `sourcedId`s returned by the "GET many" endpoints.

3. The folder `grand-bend-augmentation/` contains several additional Ed-Fi `sessions` payloads which are needed to pass OneRoster 1.2 certification; the stock Grand Bend dataset contains no sessions of types that map to OneRoster `terms` or `gradingPeriods` - the `sessions.jsonl` and `lightbeam.yml` (which can be used with [`lightbeam`](https://github.com/edanalytics/lightbeam) to send them to a Grand Bend ODS) populate additional sessions to populate these OneRoster endpoints.

---

# Performance Testing - Initial Postgres-centric implementation

## Test Environment Setup

Performance testing was conducted on a representative Ed-Fi ODS with synthetic data:
* 1 LEA (Local Education Agency)
* 6 schools
* 500 staff members
* 5,000 students
* 1,500 courses
* 1 school year
* **Total**: ~160k records across 23 Ed-Fi resources = 62MB of JSON

**Test Environment**: Ed-Fi ODS 7.1 (Data Standard 5.0) running locally in Docker on a Lenovo laptop with Intel i5 2.6GHz processor, 16GB RAM, and 500GB SSD running PostgreSQL 16.

## Database Performance Results

### Materialized View Creation/Refresh Times

| View | Create Time | Refresh Time | Notes |
| --- | --- | --- | --- |
| academicSessions | 0.089s | 0.075s | Fast, simple joins |
| classes | 0.341s | 0.428s | Moderate complexity |
| courses | 0.107s | 0.117s | Fast, straightforward |
| demographics | 0.219s | 0.169s | Moderate, student-focused |
| enrollments | 6.598s | 6.814s | **Slowest** - large result set |
| orgs | 0.081s | 0.075s | Fast, organizational data |
| users | 7.885s | 8.025s | **Slowest** - complex joins |

*Times reported are averages of 5 runs*

**Analysis**: 
- **Enrollments** and **users** are the slowest views, which is expected given:
  - Enrollments produces many thousands of rows (high volume)
  - Users involves complex joins across multiple Ed-Fi entities (staff, students, contacts)

## API Performance Results

### Stress Testing Methodology

API stress testing was conducted using [Vegeta](https://github.com/tsenart/vegeta) with commands like:

```bash
vegeta attack -duration=60s -targets=courses.txt -header 'authorization: Bearer [TOKEN]' --rate 0 -max-workers 20 | tee results.bin | vegeta report
```

**Test Files**: Target files located in `tests/vegeta-files/` directory

**Single Record Tests**: Used 100 different `sourcedId` values from the database:
```
GET http://localhost:3000/ims/oneroster/rostering/v1p2/courses/9c2fc6bf0b3a7bff458c715ad9f64f5e
GET http://localhost:3000/ims/oneroster/rostering/v1p2/courses/76635d39fbaed744c5419ed79c503645
GET http://localhost:3000/ims/oneroster/rostering/v1p2/courses/ed4df6e31be884989b127ff6f29f86c2
...
```

### API Performance Results (60-second tests)

| Endpoint | Total Requests | Rate (req/sec) | Mean Latency (ms) | Success Rate |
| --- | --- | --- | --- | --- |
| `/ims/oneroster/rostering/v1p2/academicSessions` | 7,731 | 129 | 155 | 100% |
| `/ims/oneroster/rostering/v1p2/academicSessions/{id}` | 11,608 | 193 | 103 | 100% |
| `/ims/oneroster/rostering/v1p2/classes` | 3,299 | 55 | 142 | 100% |
| `/ims/oneroster/rostering/v1p2/classes/{id}` | 14,748 | 246 | 81 | 100% |
| `/ims/oneroster/rostering/v1p2/courses` | 5,466 | 91 | 199 | 100% |
| `/ims/oneroster/rostering/v1p2/courses/{id}` | 10,027 | 167 | 120 | 100% |
| `/ims/oneroster/rostering/v1p2/demographics` | 4,312 | 72 | 199 | 100% |
| `/ims/oneroster/rostering/v1p2/demographics/{id}` | 14,712 | 245 | 82 | 100% |
| `/ims/oneroster/rostering/v1p2/enrollments` | 3,828 | 64 | 185 | 100% |
| `/ims/oneroster/rostering/v1p2/enrollments/{id}` | 10,745 | 179 | 112 | 100% |
| `/ims/oneroster/rostering/v1p2/orgs` | 8,599 | 143 | 139 | 100% |
| `/ims/oneroster/rostering/v1p2/orgs/{id}` | 8,021 | 134 | 150 | 100% |
| `/ims/oneroster/rostering/v1p2/users` | 5,358 | 89 | 154 | 100% |
| `/ims/oneroster/rostering/v1p2/users/{id}` | 13,011 | 217 | 92 | 100% |

### Performance Analysis

**Key Observations**:
- **100% Success Rate**: All endpoints maintained perfect reliability under load
- **Sub-200ms Latency**: Mean response times stayed well under 200ms for all endpoints
- **Throughput Range**: 50-250 requests/second depending on endpoint complexity
- **Single Record Performance**: `{id}` endpoints generally performed better than collection endpoints
- **Consistent Performance**: No significant degradation observed during sustained load

**Best Performing Endpoints**:
- `classes/{id}`: 246 req/sec, 81ms latency
- `demographics/{id}`: 245 req/sec, 82ms latency  
- `users/{id}`: 217 req/sec, 92ms latency

**Most Resource-Intensive Endpoints**:
- `classes` (collection): 55 req/sec - complex data relationships
- `enrollments` (collection): 64 req/sec - large result sets
- `demographics` (collection): 72 req/sec - complex student queries

---

# OneRoster API Development Guide

This guide covers advanced development and testing workflows for the OneRoster 1.2 API, including dual database testing and cross-database compatibility validation.

## Overview

The OneRoster API supports both PostgreSQL and Microsoft SQL Server databases through a unified Knex.js abstraction layer. This development setup allows you to test both database implementations simultaneously to ensure feature parity and compatibility.

## Quick Start

### Standard Development (Single Database)
```bash
# Standard PostgreSQL development
docker-compose up
```

### Dual Database Development
```bash
# Run both PostgreSQL and MSSQL instances
docker-compose -f docker-compose.dual.yml up
```

## Dual Database Architecture

### Service Configuration

The dual database setup runs two parallel API instances:

| Service | Database | Port | Container Name | Env File |
|---------|----------|------|----------------|----------|
| `api-postgres` | PostgreSQL | 3000 | `edfi-oneroster-postgres` | `.env.postgres` |
| `api-mssql` | MSSQL | 3001 | `edfi-oneroster-mssql` | `.env.mssql` |

### Environment Files

Create separate environment files for each database:

**`.env.postgres`** (PostgreSQL configuration):
```env
PORT=3000
DB_TYPE=postgres
DB_HOST=your-postgres-host
DB_PORT=5432
DB_NAME=EdFi_Ods
DB_USER=your-user
DB_PASS=your-password
```

**`.env.mssql`** (MSSQL configuration):
```env
PORT=3001
DB_TYPE=mssql
MSSQL_SERVER=your-mssql-server
MSSQL_DATABASE=EdFi_Ods_Sandbox
MSSQL_USER=your-user
MSSQL_PASSWORD=your-password
MSSQL_PORT=1433
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=true
```

## Cross-Database Testing

### API Comparison Testing

Compare API responses between PostgreSQL and MSSQL implementations:

```bash
# Test all endpoints without authentication
node tests/compare-api.js

# Test all endpoints with OAuth2 authentication  
node tests/compare-api.js --auth

# Test specific endpoint
node tests/compare-api.js orgs

# Test with Data Standard 4
node tests/compare-api.js ds4

# Test specific endpoint with DS4 and auth
node tests/compare-api.js --auth ds4 orgs
```

**Command Line Options**:
- `--auth`: Enable OAuth2 authentication
- `ds4` / `ds5`: Specify Ed-Fi Data Standard version
- `[endpoint]`: Test specific endpoint (orgs, users, classes, etc.)

### Database Comparison Testing

Compare raw database query results between implementations:

```bash
# Test all endpoints at database level
node tests/compare-database.js

# Test specific endpoint
node tests/compare-database.js orgs

# Test with Data Standard 4
node tests/compare-database.js ds4 orgs
```

**What it tests**:
- Raw SQL query results
- JSON structure consistency
- Data type compatibility
- NULL value handling
- Array ordering consistency

## Development Scripts

### Deployment Script

**`deploy-dual.sh`** - Automated deployment for both databases:

```bash
# Deploy both PostgreSQL and MSSQL instances
./deploy-dual.sh
```

This script:
- ✅ Builds and starts both containers
- ✅ Waits for health checks to pass
- ✅ Validates API endpoints are responding
- ✅ Displays connection information

### Testing Script

**`tests/test-both.sh`** - Cross-database compatibility testing:

```bash
# Run comparison tests between PostgreSQL and MSSQL
./tests/test-both.sh
```

This script:
- ✅ Tests identical API endpoints on both databases
- ✅ Compares response data for consistency
- ✅ Validates OneRoster specification compliance
- ✅ Reports any differences between database implementations

## Development Workflows

### 1. Feature Development with Cross-Database Testing

```bash
# 1. Start dual database environment
docker-compose -f docker-compose.dual.yml up -d

# 2. Make your code changes
# ... edit files ...

# 3. Test on both databases
node tests/compare-api.js
node tests/compare-database.js

# 4. Deploy changes
./deploy-dual.sh
```

### 2. Database-Specific Testing

```bash
# Test PostgreSQL only
curl http://localhost:3000/ims/oneroster/v1p2/academicSessions

# Test MSSQL only  
curl http://localhost:3001/ims/oneroster/v1p2/academicSessions

# Compare results using built-in tools
node tests/compare-api.js academicSessions
```

### 3. Performance Comparison

```bash
# Benchmark PostgreSQL
ab -n 100 -c 10 http://localhost:3000/ims/oneroster/v1p2/users

# Benchmark MSSQL
ab -n 100 -c 10 http://localhost:3001/ims/oneroster/v1p2/users

# Stress test with Vegeta
vegeta attack -duration=30s -targets=tests/vegeta-files/users.txt -rate=50 | vegeta report
```

## Database Setup

### PostgreSQL Setup

1. **Install PostgreSQL** (local or cloud)
2. **Load Ed-Fi ODS** data
3. **Deploy OneRoster schema using automated script**:
   ```bash
   # Data Standard 5 (default)
   ./sql/deploy-postgres.sh
   
   # Data Standard 4
   ./sql/deploy-postgres.sh ds4
   ```
   
   Alternatively, create materialized views manually:
   ```bash
   # Data Standard 5
   psql -d EdFi_Ods -f sql/setup.sql
   
   # Data Standard 4  
   psql -d EdFi_Ods -f sql/ds4/setup.sql
   ```

### MSSQL Setup

1. **Install SQL Server** (local, Docker, or Azure)
2. **Load Ed-Fi ODS** data
3. **Deploy OneRoster schema**:
   ```bash
   # Data Standard 5 (default)
   node sql/mssql/deploy-mssql.js
   
   # Data Standard 4
   node sql/mssql/deploy-mssql.js ds4
   ```

## Testing Integration

### Automated Test Suite

The project includes comprehensive integration tests that work with both databases:

```bash
# Run tests against PostgreSQL
npm test

# Run tests against MSSQL
DB_TYPE=mssql npm test

# Run cross-database comparison tests
./tests/test-both.sh
```

### Integration Tests (External Access)

To run integration tests against external IP addresses:

```bash
# Test PostgreSQL instance on external IP
BASE_URL=http://35.215.110.73:3000 node tests/compare-api.js

# Test MSSQL instance on external IP
BASE_URL=http://35.215.110.73:3001 node tests/compare-api.js
```

### Test Categories

| Test Type | Location | Purpose |
|-----------|----------|---------|
| **Unit Tests** | `tests/services/` | Test individual service functions |
| **Integration Tests** | `tests/integration/` | Test API endpoints end-to-end |
| **Database Tests** | `tests/compare-database.js` | Test database abstraction layer |
| **API Comparison Tests** | `tests/compare-api.js` | Cross-database API consistency validation |
| **Performance Tests** | `tests/vegeta-files/` | Load testing with Vegeta |

## Debugging and Troubleshooting

### Container Logs

```bash
# View PostgreSQL API logs
docker logs edfi-oneroster-postgres

# View MSSQL API logs  
docker logs edfi-oneroster-mssql

# Follow logs in real-time
docker logs -f edfi-oneroster-postgres
```

### Health Checks

```bash
# Check PostgreSQL API health
curl http://localhost:3000/health-check

# Check MSSQL API health
curl http://localhost:3001/health-check
```

### Database Connections

```bash
# Test PostgreSQL connection
psql -h $DB_HOST -U $DB_USER -d $DB_NAME

# Test MSSQL connection
sqlcmd -S $MSSQL_SERVER -U $MSSQL_USER -P $MSSQL_PASSWORD
```

## Common Issues

### Port Conflicts
If ports 3000/3001 are in use:
```bash
# Check what's using the ports
lsof -i :3000
lsof -i :3001

# Kill conflicting processes
kill -9 <PID>
```

### Database Connection Issues
1. **Verify credentials** in environment files
2. **Check network connectivity** to database servers
3. **Validate database schemas** exist and are populated
4. **Review container logs** for specific error messages

### Environment File Issues
- Ensure `.env.postgres` and `.env.mssql` files exist
- Check for typos in variable names
- Validate all required variables are set

## Performance Considerations

### Development Recommendations

- **Use local databases** when possible for faster development
- **Limit concurrent containers** on development machines
- **Monitor resource usage** with `docker stats`
- **Use database connection pooling** (configured in Knex.js)

### Production Notes

- **Single database mode** is recommended for production deployments
- **Use standard `docker-compose.yml`** for production
- **Configure appropriate connection limits** and timeouts
- **Implement proper monitoring** and health checks

## Contributing

When developing features that affect both database implementations:

1. **Test on both databases** using dual setup
2. **Ensure response consistency** between PostgreSQL and MSSQL
3. **Update both database schemas** if needed
4. **Run the full test suite** before submitting PRs
5. **Document any database-specific behaviors**
6. **Test with both Data Standard 4 and 5** if applicable

## Resources

- [OneRoster 1.2 Specification](https://www.imsglobal.org/activity/onerosterlis)
- [Ed-Fi ODS Documentation](https://docs.ed-fi.org/)
- [Knex.js Documentation](https://knexjs.org/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Vegeta Load Testing](https://github.com/tsenart/vegeta)
