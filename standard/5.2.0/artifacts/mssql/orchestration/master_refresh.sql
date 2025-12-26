-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- =============================================
-- MS SQL Server Master Refresh Procedure
-- Orchestrates refresh of all OneRoster tables in dependency order
-- =============================================

IF OBJECT_ID('oneroster12.sp_refresh_all', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_all;
GO

CREATE PROCEDURE oneroster12.sp_refresh_all
    @ForceRefresh BIT = 0,  -- Set to 1 to refresh even if recently completed
    @SkipOnError BIT = 0    -- Set to 1 to continue with remaining tables if one fails
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StartTime DATETIME2 = GETDATE();
    DECLARE @EndTime DATETIME2;
    DECLARE @TotalDuration INT;
    DECLARE @ErrorCount INT = 0;
    DECLARE @SuccessCount INT = 0;
    DECLARE @SkippedCount INT = 0;
    DECLARE @CurrentTable NVARCHAR(128);
    DECLARE @LastRefresh DATETIME2;
    DECLARE @MinutesSinceRefresh INT;

    -- Check if a full refresh was completed recently (within last 10 minutes)
    IF @ForceRefresh = 0
    BEGIN
        SELECT @LastRefresh = MAX(refresh_end)
        FROM oneroster12.refresh_history
        WHERE table_name = 'ALL_TABLES' AND status = 'Success';

        IF @LastRefresh IS NOT NULL
        BEGIN
            SET @MinutesSinceRefresh = DATEDIFF(MINUTE, @LastRefresh, GETDATE());
            IF @MinutesSinceRefresh < 10
            BEGIN
                PRINT 'Skipping refresh - completed ' + CAST(@MinutesSinceRefresh AS NVARCHAR(10)) + ' minutes ago. Use @ForceRefresh=1 to override.';
                RETURN;
            END
        END
    END

    -- Log start of master refresh
    INSERT INTO oneroster12.refresh_history (table_name, refresh_start, status)
    VALUES ('ALL_TABLES', @StartTime, 'Running');

    DECLARE @MasterHistoryID INT = SCOPE_IDENTITY();

    PRINT '=== OneRoster Master Refresh Started at ' + FORMAT(@StartTime, 'yyyy-MM-dd HH:mm:ss') + ' ===';

    -- Define refresh order based on dependencies
    DECLARE refresh_cursor CURSOR FOR
    SELECT table_name FROM (
        VALUES
            ('academicsessions'),   -- 1. Academic sessions (no dependencies)
            ('orgs'),              -- 2. Organizations (no dependencies)
            ('courses'),           -- 3. Courses (depends on orgs)
            ('classes'),           -- 4. Classes (depends on courses, orgs, academicsessions)
            ('demographics'),      -- 5. Demographics (no dependencies but related to users)
            ('users'),             -- 6. Users (depends on orgs, complex)
            ('enrollments')        -- 7. Enrollments (depends on classes, users)
    ) AS refresh_order(table_name);

    OPEN refresh_cursor;
    FETCH NEXT FROM refresh_cursor INTO @CurrentTable;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @ProcStartTime DATETIME2 = GETDATE();
        DECLARE @ProcName NVARCHAR(128) = 'oneroster12.sp_refresh_' + @CurrentTable;
        DECLARE @ErrorMessage NVARCHAR(4000);

        BEGIN TRY
            PRINT 'Refreshing ' + @CurrentTable + '...';

            -- Execute the refresh procedure dynamically
            DECLARE @SQL NVARCHAR(128) = 'EXEC ' + @ProcName;
            EXEC sp_executesql @SQL;

            SET @SuccessCount = @SuccessCount + 1;

            DECLARE @ProcDuration INT = DATEDIFF(SECOND, @ProcStartTime, GETDATE());
            PRINT '✓ ' + @CurrentTable + ' completed in ' + CAST(@ProcDuration AS NVARCHAR(10)) + ' seconds';

        END TRY
        BEGIN CATCH
            SET @ErrorCount = @ErrorCount + 1;
            SET @ErrorMessage = ERROR_MESSAGE();

            PRINT '✗ Error refreshing ' + @CurrentTable + ': ' + @ErrorMessage;

            -- Log the error
            INSERT INTO oneroster12.refresh_errors
                (table_name, error_message, error_severity, error_state, error_procedure, error_line)
            VALUES
                (@CurrentTable, @ErrorMessage, ERROR_SEVERITY(), ERROR_STATE(),
                 'sp_refresh_all', ERROR_LINE());

            -- If not skipping on error, abort the entire refresh
            IF @SkipOnError = 0
            BEGIN
                CLOSE refresh_cursor;
                DEALLOCATE refresh_cursor;

                -- Update master history with failure
                UPDATE oneroster12.refresh_history
                SET refresh_end = GETDATE(),
                    status = 'Failed'
                WHERE history_id = @MasterHistoryID;

                RAISERROR('Master refresh failed. See refresh_errors table for details.', 16, 1);
                RETURN;
            END
            ELSE
            BEGIN
                SET @SkippedCount = @SkippedCount + 1;
                PRINT 'Continuing with next table due to @SkipOnError=1';
            END
        END CATCH

        FETCH NEXT FROM refresh_cursor INTO @CurrentTable;
    END

    CLOSE refresh_cursor;
    DEALLOCATE refresh_cursor;

    SET @EndTime = GETDATE();
    SET @TotalDuration = DATEDIFF(SECOND, @StartTime, @EndTime);

    -- Determine overall status
    DECLARE @OverallStatus NVARCHAR(20);
    IF @ErrorCount = 0
        SET @OverallStatus = 'Success';
    ELSE IF @SuccessCount > 0
        SET @OverallStatus = 'Partial Success';
    ELSE
        SET @OverallStatus = 'Failed';

    -- Update master history
    UPDATE oneroster12.refresh_history
    SET refresh_end = @EndTime,
        status = @OverallStatus,
        row_count = @SuccessCount -- Using row_count to store success count
    WHERE history_id = @MasterHistoryID;

    -- Print summary
    PRINT '=== Master Refresh Summary ===';
    PRINT 'Overall Status: ' + @OverallStatus;
    PRINT 'Total Duration: ' + CAST(@TotalDuration AS NVARCHAR(10)) + ' seconds';
    PRINT 'Tables Succeeded: ' + CAST(@SuccessCount AS NVARCHAR(10));
    PRINT 'Tables Failed: ' + CAST(@ErrorCount AS NVARCHAR(10));
    PRINT 'Tables Skipped: ' + CAST(@SkippedCount AS NVARCHAR(10));
    PRINT 'Completed at: ' + FORMAT(@EndTime, 'yyyy-MM-dd HH:mm:ss');

    -- Show current row counts
    PRINT '';
    PRINT '=== Current Row Counts ===';

    DECLARE @RowCountQuery NVARCHAR(MAX) = '';
    SELECT @RowCountQuery = @RowCountQuery +
        'SELECT ''' + table_name + ''' AS TableName, COUNT(*) AS RowCount FROM oneroster12.' + table_name +
        CASE WHEN ROW_NUMBER() OVER (ORDER BY table_name) < 7 THEN ' UNION ALL ' ELSE '' END
    FROM (VALUES
        ('academicsessions'), ('classes'), ('courses'), ('demographics'),
        ('enrollments'), ('orgs'), ('users')
    ) AS tables(table_name);

    EXEC sp_executesql @RowCountQuery;

    IF @ErrorCount > 0
    BEGIN
        PRINT '';
        PRINT '=== Recent Errors ===';
        SELECT TOP 5
            table_name,
            error_date,
            error_message
        FROM oneroster12.refresh_errors
        WHERE error_date >= @StartTime
        ORDER BY error_date DESC;
    END

    PRINT '=== OneRoster Master Refresh Completed at ' + FORMAT(@EndTime, 'yyyy-MM-dd HH:mm:ss') + ' ===';
END
GO

-- Helper procedure to check refresh status
IF OBJECT_ID('oneroster12.sp_refresh_status', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_status;
GO

CREATE PROCEDURE oneroster12.sp_refresh_status
    @DaysBack INT = 1
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @SinceDate DATETIME2 = DATEADD(DAY, -@DaysBack, GETDATE());

    PRINT '=== Refresh Status (Last ' + CAST(@DaysBack AS NVARCHAR(10)) + ' Days) ===';

    -- Recent refresh history
    SELECT
        table_name AS [Table],
        refresh_start AS [Started],
        refresh_end AS [Ended],
        status AS [Status],
        row_count AS [Rows/Success Count],
        duration_seconds AS [Duration (sec)]
    FROM oneroster12.refresh_history
    WHERE refresh_start >= @SinceDate
    ORDER BY refresh_start DESC;

    -- Error summary
    SELECT
        table_name AS [Table],
        COUNT(*) AS [Error Count],
        MAX(error_date) AS [Last Error]
    FROM oneroster12.refresh_errors
    WHERE error_date >= @SinceDate
    GROUP BY table_name
    ORDER BY COUNT(*) DESC;

    -- Current row counts
    PRINT '';
    PRINT '=== Current Row Counts ===';

    DECLARE @RowCountQuery NVARCHAR(MAX) = '';
    SELECT @RowCountQuery = @RowCountQuery +
        'SELECT ''' + table_name + ''' AS TableName, COUNT(*) AS RowCount FROM oneroster12.' + table_name +
        CASE WHEN ROW_NUMBER() OVER (ORDER BY table_name) < 7 THEN ' UNION ALL ' ELSE '' END
    FROM (VALUES
        ('academicsessions'), ('classes'), ('courses'), ('demographics'),
        ('enrollments'), ('orgs'), ('users')
    ) AS tables(table_name);

    EXEC sp_executesql @RowCountQuery;
END
GO

PRINT 'Master refresh procedures created successfully';
PRINT 'Usage:';
PRINT '  EXEC oneroster12.sp_refresh_all;                    -- Normal refresh';
PRINT '  EXEC oneroster12.sp_refresh_all @ForceRefresh=1;    -- Force refresh even if recent';
PRINT '  EXEC oneroster12.sp_refresh_all @SkipOnError=1;     -- Continue on errors';
PRINT '  EXEC oneroster12.sp_refresh_status;                 -- Check status';
GO
