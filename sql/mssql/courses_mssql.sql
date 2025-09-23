-- =============================================
-- MS SQL Server Setup for Courses
-- Creates table, indexes, and refresh procedure
-- Based on PostgreSQL courses materialized view
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Courses Table
-- =============================================
IF OBJECT_ID('oneroster12.courses', 'U') IS NOT NULL 
    DROP TABLE oneroster12.courses;
GO

CREATE TABLE oneroster12.courses (
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    schoolYear NVARCHAR(MAX) NULL, -- JSON object
    title NVARCHAR(256) NOT NULL,
    courseCode NVARCHAR(64) NULL,
    grades NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    subjects NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    org NVARCHAR(MAX) NULL, -- JSON
    subjectCodes NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Courses
-- =============================================

    ALTER TABLE oneroster12.courses ADD CONSTRAINT PK_courses PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on courses';

-- Unique index on sourcedId for lookups
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.courses') AND name = 'IX_courses_sourcedId')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_courses_sourcedId ON oneroster12.courses (sourcedId);
    PRINT '  ✓ Created IX_courses_sourcedId unique index on courses';
END;

-- Performance indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.courses') AND name = 'IX_courses_coursecode')
BEGIN
    CREATE NONCLUSTERED INDEX IX_courses_coursecode ON oneroster12.courses (courseCode) WHERE courseCode IS NOT NULL;
    PRINT '  ✓ Created IX_courses_coursecode on courses';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.courses') AND name = 'IX_courses_status')
BEGIN
    CREATE NONCLUSTERED INDEX IX_courses_status ON oneroster12.courses (status) INCLUDE (title, courseCode);
    PRINT '  ✓ Created IX_courses_status on courses';
END;
GO

IF OBJECT_ID('oneroster12.sp_refresh_courses', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_courses;
GO

CREATE PROCEDURE oneroster12.sp_refresh_courses
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
    VALUES ('courses', @StartTime, 'Running');
    
    DECLARE @HistoryID INT = SCOPE_IDENTITY();
    
    BEGIN TRY
        -- Create staging table
        IF OBJECT_ID('tempdb..#staging_courses') IS NOT NULL
            DROP TABLE #staging_courses;
            
        CREATE TABLE #staging_courses (
            sourcedId NVARCHAR(64) NOT NULL,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            schoolYear NVARCHAR(MAX) NULL, -- JSON object
            title NVARCHAR(256) NOT NULL,
            courseCode NVARCHAR(64) NULL,
            grades NVARCHAR(MAX) NULL,
            subjects NVARCHAR(MAX) NULL,
            org NVARCHAR(MAX) NULL,
            subjectCodes NVARCHAR(MAX) NULL,
            metadata NVARCHAR(MAX) NULL
        );
        
        -- Insert data into staging table following PostgreSQL pattern exactly
        WITH course AS (
            SELECT * FROM edfi.Course
        ),
        -- want courses defined by district, so grab this from offerings and reduce down
        course_leas AS (
            SELECT DISTINCT CourseCode, SchoolYear, s.LocalEducationAgencyId
            FROM edfi.CourseOffering co 
            JOIN edfi.School s ON co.SchoolId = s.SchoolId
        )
        INSERT INTO #staging_courses
        SELECT 
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                CAST(
                    CONCAT(CAST(course_leas.LocalEducationAgencyId AS VARCHAR(50)), '-', CAST(crs.CourseCode AS VARCHAR(50)))
                    AS VARCHAR(MAX)
                ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
            'active' AS status,
            crs.LastModifiedDate AS dateLastModified,
            (SELECT 
                CONCAT('/academicSessions/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(course_leas.SchoolYear AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(course_leas.SchoolYear AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'academicSession' AS type
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS schoolYear,
            crs.CourseTitle AS title,
            crs.CourseCode,
            NULL AS grades,
            NULL AS subjects,
            (SELECT 
                CONCAT('/orgs/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(course_leas.LocalEducationAgencyId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(course_leas.LocalEducationAgencyId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'org' AS type
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS org,
            NULL AS subjectCodes,
            (SELECT 
                'courses' AS [edfi.resource],
                course_leas.LocalEducationAgencyId AS [edfi.naturalKey.localEducationAgencyId],
                crs.CourseCode AS [edfi.naturalKey.courseCode]
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
        FROM course crs
        JOIN course_leas ON crs.CourseCode = course_leas.CourseCode
        ;
        
        SET @RowCount = @@ROWCOUNT;
        
        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.courses;
            
            INSERT INTO oneroster12.courses 
                (sourcedId, status, dateLastModified, schoolYear, title, courseCode, 
                 grades, subjects, org, subjectCodes, metadata)
            SELECT 
                sourcedId, status, dateLastModified, schoolYear, title, courseCode, 
                grades, subjects, org, subjectCodes, metadata
            FROM #staging_courses;
        COMMIT TRANSACTION;
        
        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;
        
        -- Clean up
        DROP TABLE #staging_courses;
        
        PRINT CONCAT('Courses refresh completed successfully. Rows: ', @RowCount);
        
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
            ('courses', @ErrorMessage, @ErrorSeverity, @ErrorState, 
             'sp_refresh_courses', ERROR_LINE());
        
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

PRINT 'Stored procedure oneroster12.sp_refresh_courses created successfully';
GO