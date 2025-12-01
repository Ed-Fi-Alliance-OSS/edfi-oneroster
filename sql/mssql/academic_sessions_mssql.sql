-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- =============================================
-- MS SQL Server Setup for Academic Sessions
-- Creates table, indexes, and refresh procedure
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Academic Sessions Table
-- =============================================
IF OBJECT_ID('oneroster12.academicsessions', 'U') IS NOT NULL
    DROP TABLE oneroster12.academicsessions;
GO

CREATE TABLE oneroster12.academicsessions (
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    title NVARCHAR(256) NOT NULL,
    type NVARCHAR(32) NOT NULL,
    startDate NVARCHAR(32) NULL,
    endDate NVARCHAR(32) NULL,
    parent NVARCHAR(MAX) NULL, -- JSON
    schoolYear NVARCHAR(16) NULL,
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Academic Sessions
-- =============================================

    ALTER TABLE oneroster12.academicsessions ADD CONSTRAINT PK_academicsessions PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on academicsessions';

-- Unique index on sourcedId for lookups
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.academicsessions') AND name = 'IX_academicsessions_sourcedId')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_academicsessions_sourcedId ON oneroster12.academicsessions (sourcedId);
    PRINT '  ✓ Created IX_academicsessions_sourcedId unique index on academicsessions';
END;

-- Additional indexes for common access patterns
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.academicsessions') AND name = 'IX_academicsessions_type_year')
BEGIN
    CREATE INDEX IX_academicsessions_type_year ON oneroster12.academicsessions (type, schoolYear);
    PRINT '  ✓ Created IX_academicsessions_type_year index on academicsessions';
END;

-- Primary access patterns: by type, by parent, by date ranges
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.academicsessions') AND name = 'IX_academicsessions_type_dates')
BEGIN
    CREATE NONCLUSTERED INDEX IX_academicsessions_type_dates ON oneroster12.academicsessions (type, startDate, endDate) INCLUDE (title);
    PRINT '  ✓ Created IX_academicsessions_type_dates on academicsessions';
END;
GO

IF OBJECT_ID('oneroster12.sp_refresh_academicsessions', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_academicsessions;
GO

CREATE PROCEDURE oneroster12.sp_refresh_academicsessions
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StartTime DATETIME2 = GETDATE();
    DECLARE @RowCount INT;
    DECLARE @ErrorMessage NVARCHAR(4000);
    DECLARE @ErrorSeverity INT;
    DECLARE @ErrorState INT;

    -- Log start of refresh
    INSERT INTO oneroster12.refresh_history (table_name, refresh_start, status)
    VALUES ('academicsessions', @StartTime, 'Running');

    DECLARE @HistoryID INT = SCOPE_IDENTITY();

    BEGIN TRY
        -- Create staging table
        IF OBJECT_ID('tempdb..#staging_academicsessions') IS NOT NULL
            DROP TABLE #staging_academicsessions;

        CREATE TABLE #staging_academicsessions (
            sourcedId NVARCHAR(64) NOT NULL,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            title NVARCHAR(256) NOT NULL,
            type NVARCHAR(32) NOT NULL,
            startDate NVARCHAR(32) NULL,
            endDate NVARCHAR(32) NULL,
            parent NVARCHAR(MAX) NULL,
            schoolYear NVARCHAR(16) NULL,
            metadata NVARCHAR(MAX) NULL
        );

        -- Insert data into staging table
        WITH sessions AS (
            SELECT ses.*, sch.localEducationAgencyid
            FROM edfi.session ses
            JOIN edfi.school sch ON ses.schoolid = sch.schoolid
        ),
        calendar_windows AS (
            SELECT
                cd.schoolid,
                cd.schoolyear,
                cd.calendarcode,
                MIN(cd.date) AS first_school_day,
                MAX(cd.date) AS last_school_day
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
            WHERE mappedeventdescriptor.mappedvalue = 'TRUE' -- IS a school/instructional day
            GROUP BY cd.schoolid, cd.schoolyear, cd.calendarcode
        ),
        -- Using separate queries for GROUPING SETS equivalent
        calendar_school_level AS (
            SELECT schoolid, schoolyear, NULL as calendarcode,
                   MIN(first_school_day) as first_school_day,
                   MAX(last_school_day) as last_school_day
            FROM calendar_windows
            GROUP BY schoolid, schoolyear
        ),
        calendar_all AS (
            SELECT * FROM calendar_windows
            UNION ALL
            SELECT * FROM calendar_school_level
        ),
        summarize_school_year AS (
            SELECT
                sch.localEducationAgencyId,
                cal.schoolyear,
                -- Mode calculation using TOP 1 and COUNT
                (SELECT TOP 1 first_school_day
                 FROM calendar_all c2
                 JOIN edfi.school s2 ON c2.schoolid = s2.schoolid
                 WHERE c2.schoolyear = cal.schoolyear
                   AND s2.localEducationAgencyId = sch.localEducationAgencyId
                   AND c2.calendarcode IS NULL
                 GROUP BY first_school_day
                 ORDER BY COUNT(*) DESC) AS first_school_day,
                (SELECT TOP 1 last_school_day
                 FROM calendar_all c2
                 JOIN edfi.school s2 ON c2.schoolid = s2.schoolid
                 WHERE c2.schoolyear = cal.schoolyear
                   AND s2.localEducationAgencyId = sch.localEducationAgencyId
                   AND c2.calendarcode IS NULL
                 GROUP BY last_school_day
                 ORDER BY COUNT(*) DESC) AS last_school_day
            FROM calendar_all cal
            JOIN edfi.school sch ON cal.schoolid = sch.schoolid
            WHERE cal.calendarcode IS NULL
            GROUP BY sch.localEducationAgencyId, cal.schoolyear
        ),
        create_school_year AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(ssy.schoolyear AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                MAX(ses.lastmodifieddate) AS dateLastModified,
                CONCAT(CAST(ssy.schoolyear - 1 AS NVARCHAR(4)), '-', CAST(ssy.schoolyear AS NVARCHAR(4))) AS title,
                'schoolYear' AS type,
                CONVERT(NVARCHAR(32), ssy.first_school_day, 23) AS startDate, -- ISO format YYYY-MM-DD
                CONVERT(NVARCHAR(32), ssy.last_school_day, 23) AS endDate,
                NULL AS parent,
                CAST(ssy.schoolyear AS NVARCHAR(16)) AS schoolYear,
                (SELECT
                    'schoolYearTypes' AS [edfi.resource],
                    ssy.schoolyear AS [edfi.naturalKey.schoolYear]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM summarize_school_year ssy
            LEFT JOIN sessions ses
                ON ses.schoolyear = ssy.schoolyear
                AND ses.localEducationAgencyid = ssy.localEducationAgencyId
            GROUP BY ssy.localEducationAgencyId, ssy.schoolyear, ssy.first_school_day, ssy.last_school_day
        ),
        sessions_formatted AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                    CAST(
                        CONCAT(CAST(schoolid AS VARCHAR(50)), '-', sessionname)
                        AS VARCHAR(MAX)
                    ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                sessions.lastmodifieddate AS dateLastModified,
                termdescriptor.codeValue AS title,
                mappedtermdescriptor.mappedvalue AS type,
                CONVERT(NVARCHAR(32), begindate, 23) AS startDate,
                CONVERT(NVARCHAR(32), enddate, 23) AS endDate,
                (SELECT
                    CONCAT('/academicSessions/', LOWER(CONVERT(VARCHAR(32),
                        HASHBYTES('MD5', CAST(schoolyear AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(schoolyear AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'academicSession' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS parent,
                CAST(schoolyear AS NVARCHAR(16)) AS schoolYear,
                (SELECT
                    'sessions' AS [edfi.resource],
                    schoolid AS [edfi.naturalKey.schoolId],
                    sessionname AS [edfi.naturalKey.sessionName]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM sessions
            JOIN edfi.descriptor termdescriptor
                ON sessions.termDescriptorId = termdescriptor.descriptorid
            JOIN edfi.descriptormapping mappedtermdescriptor
                ON mappedtermdescriptor.value = termdescriptor.codevalue
                AND mappedtermdescriptor.namespace = termdescriptor.namespace
                AND mappedtermdescriptor.mappednamespace = 'uri://1edtech.org/oneroster12/TermDescriptor'
        )
        INSERT INTO #staging_academicsessions
        SELECT
            sourcedId, status, dateLastModified, title, type, startDate, endDate, parent, schoolYear, metadata
        FROM create_school_year
        UNION ALL
        SELECT
            sourcedId, status, dateLastModified, title, type, startDate, endDate, parent, schoolYear, metadata
        FROM sessions_formatted
        ;

        SET @RowCount = @@ROWCOUNT;

        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.academicsessions;

            INSERT INTO oneroster12.academicsessions
                (sourcedId, status, dateLastModified, title, type, startDate,
                 endDate, parent, schoolYear, metadata)
            SELECT
                sourcedId, status, dateLastModified, title, type, startDate,
                endDate, parent, schoolYear, metadata
            FROM #staging_academicsessions;
        COMMIT TRANSACTION;

        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;

        -- Clean up
        DROP TABLE #staging_academicsessions;

        PRINT CONCAT('Academic sessions refresh completed successfully. Rows: ', @RowCount);

    END TRY
    BEGIN CATCH
        -- Rollback if transaction is open
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        SELECT
            @ErrorMessage = ERROR_MESSAGE(),
            @ErrorSeverity = ERROR_SEVERITY(),
            @ErrorState = ERROR_STATE();

        -- Log error
        INSERT INTO oneroster12.refresh_errors
            (table_name, error_message, error_severity, error_state, error_procedure, error_line)
        VALUES
            ('academicsessions', @ErrorMessage, @ErrorSeverity, @ErrorState,
             'sp_refresh_academicsessions', ERROR_LINE());

        -- Update history with failure
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Failed'
        WHERE history_id = @HistoryID;

        -- Re-raise error
        RAISERROR (@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT 'Stored procedure oneroster12.sp_refresh_academicsessions created successfully';
GO
