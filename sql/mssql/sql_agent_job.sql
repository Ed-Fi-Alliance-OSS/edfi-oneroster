-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- =============================================
-- SQL Server Agent Job for OneRoster 1.2 Data Refresh
-- Automated daily refresh with error handling
-- =============================================

USE [msdb];
GO

-- Create OneRoster refresh job
DECLARE @JobName NVARCHAR(128) = 'OneRoster 1.2 Daily Refresh';
DECLARE @JobDescription NVARCHAR(512) = 'Daily automated refresh of all OneRoster 1.2 tables from Ed-Fi ODS';
DECLARE @DatabaseName SYSNAME = DB_NAME(); -- Current database

-- Delete existing job if it exists
IF EXISTS (SELECT job_id FROM msdb.dbo.sysjobs WHERE name = @JobName)
BEGIN
    PRINT 'Removing existing job: ' + @JobName;
    EXEC msdb.dbo.sp_delete_job @job_name = @JobName, @delete_unused_schedule = 1;
END;

PRINT 'Creating SQL Server Agent job: ' + @JobName;

-- Create the job
EXEC msdb.dbo.sp_add_job
    @job_name = @JobName,
    @enabled = 1,
    @description = @JobDescription,
    @start_step_id = 1,
    @category_name = N'Data Collector',
    @owner_login_name = NULL; -- Uses SQL Server Agent service account

-- Add job step for OneRoster refresh
EXEC msdb.dbo.sp_add_jobstep
    @job_name = @JobName,
    @step_name = N'Refresh OneRoster Data',
    @step_id = 1,
    @cmdexec_success_code = 0,
    @on_success_action = 3, -- Go to next step
    @on_fail_action = 2,    -- Quit with failure
    @retry_attempts = 2,
    @retry_interval = 5,    -- 5 minutes
    @os_run_priority = 0,
    @subsystem = N'TSQL',
    @command = N'
-- OneRoster 1.2 Daily Data Refresh
-- Executes all procedures in correct order with comprehensive logging
SET NOCOUNT ON;

DECLARE @StartTime DATETIME2 = GETDATE();
DECLARE @JobRunId UNIQUEIDENTIFIER = NEWID();

PRINT ''=== OneRoster 1.2 Automated Refresh Started ==='';
PRINT ''Job Run ID: '' + CAST(@JobRunId AS NVARCHAR(50));
PRINT ''Start Time: '' + CONVERT(NVARCHAR(50), @StartTime, 121);
PRINT '''';

BEGIN TRY
    -- Execute master refresh procedure
    EXEC oneroster12.sp_refresh_all;

    -- Log successful completion
    PRINT '''';
    PRINT ''✓ OneRoster refresh completed successfully'';
    PRINT ''Duration: '' + CAST(DATEDIFF(SECOND, @StartTime, GETDATE()) AS NVARCHAR(10)) + '' seconds'';

END TRY
BEGIN CATCH
    DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrorState INT = ERROR_STATE();

    -- Log error details
    PRINT '''';
    PRINT ''❌ OneRoster refresh FAILED'';
    PRINT ''Error: '' + @ErrorMessage;
    PRINT ''Duration: '' + CAST(DATEDIFF(SECOND, @StartTime, GETDATE()) AS NVARCHAR(10)) + '' seconds'';

    -- Re-raise the error to fail the job
    RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;
',
    @database_name = @DatabaseName;

-- Add success notification step
EXEC msdb.dbo.sp_add_jobstep
    @job_name = @JobName,
    @step_name = N'Log Success',
    @step_id = 2,
    @cmdexec_success_code = 0,
    @on_success_action = 1, -- Quit with success
    @on_fail_action = 2,    -- Quit with failure
    @retry_attempts = 0,
    @subsystem = N'TSQL',
    @command = N'
-- Log successful job completion
PRINT ''OneRoster 1.2 refresh job completed successfully at '' + CONVERT(NVARCHAR(50), GETDATE(), 121);

-- Optional: Insert into custom job log table if you have one
-- INSERT INTO oneroster12.job_log (job_name, status, run_date, duration)
-- VALUES (''OneRoster 1.2 Daily Refresh'', ''Success'', GETDATE(), DATEDIFF(SECOND, @StartTime, GETDATE()));
',
    @database_name = @DatabaseName;

-- Create schedule: Daily at 2:00 AM
DECLARE @ScheduleName NVARCHAR(128) = @JobName + ' - Daily 2AM';

EXEC msdb.dbo.sp_add_schedule
    @schedule_name = @ScheduleName,
    @enabled = 1,
    @freq_type = 4,         -- Daily
    @freq_interval = 1,     -- Every day
    @freq_subday_type = 1,  -- At the specified time
    @freq_subday_interval = 0,
    @freq_relative_interval = 0,
    @freq_recurrence_factor = 0,
    @active_start_date = 20250910, -- Today's date (YYYYMMDD)
    @active_end_date = 99991231,   -- Far future
    @active_start_time = 020000,   -- 2:00:00 AM
    @active_end_time = 235959;     -- 11:59:59 PM

-- Attach schedule to job
EXEC msdb.dbo.sp_attach_schedule
    @job_name = @JobName,
    @schedule_name = @ScheduleName;

-- Add job to local server
EXEC msdb.dbo.sp_add_jobserver
    @job_name = @JobName,
    @server_name = N'(LOCAL)';

PRINT '';
PRINT '✓ SQL Server Agent job created successfully!';
PRINT '';
PRINT 'Job Details:';
PRINT '  Name: ' + @JobName;
PRINT '  Schedule: Daily at 2:00 AM';
PRINT '  Database: ' + @DatabaseName;
PRINT '  Owner: SQL Server Agent service account';
PRINT '';
PRINT 'Management Commands:';
PRINT '  -- Run job manually:';
PRINT '  EXEC msdb.dbo.sp_start_job @job_name = ''' + @JobName + ''';';
PRINT '';
PRINT '  -- Check job status:';
PRINT '  SELECT job_id, name, enabled, date_created, date_modified';
PRINT '  FROM msdb.dbo.sysjobs WHERE name = ''' + @JobName + ''';';
PRINT '';
PRINT '  -- View job history:';
PRINT '  EXEC msdb.dbo.sp_help_jobhistory @job_name = ''' + @JobName + ''';';
PRINT '';
PRINT '  -- Disable/Enable job:';
PRINT '  EXEC msdb.dbo.sp_update_job @job_name = ''' + @JobName + ''', @enabled = 0; -- Disable';
PRINT '  EXEC msdb.dbo.sp_update_job @job_name = ''' + @JobName + ''', @enabled = 1; -- Enable';

GO

-- Test the job by running it once manually (optional)
PRINT '';
PRINT 'Testing job execution...';
EXEC msdb.dbo.sp_start_job @job_name = 'OneRoster 1.2 Daily Refresh';

-- Wait a moment and check results
WAITFOR DELAY '00:00:05'; -- Wait 5 seconds

-- Show recent job execution results
SELECT TOP 3
    j.name AS job_name,
    h.step_name,
    CASE h.run_status
        WHEN 0 THEN 'Failed'
        WHEN 1 THEN 'Succeeded'
        WHEN 2 THEN 'Retry'
        WHEN 3 THEN 'Canceled'
        WHEN 4 THEN 'In Progress'
    END AS run_status,
    CONVERT(VARCHAR(20),
        CAST(STR(h.run_date) AS DATETIME) +
        CAST(STUFF(STUFF(RIGHT('000000' + CAST(h.run_time AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':') AS DATETIME)
    ) AS run_datetime,
    RIGHT('00' + CAST(h.run_duration / 10000 AS VARCHAR(2)), 2) + ':' +
    RIGHT('00' + CAST((h.run_duration % 10000) / 100 AS VARCHAR(2)), 2) + ':' +
    RIGHT('00' + CAST(h.run_duration % 100 AS VARCHAR(2)), 2) AS duration
FROM msdb.dbo.sysjobs j
INNER JOIN msdb.dbo.sysjobhistory h ON j.job_id = h.job_id
WHERE j.name = 'OneRoster 1.2 Daily Refresh'
ORDER BY h.run_date DESC, h.run_time DESC;

PRINT '';
PRINT 'OneRoster 1.2 SQL Server Agent job setup complete!';
GO
