-- =============================================
-- MS SQL Server Setup for Classes
-- Creates table, indexes, and refresh procedure
-- Based on PostgreSQL classes materialized view
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Classes Table
-- =============================================
IF OBJECT_ID('oneroster12.classes', 'U') IS NOT NULL 
    DROP TABLE oneroster12.classes;
GO

CREATE TABLE oneroster12.classes (
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    title NVARCHAR(256) NOT NULL,
    classCode NVARCHAR(64) NULL,
    classType NVARCHAR(32) NULL,
    location NVARCHAR(256) NULL,
    grades NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    subjects NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    course NVARCHAR(MAX) NULL, -- JSON
    school NVARCHAR(MAX) NULL, -- JSON
    terms NVARCHAR(MAX) NULL, -- JSON array
    subjectCodes NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    periods NVARCHAR(MAX) NULL, -- comma-separated
    resources NVARCHAR(MAX) NULL, -- JSON array
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Classes
-- =============================================

    ALTER TABLE oneroster12.classes ADD CONSTRAINT PK_classes PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on classes';

-- Unique index on sourcedId for lookups
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.classes') AND name = 'IX_classes_sourcedId')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_classes_sourcedId ON oneroster12.classes (sourcedId);
    PRINT '  ✓ Created IX_classes_sourcedId unique index on classes';
END;

-- API performance index for filtering
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.classes') AND name = 'IX_classes_status_type')
BEGIN
    CREATE NONCLUSTERED INDEX IX_classes_status_type ON oneroster12.classes (status, classType) INCLUDE (title, classCode);
    PRINT '  ✓ Created IX_classes_status_type on classes';
END;

-- API performance index for filtering
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.classes') AND name = 'IX_classes_api_status_filter')
BEGIN
    CREATE NONCLUSTERED INDEX IX_classes_api_status_filter ON oneroster12.classes (status, dateLastModified) INCLUDE (title, classCode);
    PRINT '  ✓ Created IX_classes_api_status_filter on classes';
END;
GO

IF OBJECT_ID('oneroster12.sp_refresh_classes', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_classes;
GO

CREATE PROCEDURE oneroster12.sp_refresh_classes
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
    VALUES ('classes', @StartTime, 'Running');
    
    DECLARE @HistoryID INT = SCOPE_IDENTITY();
    
    BEGIN TRY
        -- Create staging table
        IF OBJECT_ID('tempdb..#staging_classes') IS NOT NULL
            DROP TABLE #staging_classes;
            
        CREATE TABLE #staging_classes (
            sourcedId NVARCHAR(64) NOT NULL,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            title NVARCHAR(256) NOT NULL,
            classCode NVARCHAR(64) NULL,
            classType NVARCHAR(32) NULL,
            location NVARCHAR(256) NULL,
            grades NVARCHAR(MAX) NULL,
            subjects NVARCHAR(MAX) NULL,
            course NVARCHAR(MAX) NULL,
            school NVARCHAR(MAX) NULL,
            terms NVARCHAR(MAX) NULL,
            subjectCodes NVARCHAR(MAX) NULL,
            periods NVARCHAR(MAX) NULL,
            resources NVARCHAR(MAX) NULL,
            metadata NVARCHAR(MAX) NULL
        );
        
        -- Insert data into staging table following PostgreSQL pattern exactly
        WITH section AS (
            SELECT * FROM edfi.Section
        ),
        courseoffering AS (
            -- avoid column ambiguity in next step
            SELECT 
                co.*,
                sch.LocalEducationAgencyId
            FROM edfi.CourseOffering co 
            JOIN edfi.School sch ON co.SchoolId = sch.SchoolId
        ),
        periods AS (
            SELECT 
                SectionIdentifier,
                '[' + STRING_AGG('"' + ClassPeriodName + '"', ',') WITHIN GROUP (ORDER BY ClassPeriodName) + ']' AS periods
            FROM (
                SELECT DISTINCT SectionIdentifier, ClassPeriodName
                FROM edfi.SectionClassPeriod
            ) distinct_periods
            GROUP BY SectionIdentifier
        ),
        classes AS (
            SELECT 
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                    CAST(
                        CONCAT(LOWER(section.LocalCourseCode), '-', CAST(section.SchoolId AS VARCHAR), 
                               '-', LOWER(section.SectionIdentifier), '-', LOWER(section.SessionName))
                        AS VARCHAR(MAX)
                    ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                section.LastModifiedDate AS dateLastModified,
                CASE
                    WHEN courseoffering.LocalCourseTitle IS NULL THEN ''
                    ELSE courseoffering.LocalCourseTitle
                END AS title,
                section.LocalCourseCode AS classCode,
                'scheduled' AS classType,
                section.LocationClassroomIdentificationCode AS location,
                NULL AS grades,
                NULL AS subjects,
                (SELECT 
                    CONCAT('/courses/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                        CAST(
                            CONCAT(CAST(courseoffering.EducationOrganizationId AS VARCHAR), '-', courseoffering.CourseCode)
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                        CAST(
                            CONCAT(CAST(courseoffering.EducationOrganizationId AS VARCHAR), '-', courseoffering.CourseCode)
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'course' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS course,
                (SELECT 
                    CONCAT('/orgs/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(section.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(section.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                    'org' AS type
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS school,
                (SELECT 
                    CONCAT('/academicSessions/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                        CAST(
                            CONCAT(CAST(section.SchoolId AS VARCHAR), '-', section.SessionName)
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2))) AS href,
                    'academicSession' AS type,
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', 
                        CAST(
                            CONCAT(CAST(section.SchoolId AS VARCHAR), '-', section.SessionName)
                            AS VARCHAR(MAX)
                        ) COLLATE Latin1_General_BIN), 2)) AS sourcedId
                 FOR JSON PATH) AS terms,
                NULL AS subjectCodes,
                periods.periods,
                NULL AS resources,
                (SELECT 
                    'sections' AS [edfi.resource],
                    section.LocalCourseCode AS [edfi.naturalKey.localCourseCode],
                    section.SchoolId AS [edfi.naturalKey.schoolid],
                    section.SectionIdentifier AS [edfi.naturalKey.sectionIdentifier],
                    section.SessionName AS [edfi.naturalKey.sessionName]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM section
            JOIN courseoffering ON section.LocalCourseCode = courseoffering.LocalCourseCode
                AND section.SchoolId = courseoffering.SchoolId
                AND section.SchoolYear = courseoffering.SchoolYear
                AND section.SessionName = courseoffering.SessionName
            LEFT JOIN periods ON section.SectionIdentifier = periods.SectionIdentifier
        )
        INSERT INTO #staging_classes
        SELECT 
            sourcedId, status, dateLastModified, title, classCode, classType, 
            location, grades, subjects, course, school, terms, subjectCodes, 
            periods, resources, metadata
        FROM classes
        ;
        
        SET @RowCount = @@ROWCOUNT;
        
        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.classes;
            
            INSERT INTO oneroster12.classes 
                (sourcedId, status, dateLastModified, title, classCode, classType, 
                 location, grades, subjects, course, school, terms, subjectCodes, 
                 periods, resources, metadata)
            SELECT 
                sourcedId, status, dateLastModified, title, classCode, classType, 
                location, grades, subjects, course, school, terms, subjectCodes, 
                periods, resources, metadata
            FROM #staging_classes;
        COMMIT TRANSACTION;
        
        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;
        
        -- Clean up
        DROP TABLE #staging_classes;
        
        PRINT CONCAT('Classes refresh completed successfully. Rows: ', @RowCount);
        
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
            ('classes', @ErrorMessage, @ErrorSeverity, @ErrorState, 
             'sp_refresh_classes', ERROR_LINE());
        
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

PRINT 'Stored procedure oneroster12.sp_refresh_classes created successfully';
GO