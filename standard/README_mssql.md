# OneRoster 1.2 MS SQL Server Implementation

This directory contains the MS SQL Server implementation of the OneRoster 1.2 API bridge for Ed-Fi ODS. It provides equivalent functionality to the PostgreSQL materialized views using tables and stored procedures.

>[!WARNING]
Make sure SQL Server Agent is enabled on your Ed-Fi ODS database server or
Docker container. For Docker, add `MSSQL_AGENT_ENABLED=True` to the environment
section of your Ed-Fi ODS database server's Docker Compose configuration.

## Architecture Overview

The MSSQL implementation uses:
- **Tables** instead of materialized views for data storage
- **Stored procedures** for data refresh logic
- **SQL Server Agent jobs** for scheduled refreshes (every 15 minutes)
- **Staging tables** for atomic data swaps during refresh

## Files Overview

>[!NOTE]
The script files are organized under the `standard/{data standard version}/mssql`
directory structure.

### Foundation Files (Phase 1)
- `00_setup.sql` - Creates schema and supporting infrastructure
- `01_descriptors.sql` - OneRoster descriptor definitions
- `02_descriptorMappings.sql` - Ed-Fi to OneRoster descriptor mappings

### Core Implementation (Phase 2)
- `academic_sessions.sql` - Academic sessions table, indexes, and refresh procedure
- `orgs.sql` - Organizations table, indexes, and refresh procedure
- `courses.sql` - Courses table, indexes, and refresh procedure
- `classes.sql` - Classes table, indexes, and refresh procedure
- `demographics.sql` - Demographics table, indexes, and refresh procedure
- `users.sql` - Users table, indexes, and refresh procedure (most complex)
- `enrollments.sql` - Enrollments table, indexes, and refresh procedure

### Orchestration (Phase 3)
- `master_refresh.sql` - Master orchestration procedures
- `sql_agent_job.sql` - SQL Server Agent job setup

### Deployment
- `deploy-mssql.js` - Node.js automated deployment script (**Recommended**)
- `README.md` - This documentation file

## Prerequisites

- **SQL Server 2016 or later** (required for JSON support)
- **Ed-Fi ODS** with Data Standard 5.0 or later
- **SQL Server Agent** service running (for automated refreshes)
- **Database permissions** for creating schemas, tables, procedures, and jobs

## Quick Start

### 1. Deploy the Solution

**Option A: Automated Node.js Deployment (Recommended)**

```bash
# Ensure your .env file has MSSQL connection settings
# Then run the automated deployment script
node sql/mssql/deploy-mssql.js
```

The Node.js deployment script provides:
- ✅ Comprehensive error handling and reporting  
- ✅ Prerequisites validation (SQL Server version, Ed-Fi schema, Agent status)
- ✅ Phased deployment with detailed progress tracking
- ✅ Post-deployment verification and summary
- ✅ Works with any SQL Server setup (local, remote, Azure)

**Option B: Manual SQL Execution**

If you prefer manual execution, run each SQL file in this order:
1. Foundation: `00_setup.sql`, `01_descriptors.sql`, `02_descriptorMappings.sql`
2. Core (includes tables and indexes): `academic_sessions.sql`, `orgs.sql`, `courses.sql`, `classes.sql`, `demographics.sql`, `users.sql`, `enrollments.sql`
3. Orchestration: `master_refresh.sql`, `sql_agent_job.sql`

### 2. Populate Data Tables

The deployment script provides instructions for manually running the refresh procedures. Run these commands to populate the OneRoster tables with Ed-Fi data:

```sql
-- Populate OneRoster tables with Ed-Fi data (run in order)
EXEC oneroster12.sp_refresh_orgs;
EXEC oneroster12.sp_refresh_academicsessions;
EXEC oneroster12.sp_refresh_courses;
EXEC oneroster12.sp_refresh_classes;
EXEC oneroster12.sp_refresh_demographics;
EXEC oneroster12.sp_refresh_users;
EXEC oneroster12.sp_refresh_enrollments;

-- Verify data was loaded
SELECT COUNT(*) FROM oneroster12.orgs;
SELECT COUNT(*) FROM oneroster12.users;
SELECT COUNT(*) FROM oneroster12.classes;

-- Check refresh status (if available)
EXEC oneroster12.sp_refresh_status;
```

### 3. Monitor Automated Refreshes

The system automatically refreshes every 15 minutes via SQL Server Agent job:

```sql
-- Check job status
SELECT name, enabled FROM msdb.dbo.sysjobs WHERE name LIKE '%OneRoster%';

-- View recent refresh history
SELECT * FROM oneroster12.refresh_history ORDER BY refresh_start DESC;

-- Check for errors
SELECT * FROM oneroster12.refresh_errors ORDER BY error_date DESC;
```

## Data Tables

| Table | Description | Approximate Refresh Time |
|-------|-------------|-------------------------|
| `academicsessions` | School years, terms, grading periods | < 1 second |
| `orgs` | Schools, districts, state agencies | < 1 second |
| `courses` | Course offerings | < 2 seconds |
| `classes` | Class sections | < 5 seconds |
| `demographics` | Student demographics | < 3 seconds |
| `users` | Students, staff, parents | < 15 seconds |
| `enrollments` | Student/staff class enrollments | < 10 seconds |

## Management Commands

### Manual Refresh Operations

```sql
-- Refresh all tables
EXEC oneroster12.sp_refresh_all;

-- Refresh all tables (skip errors)
EXEC oneroster12.sp_refresh_all @SkipOnError = 1;

-- Force refresh (ignore recent completion)
EXEC oneroster12.sp_refresh_all @ForceRefresh = 1;

-- Refresh individual table
EXEC oneroster12.sp_refresh_users;
```

### Monitoring and Status

```sql
-- General status check
EXEC oneroster12.sp_refresh_status;

-- Status for last 7 days
EXEC oneroster12.sp_refresh_status @DaysBack = 7;

-- Current row counts
SELECT 'academicsessions' AS [Table], COUNT(*) AS [Rows] FROM oneroster12.academicsessions
UNION ALL
SELECT 'orgs', COUNT(*) FROM oneroster12.orgs
UNION ALL
SELECT 'courses', COUNT(*) FROM oneroster12.courses
UNION ALL
SELECT 'classes', COUNT(*) FROM oneroster12.classes
UNION ALL
SELECT 'users', COUNT(*) FROM oneroster12.users
UNION ALL
SELECT 'enrollments', COUNT(*) FROM oneroster12.enrollments
UNION ALL
SELECT 'demographics', COUNT(*) FROM oneroster12.demographics;
```

### Job Management

```sql
-- Start job manually
EXEC msdb.dbo.sp_start_job @job_name = 'OneRoster Data Refresh';

-- Disable automatic refresh
EXEC msdb.dbo.sp_update_job @job_name = 'OneRoster Data Refresh', @enabled = 0;

-- Enable automatic refresh
EXEC msdb.dbo.sp_update_job @job_name = 'OneRoster Data Refresh', @enabled = 1;

-- View job history
SELECT 
    h.run_date, h.run_time, h.step_name,
    CASE h.run_status 
        WHEN 0 THEN 'Failed' 
        WHEN 1 THEN 'Succeeded' 
        WHEN 2 THEN 'Retry' 
        WHEN 3 THEN 'Canceled' 
        WHEN 4 THEN 'In Progress' 
    END AS Status,
    h.message
FROM msdb.dbo.sysjobhistory h
JOIN msdb.dbo.sysjobs j ON h.job_id = j.job_id
WHERE j.name = 'OneRoster Data Refresh'
ORDER BY h.run_date DESC, h.run_time DESC;
```

## Performance Optimization

### Index Usage Monitoring

```sql
-- Monitor index usage
SELECT 
    OBJECT_NAME(s.object_id) AS TableName, 
    i.name AS IndexName,
    s.user_seeks, s.user_scans, s.user_lookups, s.user_updates
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE OBJECT_SCHEMA_NAME(s.object_id) = 'oneroster12'
ORDER BY s.user_seeks + s.user_scans + s.user_lookups DESC;
```

### Missing Index Analysis

```sql
-- Identify potentially missing indexes
SELECT DISTINCT
    OBJECT_NAME(mid.object_id) AS TableName,
    mid.equality_columns, 
    mid.inequality_columns, 
    mid.included_columns,
    migs.user_seeks, 
    migs.avg_total_user_cost, 
    migs.avg_user_impact
FROM sys.dm_db_missing_index_details mid
JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
WHERE OBJECT_SCHEMA_NAME(mid.object_id) = 'oneroster12'
ORDER BY migs.avg_user_impact DESC;
```

## Troubleshooting

### Common Issues

1. **SQL Server Agent Not Running**
   - Symptom: Data not refreshing automatically
   - Solution: Start SQL Server Agent service via SQL Server Configuration Manager

2. **Permission Errors**
   - Symptom: Cannot create objects or refresh data
   - Solution: Ensure account has db_owner or appropriate permissions

3. **Long Refresh Times**
   - Symptom: Refresh takes longer than expected
   - Solution: Check index usage, update statistics, review query plans

4. **JSON Errors**
   - Symptom: JSON-related errors during refresh
   - Solution: Ensure SQL Server 2016+ and check for data issues

### Refresh Failures

```sql
-- Check recent errors
SELECT * FROM oneroster12.refresh_errors 
WHERE error_date >= DATEADD(HOUR, -24, GETDATE())
ORDER BY error_date DESC;

-- Check failed refresh attempts
SELECT * FROM oneroster12.refresh_history 
WHERE status = 'Failed' AND refresh_start >= DATEADD(HOUR, -24, GETDATE())
ORDER BY refresh_start DESC;
```

### Performance Issues

```sql
-- Check table sizes
SELECT 
    OBJECT_SCHEMA_NAME(p.object_id) AS SchemaName,
    OBJECT_NAME(p.object_id) AS TableName,
    SUM(p.rows) AS RowCount,
    SUM(a.total_pages) * 8 AS TotalSpaceKB,
    SUM(a.used_pages) * 8 AS UsedSpaceKB
FROM sys.partitions p
JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE OBJECT_SCHEMA_NAME(p.object_id) = 'oneroster12'
GROUP BY p.object_id
ORDER BY SUM(p.rows) DESC;

-- Check refresh duration trends
SELECT 
    table_name,
    AVG(duration_seconds) AS avg_duration,
    MIN(duration_seconds) AS min_duration,
    MAX(duration_seconds) AS max_duration,
    COUNT(*) AS refresh_count
FROM oneroster12.refresh_history
WHERE refresh_start >= DATEADD(DAY, -7, GETDATE()) 
  AND status = 'Success'
GROUP BY table_name
ORDER BY avg_duration DESC;
```

## Deployment Script Details

The `deploy.js` script provides enterprise-grade deployment capabilities:

### Features
- **Prerequisites Checking**: Validates SQL Server version (2016+), Ed-Fi schema presence, and SQL Server Agent status
- **Phased Deployment**: 
  - Phase 1: Foundation (schema, descriptors, mappings)
  - Phase 2: Core Tables, Indexes, and Procedures (7 OneRoster entity scripts with integrated DDL)
  - Phase 3: Orchestration (master procedures and jobs)
- **Intelligent Batch Processing**: Properly splits SQL files on GO statements and filters empty batches
- **Comprehensive Error Handling**: Continues deployment even if some batches fail, with detailed reporting
- **Post-Deployment Verification**: Confirms all objects were created successfully
- **Environment Integration**: Uses .env file for connection settings

### Sample Output
```
========================================
OneRoster 1.2 MSSQL Deployment
========================================
Target Server: your-server.database.windows.net
Target Database: EdFi_Ods_Production
User: edfi_admin
Deployment Time: 2025-09-11T03:18:31.255Z

🔌 Connecting to SQL Server...
✅ Connected successfully

🔍 Checking prerequisites...
✅ Database: EdFi_Ods_Production
✅ SQL Server Version: 16 (SQL Server 2022)
✅ Ed-Fi schema detected
✅ SQL Server Agent is running

=== Phase 1: Foundation Setup ===
⚡ [1/3] Executing 00_setup.sql (5 batches)
    ✅ 00_setup.sql: 5 successful, 0 failed

... [deployment continues] ...

📊 DEPLOYMENT SUMMARY
✅ All 9 OneRoster tables created
✅ All 8 stored procedures deployed
✅ SQL Server Agent job configured
🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!
```

### Configuration

The script reads connection settings from your `.env` file:
```env
MSSQL_SERVER=your-server.database.windows.net
MSSQL_DATABASE=EdFi_Ods_Production
MSSQL_USER=edfi_admin
MSSQL_PASSWORD=your-secure-password
MSSQL_PORT=1433
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=false
```

## Customization

### Modifying Refresh Schedule

To change from 15-minute intervals:

```sql
-- Update to 30 minutes
EXEC msdb.dbo.sp_update_schedule 
    @name = 'OneRoster Refresh Schedule',
    @freq_subday_interval = 30;

-- Update to hourly
EXEC msdb.dbo.sp_update_schedule 
    @name = 'OneRoster Refresh Schedule',
    @freq_subday_type = 8,  -- Hours
    @freq_subday_interval = 1;
```

### Adding Custom Monitoring

You can extend the monitoring by creating custom procedures:

```sql
-- Example: Custom health check procedure
CREATE PROCEDURE oneroster12.sp_health_check
AS
BEGIN
    -- Check if any table is empty
    -- Check if last refresh was too long ago
    -- Send alerts if needed
    -- Your custom logic here
END
```

## Migration from PostgreSQL

This MSSQL implementation provides equivalent functionality to the PostgreSQL materialized views. Key differences:

1. **Data Storage**: Tables instead of materialized views
2. **Refresh Method**: Stored procedures instead of `REFRESH MATERIALIZED VIEW`
3. **Scheduling**: SQL Server Agent instead of pg-boss
4. **JSON Handling**: `FOR JSON PATH` instead of `json_build_object()`
5. **Hashing**: `HASHBYTES('MD5', ...)` instead of `md5()`

The Express.js application will need minor modifications to work with MSSQL (connection string, query differences), but the table structure and data format remain identical.

## Support

For issues or questions:
1. Check the refresh_errors table for specific error messages
2. Review the deployment output for any warnings
3. Ensure all prerequisites are met
4. Verify Ed-Fi data is present and accessible

## Performance Baseline

Based on testing with ~160k Ed-Fi records:

| Operation | Expected Time |
|-----------|---------------|
| Initial deployment | 2-5 minutes |
| Full refresh (all tables) | < 30 seconds |
| Individual table refresh | 1-15 seconds |
| Query response time | < 100ms typical |

Actual performance will vary based on data volume, server specifications, and concurrent load.
