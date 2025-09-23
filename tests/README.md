# OneRoster API Testing Guide

This folder contains several items that may be useful for testing this tool:

1. `row-counts.sql` is a SQL script with queries that count rows of the OneRoster views and the underlying Ed-Fi ODS tables from which they're built. See the comments in the script; some counts should be identical, in other cases several counts must be summed to matcht the OneRoster count. This script should be helpful to test that row-counts match expected values.

1. The main repo's [`README`](../README.md) describes performance tests that were conducted with Vegeta; the `vegeta-files/` folder contains input files we used for the "GET many" endpoints. (Similar files for the "GET one" endpoints can be constructed by the user with `sourcedId`s returned by the "GET many" endpoints.)

1. The folder `grand-bend-augmentation/` contains several additional Ed-Fi `sessions` payloads which are needed to pass OneRoster 1.2 certification; the stock Grand Bend dataset contains no sessions of types that map to OneRoster `terms` or `gradingPeriods` - the `sessions.jsonl` and `lightbeam.yml` (which can be used with [`lightbeam`](https://github.com/edanalytics/lightbeam) to send them to a Grand Bend ODS) populate additional sessions to populate these OneRoster endpoints.

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
DATABASE_TYPE=postgres
PG_HOST=your-postgres-host
PG_PORT=5432
PG_DATABASE=EdFi_Ods
PG_USER=your-user
PG_PASSWORD=your-password
```

**`.env.mssql`** (MSSQL configuration):
```env
PORT=3001
DATABASE_TYPE=mssql
MSSQL_SERVER=your-mssql-server
MSSQL_DATABASE=EdFi_Ods_Sandbox
MSSQL_USER=your-user
MSSQL_PASSWORD=your-password
MSSQL_PORT=1433
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=true
```

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

### 1. Feature Development with Dual Testing

```bash
# 1. Start dual database environment
docker-compose -f docker-compose.dual.yml up -d

# 2. Make your code changes
# ... edit files ...

# 3. Test on both databases
./tests/test-both.sh

# 4. Deploy changes
./deploy-dual.sh
```

### 2. Database-Specific Testing

```bash
# Test PostgreSQL only
curl http://localhost:3000/ims/oneroster/v1p2/academicSessions

# Test MSSQL only  
curl http://localhost:3001/ims/oneroster/v1p2/academicSessions

# Compare results manually or use diff tools
```

### 3. Performance Comparison

```bash
# Benchmark PostgreSQL
ab -n 100 -c 10 http://localhost:3000/ims/oneroster/v1p2/users

# Benchmark MSSQL
ab -n 100 -c 10 http://localhost:3001/ims/oneroster/v1p2/users
```

## Database Setup

### PostgreSQL Setup

1. **Install PostgreSQL** (local or cloud)
2. **Load Ed-Fi ODS** data
3. **Create materialized views**:
   ```bash
   psql -d EdFi_Ods -f sql/setup.sql
   ```

### MSSQL Setup

1. **Install SQL Server** (local, Docker, or Azure)
2. **Load Ed-Fi ODS** data
3. **Deploy OneRoster schema**:
   ```bash
   node sql/mssql/deploy-mssql.js
   ```

## Testing Integration

### Automated Test Suite

The project includes comprehensive integration tests that work with both databases:

```bash
# Run tests against PostgreSQL
npm test

# Run tests against MSSQL
NODE_ENV=mssql npm test

# Run cross-database comparison tests
./tests/test-both.sh
```

### Integration Tests (External Access)

To run integration tests against external IP addresses:

```bash
# Test PostgreSQL instance on external IP
BASE_URL=http://35.215.110.73:3000 node tests/integration/test-oneroster-api.js

# Test MSSQL instance on external IP
BASE_URL=http://35.215.110.73:3001 node tests/integration/test-oneroster-api.js
```

### Test Categories

| Test Type | Location | Purpose |
|-----------|----------|---------|
| **Unit Tests** | `tests/services/` | Test individual service functions |
| **Integration Tests** | `tests/integration/` | Test API endpoints end-to-end |
| **Database Tests** | `tests/services/test-database-compatibility.js` | Test database abstraction layer |
| **Comparison Tests** | `tests/test-both.sh` | Cross-database consistency validation |

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
psql -h $PG_HOST -U $PG_USER -d $PG_DATABASE

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

## Resources

- [OneRoster 1.2 Specification](https://www.imsglobal.org/activity/onerosterlis)
- [Ed-Fi ODS Documentation](https://docs.ed-fi.org/)
- [Knex.js Documentation](https://knexjs.org/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)