# MSSQL Materialized View Conversion Guide for OneRoster 1.2 (Ed-Fi)

## Overview
This guide documents the process and best practices for converting Postgres materialized views in the OneRoster 1.2 SQL suite to Microsoft SQL Server (MSSQL), including a fully worked sample for `academic_sessions.sql`.

---

## Conversion Plan

### General Approach
- Replace Postgres materialized views with tables in the `oneroster12` schema.
- Populate tables via stored procedures or SQL Agent jobs scheduled every 15 minutes.
- Use staging tables and atomic swaps to ensure concurrency and avoid partial refreshes.

### Options for Emulation
- **Full Table Refresh:** Truncate and repopulate tables on each refresh. Use staging tables for atomic swaps.
- **Incremental Refresh:** Track changes and update only affected rows. More complex, but reduces load.
- **Indexed Views:** Not recommended due to MSSQL limitations (no aggregates, etc.).
- **Hybrid:** Combine table refreshes with regular views for near-real-time needs.

### Implementation Steps
1. Convert each `CREATE MATERIALIZED VIEW` to `CREATE TABLE`.
2. Move view logic into a stored procedure for population.
3. Remove Postgres-specific syntax and replace with MSSQL equivalents.
4. Schedule refreshes via SQL Agent.
5. Add indexes for performance.
6. Retain the `oneroster12` schema for compatibility.

### MSSQL Equivalents for Postgres Features
| Postgres Feature                | MSSQL Equivalent/Workaround                                 |
|----------------------------------|------------------------------------------------------------|
| `materialized view`              | Table + refresh procedure                                  |
| `array_agg()`                    | `STRING_AGG()` for strings, or use subquery with FOR JSON  |
| `json_build_object()`            | `FOR JSON PATH, WITHOUT_ARRAY_WRAPPER`                     |
| `md5()`                         | `HASHBYTES('MD5', ...)` (returns binary, cast as needed)   |
| `grouping sets`                  | Supported in MSSQL                                         |
| `mode() within group`            | Subquery with `TOP 1 ... ORDER BY COUNT(*) DESC`           |
| `if not exists`                  | Use `IF OBJECT_ID(...) IS NULL` before creation            |
| `::type` (cast)                  | Use `CAST()` or `CONVERT()`                                |
| `UNION ALL`                      | Supported                                                  |

---

## Sample Conversion: academic_sessions.sql

### Table Definition
```sql
CREATE TABLE oneroster12.academicsessions (
    sourcedId NVARCHAR(64) PRIMARY KEY,
    status NVARCHAR(16),
    dateLastModified DATETIME NULL,
    title NVARCHAR(128),
    type NVARCHAR(32),
    startDate NVARCHAR(32),
    endDate NVARCHAR(32),
    parent NVARCHAR(MAX), -- JSON as string
    schoolYear NVARCHAR(16),
    metadata NVARCHAR(MAX) -- JSON as string
);
```

### Stored Procedure for Refresh
```sql
CREATE PROCEDURE oneroster12.refresh_academicsessions AS
BEGIN
    CREATE TABLE #staging_academicsessions (
        sourcedId NVARCHAR(64) PRIMARY KEY,
        status NVARCHAR(16),
        dateLastModified DATETIME NULL,
        title NVARCHAR(128),
        type NVARCHAR(32),
        startDate NVARCHAR(32),
        endDate NVARCHAR(32),
        parent NVARCHAR(MAX),
        schoolYear NVARCHAR(16),
        metadata NVARCHAR(MAX)
    );

    WITH calendar_windows AS (
        SELECT
            cd.schoolid,
            cd.schoolyear,
            cd.calendarcode,
            MIN(cd.date) AS first_school_day,
            MAX(cd.date) AS last_school_day,
            STRING_AGG(DISTINCT eventdescriptor.codevalue, ',') AS eventdescriptors
        FROM edfi.calendardate cd
        JOIN edfi.calendardatecalendarevent cdce
            ON cd.schoolid = cdce.schoolid
            AND cd.date = cdce.date
            AND cd.schoolyear = cdce.schoolyear
            AND cd.calendarcode = cdce.calendarcode
        JOIN edfi.descriptor eventdescriptor
            ON cdce.calendareventdescriptorid = eventdescriptor.descriptorid
        JOIN edfi.descriptormapping mappedeventdescriptor
            ON mappedeventdescriptor.value = eventdescriptor.codevalue
            AND mappedeventdescriptor.namespace = eventdescriptor.namespace
            AND mappedeventdescriptor.mappednamespace = 'uri://1edtech.org/oneroster12/CalendarEventDescriptor'
        WHERE mappedeventdescriptor.mappedvalue = 'TRUE'
        GROUP BY cd.schoolid, cd.schoolyear, cd.calendarcode
    ),
    summarize_school_year AS (
        SELECT
            sch.localEducationAgencyId,
            cal.schoolyear,
            (SELECT TOP 1 first_school_day
             FROM calendar_windows
             WHERE schoolyear = cal.schoolyear AND schoolid = sch.schoolid AND calendarcode IS NULL
             GROUP BY first_school_day
             ORDER BY COUNT(*) DESC) AS first_school_day,
            (SELECT TOP 1 last_school_day
             FROM calendar_windows
             WHERE schoolyear = cal.schoolyear AND schoolid = sch.schoolid AND calendarcode IS NULL
             GROUP BY last_school_day
             ORDER BY COUNT(*) DESC) AS last_school_day
        FROM calendar_windows cal
        JOIN edfi.school sch ON cal.schoolid = sch.schoolid
        WHERE cal.calendarcode IS NULL
        GROUP BY sch.localEducationAgencyId, cal.schoolyear
    ),
    create_school_year AS (
        SELECT
            CONVERT(NVARCHAR(64), LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(schoolyear AS NVARCHAR(16))), 2))) AS sourcedId,
            'active' AS status,
            NULL AS dateLastModified,
            CAST(schoolyear - 1 AS NVARCHAR(4)) + '-' + CAST(schoolyear AS NVARCHAR(4)) AS title,
            'schoolYear' AS type,
            CONVERT(NVARCHAR(32), first_school_day, 120) AS startDate,
            CONVERT(NVARCHAR(32), last_school_day, 120) AS endDate,
            NULL AS parent,
            CAST(schoolyear AS NVARCHAR(16)) AS schoolYear,
            (SELECT 'edfi' AS [resource], 'schoolYearTypes' AS [resource], schoolyear AS [schoolYear] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
        FROM summarize_school_year
    ),
    sessions AS (
        SELECT ses.*, sch.localEducationAgencyid
        FROM edfi.session ses
        JOIN edfi.school sch ON ses.schoolid = sch.schoolid
    ),
    sessions_formatted AS (
        SELECT
            CONVERT(NVARCHAR(64), LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(schoolid AS NVARCHAR(16)) + '-' + sessionname), 2))) AS sourcedId,
            'active' AS status,
            sessions.lastmodifieddate AS dateLastModified,
            termdescriptor.codeValue AS title,
            mappedtermdescriptor.mappedvalue AS type,
            CONVERT(NVARCHAR(32), begindate, 120) AS startDate,
            CONVERT(NVARCHAR(32), enddate, 120) AS endDate,
            (SELECT '/academicSessions/' + CONVERT(NVARCHAR(64), LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(schoolyear AS NVARCHAR(16))), 2))) AS href,
                    CONVERT(NVARCHAR(64), LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(schoolyear AS NVARCHAR(16))), 2))) AS sourcedId,
                    'academicSession' AS type
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS parent,
            CAST(schoolyear AS NVARCHAR(16)) AS schoolYear,
            (SELECT 'edfi' AS [resource], 'sessions' AS [resource], schoolid AS [schoolId], sessionname AS [sessionName] FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
        FROM sessions
        JOIN edfi.descriptor termdescriptor ON sessions.termDescriptorId = termdescriptor.descriptorid
        JOIN edfi.descriptormapping mappedtermdescriptor ON mappedtermdescriptor.value = termdescriptor.codevalue
            AND mappedtermdescriptor.namespace = termdescriptor.namespace
            AND mappedtermdescriptor.mappednamespace = 'uri://1edtech.org/oneroster12/TermDescriptor'
    )
    INSERT INTO #staging_academicsessions
    SELECT * FROM create_school_year
    UNION ALL
    SELECT * FROM sessions_formatted;

    BEGIN TRANSACTION;
        TRUNCATE TABLE oneroster12.academicsessions;
        INSERT INTO oneroster12.academicsessions SELECT * FROM #staging_academicsessions;
    COMMIT TRANSACTION;

    DROP TABLE #staging_academicsessions;
END
```

### Index
```sql
CREATE INDEX academicsessions_sourcedid ON oneroster12.academicsessions (sourcedId);
```

## Usage
- Deploy the table and procedure in your MSSQL instance.
- Schedule the procedure via SQL Agent to run every 15 minutes.
- Query `oneroster12.academicsessions` for API responses as you would a materialized view.

---


### Light exploration of Advanced Approaches for Materialized View Emulation

### Incremental Refresh Example

```sql
-- Add a 'last_refreshed' column to track row updates
ALTER TABLE oneroster12.academicsessions ADD last_refreshed DATETIME NULL;

-- Example: Only update changed or new rows
CREATE PROCEDURE oneroster12.incremental_refresh_academicsessions AS
BEGIN
    -- Assume source tables have a 'lastmodifieddate' column
    MERGE oneroster12.academicsessions AS target
    USING (
        -- Your CTE logic here, e.g. create_school_year and sessions_formatted
        SELECT * FROM create_school_year
        UNION ALL
        SELECT * FROM sessions_formatted
    ) AS source
    ON target.sourcedId = source.sourcedId
    WHEN MATCHED AND (target.dateLastModified <> source.dateLastModified OR target.metadata <> source.metadata)
        THEN UPDATE SET
            target.status = source.status,
            target.dateLastModified = source.dateLastModified,
            target.title = source.title,
            target.type = source.type,
            target.startDate = source.startDate,
            target.endDate = source.endDate,
            target.parent = source.parent,
            target.schoolYear = source.schoolYear,
            target.metadata = source.metadata,
            target.last_refreshed = GETDATE()
    WHEN NOT MATCHED BY TARGET
        THEN INSERT (sourcedId, status, dateLastModified, title, type, startDate, endDate, parent, schoolYear, metadata, last_refreshed)
             VALUES (source.sourcedId, source.status, source.dateLastModified, source.title, source.type, source.startDate, source.endDate, source.parent, source.schoolYear, source.metadata, GETDATE());
    -- Optionally, delete rows no longer present in source
    -- WHEN NOT MATCHED BY SOURCE THEN DELETE;
END
```
**Notes:**  
- This approach only updates rows that have changed, reducing load.
- Requires reliable change tracking in source tables.

---

### Indexed View Example

```sql
-- Only possible if the view logic is simple (no aggregates, no JSON, no DISTINCT, etc.)
CREATE VIEW oneroster12.academicsessions_indexed
WITH SCHEMABINDING
AS
SELECT
    schoolid,
    schoolyear,
    -- Only deterministic expressions allowed
    -- No aggregates, no UNION, no JSON
    -- Example: a simple projection
    sessionname
FROM dbo.session;

-- Create a unique clustered index to materialize the view
CREATE UNIQUE CLUSTERED INDEX idx_academicsessions_indexed ON oneroster12.academicsessions_indexed (schoolid, schoolyear);
```
**Notes:**  
- Most OneRoster logic is too complex for indexed views.
- Use only for simple, high-performance needs.

---

### Hybrid Approach Example

```sql
-- Table for materialized data
CREATE TABLE oneroster12.academicsessions_materialized (...);

-- Regular view for near-real-time data
CREATE VIEW oneroster12.academicsessions_hybrid AS
SELECT * FROM oneroster12.academicsessions_materialized
UNION ALL
SELECT
    -- Live data for sessions not yet materialized
    ...
FROM dbo.session
WHERE session.lastmodifieddate > (SELECT MAX(last_refreshed) FROM oneroster12.academicsessions_materialized);
```
**Notes:**  
- Combines fast access to materialized data with up-to-date records from source tables.
- Useful if some API clients require the freshest data.


