-- =============================================
-- MS SQL Server Setup for Organizations
-- Creates table, indexes, and refresh procedure
-- Based on PostgreSQL orgs materialized view - FIXED MD5 GENERATION
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Organizations Table
-- =============================================
IF OBJECT_ID('oneroster12.orgs', 'U') IS NOT NULL 
    DROP TABLE oneroster12.orgs;
GO

CREATE TABLE oneroster12.orgs (
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    name NVARCHAR(256) NOT NULL,
    type NVARCHAR(32) NOT NULL,
    identifier NVARCHAR(256) NULL,
    parent NVARCHAR(MAX) NULL, -- JSON
    children NVARCHAR(MAX) NULL, -- JSON array
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Organizations
-- =============================================

    ALTER TABLE oneroster12.orgs ADD CONSTRAINT PK_orgs PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on orgs';

-- Unique index on sourcedId for lookups
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.orgs') AND name = 'IX_orgs_sourcedId')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_orgs_sourcedId ON oneroster12.orgs (sourcedId);
    PRINT '  ✓ Created IX_orgs_sourcedId unique index on orgs';
END;

-- Performance indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.orgs') AND name = 'IX_orgs_type_status')
BEGIN
    CREATE NONCLUSTERED INDEX IX_orgs_type_status ON oneroster12.orgs (type, status) INCLUDE (name, identifier);
    PRINT '  ✓ Created IX_orgs_type_status on orgs';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.orgs') AND name = 'IX_orgs_identifier')
BEGIN
    CREATE NONCLUSTERED INDEX IX_orgs_identifier ON oneroster12.orgs (identifier) WHERE identifier IS NOT NULL;
    PRINT '  ✓ Created IX_orgs_identifier on orgs';
END;

-- Date-based filtering for incremental sync
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.orgs') AND name = 'IX_orgs_lastmodified')
BEGIN
    CREATE INDEX IX_orgs_lastmodified ON oneroster12.orgs (dateLastModified) WHERE dateLastModified IS NOT NULL;
    PRINT '  ✓ Created IX_orgs_lastmodified on orgs';
END;
GO

IF OBJECT_ID('oneroster12.sp_refresh_orgs', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_orgs;
GO

CREATE PROCEDURE oneroster12.sp_refresh_orgs
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
    VALUES ('orgs', @StartTime, 'Running');
    
    DECLARE @HistoryID INT = SCOPE_IDENTITY();
    
    BEGIN TRY
        -- Create staging table
        IF OBJECT_ID('tempdb..#staging_orgs') IS NOT NULL
            DROP TABLE #staging_orgs;
            
        CREATE TABLE #staging_orgs (
            sourcedId NVARCHAR(64) NOT NULL,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            name NVARCHAR(256) NOT NULL,
            type NVARCHAR(32) NOT NULL,
            identifier NVARCHAR(256) NULL,
            parent NVARCHAR(MAX) NULL,
            children NVARCHAR(MAX) NULL,
            metadata NVARCHAR(MAX) NULL
        );
        
        -- Insert data into staging table following PostgreSQL pattern exactly with FIXED MD5
        WITH schools AS (
            SELECT
                school.*,
                schoolOrg.*,
                school.LocalEducationAgencyId as leaId
            FROM edfi.School school
            JOIN edfi.EducationOrganization schoolOrg ON schoolOrg.EducationOrganizationId = school.SchoolId
        ),
        leas AS (
            SELECT
                localEducationAgency.*,
                leaOrg.*,
                localEducationAgency.StateEducationAgencyId as seaId
            FROM edfi.LocalEducationAgency localEducationAgency
            JOIN edfi.EducationOrganization leaOrg ON leaOrg.EducationOrganizationId = localEducationAgency.LocalEducationAgencyId
        ),
        seas AS (
            SELECT
                stateEducationAgency.*,
                seaOrg.*
            FROM edfi.StateEducationAgency stateEducationAgency
            JOIN edfi.EducationOrganization seaOrg ON seaOrg.EducationOrganizationId = stateEducationAgency.StateEducationAgencyId
        ),
        schools_formatted AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(schools.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                LastModifiedDate AS dateLastModified,
                NameOfInstitution AS name,
                'school' AS type,
                CAST(SchoolId AS VARCHAR(256)) AS identifier,
                CASE WHEN leaId IS NOT NULL THEN
                    (SELECT 
                        CONCAT('/orgs/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(leaId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                        LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(leaId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                        'org' AS type
                     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
                ELSE NULL END AS parent,
                NULL AS children,
                (SELECT 
                    'schools' AS [edfi.resource],
                    SchoolId AS [edfi.naturalKey.schoolId]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM schools
        ),
        leas_formatted AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(leas.LocalEducationAgencyId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                LastModifiedDate AS dateLastModified,
                NameOfInstitution AS name,
                'district' AS type,
                CAST(LocalEducationAgencyId AS VARCHAR(256)) AS identifier,
                CASE WHEN StateEducationAgencyId IS NOT NULL THEN
                    (SELECT 
                        CONCAT('/orgs/', LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(StateEducationAgencyId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2))) AS href,
                        LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(StateEducationAgencyId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                        'org' AS type
                     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
                ELSE NULL END AS parent,
                NULL AS children,
                (SELECT 
                    'localEducationAgencies' AS [edfi.resource],
                    LocalEducationAgencyId AS [edfi.naturalKey.localEducationAgencyId]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM leas
        ),
        seas_formatted AS (
            SELECT
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(seas.StateEducationAgencyId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
                'active' AS status,
                LastModifiedDate AS dateLastModified,
                NameOfInstitution AS name,
                'state' AS type,
                CAST(StateEducationAgencyId AS VARCHAR(256)) AS identifier,
                NULL AS parent,
                NULL AS children,
                (SELECT 
                    'stateEducationAgencies' AS [edfi.resource],
                    StateEducationAgencyId AS [edfi.naturalKey.stateEducationAgencyId]
                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
            FROM seas
        )
        INSERT INTO #staging_orgs
        SELECT 
            sourcedId, status, dateLastModified, name, type, identifier, 
            parent, children, metadata
        FROM (
            SELECT * FROM schools_formatted
            UNION ALL
            SELECT * FROM leas_formatted
            UNION ALL 
            SELECT * FROM seas_formatted
        ) AS combined_orgs
        ;
        
        SET @RowCount = @@ROWCOUNT;
        
        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.orgs;
            
            INSERT INTO oneroster12.orgs
            SELECT * FROM #staging_orgs;
        COMMIT TRANSACTION;
        
        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;
        
        -- Clean up
        DROP TABLE #staging_orgs;
        
        PRINT CONCAT('Organizations refresh completed successfully. Rows: ', @RowCount);
        
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
            ('orgs', @ErrorMessage, @ErrorSeverity, @ErrorState, 
             'sp_refresh_orgs', ERROR_LINE());
        
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

PRINT 'Stored procedure oneroster12.sp_refresh_orgs created successfully';
GO