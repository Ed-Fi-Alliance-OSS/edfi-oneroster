-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- =============================================
-- MS SQL Server Setup for Enrollments
-- Creates table, indexes, and refresh procedure
-- Based on PostgreSQL enrollments materialized view
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Enrollments Table
-- =============================================
IF OBJECT_ID('oneroster12.enrollments', 'U') IS NOT NULL
    DROP TABLE oneroster12.enrollments;
GO

CREATE TABLE oneroster12.enrollments (
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    class NVARCHAR(MAX) NULL, -- JSON
    school NVARCHAR(MAX) NULL, -- JSON
    [user] NVARCHAR(MAX) NULL, -- JSON (note: 'user' is escaped as it's a reserved word)
    role NVARCHAR(32) NULL,
    [primary] NVARCHAR(8) NULL, -- 'primary' is a reserved word, OneRoster spec requires string
    beginDate NVARCHAR(32) NULL,
    endDate NVARCHAR(32) NULL,
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Enrollments
-- =============================================

    ALTER TABLE oneroster12.enrollments ADD CONSTRAINT PK_enrollments PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on enrollments';

-- Unique index on sourcedId for lookups
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.enrollments') AND name = 'IX_enrollments_sourcedId')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_enrollments_sourcedId ON oneroster12.enrollments (sourcedId);
    PRINT '  ✓ Created IX_enrollments_sourcedId unique index on enrollments';
END;


-- Primary access patterns: by role, by status, by dates
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.enrollments') AND name = 'IX_enrollments_status_role')
BEGIN
    CREATE INDEX IX_enrollments_status_role ON oneroster12.enrollments (status, role);
    PRINT '  ✓ Created IX_enrollments_status_role on enrollments';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.enrollments') AND name = 'IX_enrollments_dates')
BEGIN
    CREATE INDEX IX_enrollments_dates ON oneroster12.enrollments (beginDate, endDate)
    WHERE beginDate IS NOT NULL;
    PRINT '  ✓ Created IX_enrollments_dates on enrollments';
END;

-- API performance index for filtering
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.enrollments') AND name = 'IX_enrollments_api_status_filter')
BEGIN
    CREATE INDEX IX_enrollments_api_status_filter ON oneroster12.enrollments (status, dateLastModified) INCLUDE (role);
    PRINT '  ✓ Created IX_enrollments_api_status_filter on enrollments';
END;
GO

IF OBJECT_ID('oneroster12.sp_refresh_enrollments', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_enrollments;
GO

CREATE PROCEDURE oneroster12.sp_refresh_enrollments
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
    VALUES ('enrollments', @StartTime, 'Running');

    DECLARE @HistoryID INT = SCOPE_IDENTITY();

    BEGIN TRY
        -- Create staging table
        IF OBJECT_ID('tempdb..#staging_enrollments') IS NOT NULL
            DROP TABLE #staging_enrollments;

        CREATE TABLE #staging_enrollments (
            sourcedId NVARCHAR(64) NOT NULL,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            class NVARCHAR(MAX) NULL,
            school NVARCHAR(MAX) NULL,
            [user] NVARCHAR(MAX) NULL,
            role NVARCHAR(32) NULL,
            [primary] NVARCHAR(8) NULL,
            beginDate NVARCHAR(32) NULL,
            endDate NVARCHAR(32) NULL,
            metadata NVARCHAR(MAX) NULL
        );

        -- Insert data into staging table following PostgreSQL pattern exactly
        WITH staff_section_associations AS (
            SELECT * FROM edfi.StaffSectionAssociation
        ),
        student_section_associations AS (
            SELECT * FROM edfi.StudentSectionAssociation
        ),
        sections AS (
            SELECT * FROM edfi.Section
        ),
        staff_enrollments_formatted AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                    CAST(
                        CONCAT(LOWER(staff.StaffUniqueId), '-', LOWER(sections.LocalCourseCode), '-',
                               CAST(sections.SchoolId AS VARCHAR(50)), '-', LOWER(sections.SectionIdentifier), '-',
                               LOWER(sections.SessionName), '-', CONVERT(VARCHAR(32), ssa.BeginDate, 23))
                        AS VARCHAR(MAX)
                    ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                ssa.LastModifiedDate AS dateLastModified,
                (SELECT
                    CONCAT('/classes/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                        CAST(
                            CONCAT(LOWER(sections.LocalCourseCode), '-', CAST(sections.SchoolId AS VARCHAR(50)),
                                   '-', LOWER(sections.SectionIdentifier), '-', LOWER(sections.SessionName))
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                        CAST(
                            CONCAT(LOWER(sections.LocalCourseCode), '-', CAST(sections.SchoolId AS VARCHAR(50)),
                                   '-', LOWER(sections.SectionIdentifier), '-', LOWER(sections.SessionName))
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'class' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS class,
                (SELECT
                    CONCAT('/orgs/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(sections.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(sections.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'org' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS school,
                (SELECT
                    CONCAT('/users/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(staff.StaffUniqueId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(staff.StaffUniqueId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'user' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS [user],
                'teacher' AS role,
                'false' AS [primary],
                CONVERT(NVARCHAR(32), ssa.BeginDate, 23) AS beginDate,
                CONVERT(NVARCHAR(32), ssa.EndDate, 23) AS endDate,
                (SELECT
                    'staffSectionAssociations' AS [edfi.resource],
                    staff.StaffUniqueId AS [edfi.naturalKey.staffUniqueId],
                    sections.LocalCourseCode AS [edfi.naturalKey.localCourseCode],
                    sections.SchoolId AS [edfi.naturalKey.schoolId],
                    sections.SectionIdentifier AS [edfi.naturalKey.sectionIdentifier],
                    sections.SessionName AS [edfi.naturalKey.sessionName],
                    ssa.BeginDate AS [edfi.naturalKey.beginDate]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM staff_section_associations ssa
            JOIN edfi.Staff staff ON ssa.StaffUSI = staff.StaffUSI
            JOIN sections ON ssa.SectionIdentifier = sections.SectionIdentifier
                AND ssa.LocalCourseCode = sections.LocalCourseCode
                AND ssa.SchoolId = sections.SchoolId
                AND ssa.SchoolYear = sections.SchoolYear
                AND ssa.SessionName = sections.SessionName
        ),
        student_enrollments_formatted AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                    CAST(
                        CONCAT(LOWER(student.StudentUniqueId), '-', LOWER(sections.LocalCourseCode), '-',
                               CAST(sections.SchoolId AS VARCHAR(50)), '-', LOWER(sections.SectionIdentifier), '-',
                               LOWER(sections.SessionName), '-', CONVERT(VARCHAR(32), ssa.BeginDate, 23))
                        AS VARCHAR(MAX)
                    ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                ssa.LastModifiedDate AS dateLastModified,
                (SELECT
                    CONCAT('/classes/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                        CAST(
                            CONCAT(LOWER(sections.LocalCourseCode), '-', CAST(sections.SchoolId AS VARCHAR(50)),
                                   '-', LOWER(sections.SectionIdentifier), '-', LOWER(sections.SessionName))
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5',
                        CAST(
                            CONCAT(LOWER(sections.LocalCourseCode), '-', CAST(sections.SchoolId AS VARCHAR(50)),
                                   '-', LOWER(sections.SectionIdentifier), '-', LOWER(sections.SessionName))
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'class' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS class,
                (SELECT
                    CONCAT('/orgs/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(sections.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(sections.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'org' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS school,
                (SELECT
                    CONCAT('/users/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(student.StudentUniqueId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(student.StudentUniqueId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'user' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS [user],
                'student' AS role,
                'false' AS [primary],
                CONVERT(NVARCHAR(32), ssa.BeginDate, 23) AS beginDate,
                CONVERT(NVARCHAR(32), ssa.EndDate, 23) AS endDate,
                (SELECT
                    'studentSectionAssociations' AS [edfi.resource],
                    student.StudentUniqueId AS [edfi.naturalKey.studentUniqueId],
                    sections.LocalCourseCode AS [edfi.naturalKey.localCourseCode],
                    sections.SchoolId AS [edfi.naturalKey.schoolId],
                    sections.SectionIdentifier AS [edfi.naturalKey.sectionIdentifier],
                    sections.SessionName AS [edfi.naturalKey.sessionName],
                    ssa.BeginDate AS [edfi.naturalKey.beginDate]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM student_section_associations ssa
            JOIN edfi.Student student ON ssa.StudentUSI = student.StudentUSI
            JOIN sections ON ssa.SectionIdentifier = sections.SectionIdentifier
                AND ssa.LocalCourseCode = sections.LocalCourseCode
                AND ssa.SchoolId = sections.SchoolId
                AND ssa.SchoolYear = sections.SchoolYear
                AND ssa.SessionName = sections.SessionName
        )
        INSERT INTO #staging_enrollments
        SELECT * FROM staff_enrollments_formatted
        UNION ALL
        SELECT * FROM student_enrollments_formatted;

        SET @RowCount = @@ROWCOUNT;

        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.enrollments;

            INSERT INTO oneroster12.enrollments
                (sourcedId, status, dateLastModified, class, school, [user],
                 role, [primary], beginDate, endDate, metadata)
            SELECT
                sourcedId, status, dateLastModified, class, school, [user],
                role, [primary], beginDate, endDate, metadata
            FROM #staging_enrollments;
        COMMIT TRANSACTION;

        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;

        -- Clean up
        DROP TABLE #staging_enrollments;

        PRINT CONCAT('Enrollments refresh completed successfully. Rows: ', @RowCount);

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
            ('enrollments', @ErrorMessage, @ErrorSeverity, @ErrorState,
             'sp_refresh_enrollments', ERROR_LINE());

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

PRINT 'Stored procedure oneroster12.sp_refresh_enrollments created successfully';
GO
