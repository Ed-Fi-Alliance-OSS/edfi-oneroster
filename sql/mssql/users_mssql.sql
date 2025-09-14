-- =============================================
-- MS SQL Server Setup for Users
-- Creates table, indexes, and refresh procedure
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Users Table
-- =============================================
IF OBJECT_ID('oneroster12.users', 'U') IS NOT NULL 
    DROP TABLE oneroster12.users;
GO

CREATE TABLE oneroster12.users (
    sourcedId NVARCHAR(64) NOT NULL PRIMARY KEY,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    enabledUser BIT NOT NULL DEFAULT 1,
    username NVARCHAR(256) NULL,
    userIds NVARCHAR(MAX) NULL, -- JSON array
    givenName NVARCHAR(256) NULL,
    familyName NVARCHAR(256) NULL,
    middleName NVARCHAR(256) NULL,
    identifier NVARCHAR(256) NULL,
    email NVARCHAR(256) NULL,
    sms NVARCHAR(32) NULL,
    phone NVARCHAR(32) NULL,
    agents NVARCHAR(MAX) NULL, -- JSON array
    orgs NVARCHAR(MAX) NULL, -- JSON array
    grades NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    password NVARCHAR(256) NULL,
    userMasterIdentifier NVARCHAR(256) NULL,
    resourceId NVARCHAR(256) NULL,
    preferredFirstName NVARCHAR(256) NULL,
    preferredMiddleName NVARCHAR(256) NULL,
    preferredLastName NVARCHAR(256) NULL,
    primaryOrg NVARCHAR(MAX) NULL, -- JSON
    pronouns NVARCHAR(64) NULL,
    userProfiles NVARCHAR(MAX) NULL, -- JSON array (for OneRoster compatibility)
    agentSourceIds NVARCHAR(MAX) NULL, -- text field (for OneRoster compatibility)
    metadata NVARCHAR(MAX) NULL, -- JSON
    role NVARCHAR(32) NULL,
    roles NVARCHAR(MAX) NULL -- JSON array
);
GO

-- =============================================
-- Create Indexes for Users
-- =============================================
-- Primary access patterns: by sourcedId, by role, by identifier, by username, by orgs
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_role_status')
BEGIN
    CREATE INDEX IX_users_role_status ON oneroster12.users (role, status) INCLUDE (givenName, familyName, username);
    PRINT '  ✓ Created IX_users_role_status on users';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_identifier')
BEGIN
    CREATE INDEX IX_users_identifier ON oneroster12.users (identifier) WHERE identifier IS NOT NULL;
    PRINT '  ✓ Created IX_users_identifier on users';  
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_username')
BEGIN
    CREATE INDEX IX_users_username ON oneroster12.users (username) WHERE username IS NOT NULL;
    PRINT '  ✓ Created IX_users_username on users';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_email')
BEGIN
    CREATE INDEX IX_users_email ON oneroster12.users (email) WHERE email IS NOT NULL;
    PRINT '  ✓ Created IX_users_email on users';
END;

-- Date-based filtering for incremental sync
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_lastmodified')
BEGIN  
    CREATE INDEX IX_users_lastmodified ON oneroster12.users (dateLastModified) WHERE dateLastModified IS NOT NULL;
    PRINT '  ✓ Created IX_users_lastmodified on users';
END;
GO

-- Corrected Users procedure with proper table structure
CREATE OR ALTER PROCEDURE oneroster12.sp_refresh_users
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
    VALUES ('users', @StartTime, 'Running');
    
    DECLARE @HistoryID INT = SCOPE_IDENTITY();
    
    BEGIN TRY
        -- Create staging table matching actual users table structure
        IF OBJECT_ID('tempdb..#staging_users') IS NOT NULL
            DROP TABLE #staging_users;
            
        CREATE TABLE #staging_users (
            sourcedId NVARCHAR(64) NOT NULL PRIMARY KEY,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            enabledUser BIT NOT NULL DEFAULT 1,
            username NVARCHAR(256) NULL,
            userIds NVARCHAR(MAX) NULL,
            givenName NVARCHAR(256) NULL,
            familyName NVARCHAR(256) NULL,
            middleName NVARCHAR(256) NULL,
            identifier NVARCHAR(256) NULL,
            email NVARCHAR(256) NULL,
            sms NVARCHAR(32) NULL,
            phone NVARCHAR(32) NULL,
            agents NVARCHAR(MAX) NULL,
            orgs NVARCHAR(MAX) NULL,
            grades NVARCHAR(MAX) NULL,
            password NVARCHAR(256) NULL,
            userMasterIdentifier NVARCHAR(256) NULL,
            resourceId NVARCHAR(256) NULL,
            preferredFirstName NVARCHAR(256) NULL,
            preferredMiddleName NVARCHAR(256) NULL,
            preferredLastName NVARCHAR(256) NULL,
            primaryOrg NVARCHAR(MAX) NULL,
            pronouns NVARCHAR(64) NULL,
            userProfiles NVARCHAR(MAX) NULL,
            agentSourceIds NVARCHAR(MAX) NULL,
            metadata NVARCHAR(MAX) NULL,
            role NVARCHAR(32) NULL,
            roles NVARCHAR(MAX) NULL
        );
        
        -- Insert all three user types with correct column mapping
        INSERT INTO #staging_users
        -- Students
        SELECT 
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CONCAT('STU-', CAST(studentUniqueId AS VARCHAR(50)))), 2)) AS sourcedId,
            'active' AS status,
            lastmodifieddate AS dateLastModified,
            1 AS enabledUser,
            CAST(studentuniqueid AS NVARCHAR(256)) AS username,
            '[{"type":"studentUniqueId","identifier":"' + CAST(studentUniqueId AS NVARCHAR(256)) + '"}]' AS userIds,
            firstname AS givenName,
            lastsurname AS familyName,
            middlename AS middleName,
            CAST(studentuniqueid AS NVARCHAR(256)) AS identifier,
            NULL AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agents,
            NULL AS orgs,
            NULL AS grades,
            NULL AS password,
            NULL AS userMasterIdentifier,
            NULL AS resourceId,
            preferredfirstname AS preferredFirstName,
            NULL AS preferredMiddleName,
            preferredlastsurname AS preferredLastName,
            NULL AS primaryOrg,
            NULL AS pronouns,
            NULL AS userProfiles,
            NULL AS agentSourceIds,
            '{"edfi.resource":"students","edfi.naturalKey.studentUniqueId":"' + CAST(studentUniqueId AS NVARCHAR(256)) + '"}' AS metadata,
            'student' AS role,
            NULL AS roles
        FROM edfi.student
        
        UNION ALL
        
        -- Staff  
        SELECT 
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CONCAT('STA-', CAST(staffUniqueId AS VARCHAR(50)))), 2)) AS sourcedId,
            'active' AS status,
            lastmodifieddate AS dateLastModified,
            1 AS enabledUser,
            CAST(staffuniqueid AS NVARCHAR(256)) AS username,
            '[{"type":"staffUniqueId","identifier":"' + CAST(staffUniqueId AS NVARCHAR(256)) + '"}]' AS userIds,
            firstname AS givenName,
            lastsurname AS familyName,
            middlename AS middleName,
            CAST(staffuniqueid AS NVARCHAR(256)) AS identifier,
            NULL AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agents,
            NULL AS orgs,
            NULL AS grades,
            NULL AS password,
            NULL AS userMasterIdentifier,
            NULL AS resourceId,
            preferredfirstname AS preferredFirstName,
            NULL AS preferredMiddleName,
            preferredlastsurname AS preferredLastName,
            NULL AS primaryOrg,
            NULL AS pronouns,
            NULL AS userProfiles,
            NULL AS agentSourceIds,
            '{"edfi.resource":"staffs","edfi.naturalKey.staffUniqueId":"' + CAST(staffUniqueId AS NVARCHAR(256)) + '"}' AS metadata,
            'teacher' AS role,
            NULL AS roles
        FROM edfi.staff
        
        UNION ALL
        
        -- Parents/Contacts
        SELECT 
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CONCAT('PAR-', CAST(contactUniqueId AS VARCHAR(50)))), 2)) AS sourcedId,
            'active' AS status,
            lastmodifieddate AS dateLastModified,
            1 AS enabledUser,
            CAST(contactuniqueid AS NVARCHAR(256)) AS username,
            '[{"type":"contactUniqueId","identifier":"' + CAST(contactUniqueId AS NVARCHAR(256)) + '"}]' AS userIds,
            firstname AS givenName,
            lastsurname AS familyName,
            middlename AS middleName,
            CAST(contactuniqueid AS NVARCHAR(256)) AS identifier,
            NULL AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agents,
            NULL AS orgs,
            NULL AS grades,
            NULL AS password,
            NULL AS userMasterIdentifier,
            NULL AS resourceId,
            preferredfirstname AS preferredFirstName,
            NULL AS preferredMiddleName,
            preferredlastsurname AS preferredLastName,
            NULL AS primaryOrg,
            NULL AS pronouns,
            NULL AS userProfiles,
            NULL AS agentSourceIds,
            '{"edfi.resource":"contacts","edfi.naturalKey.contactUniqueId":"' + CAST(contactUniqueId AS NVARCHAR(256)) + '"}' AS metadata,
            'parent' AS role,
            NULL AS roles
        FROM edfi.contact;
        
        SET @RowCount = @@ROWCOUNT;
        
        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.users;
            
            INSERT INTO oneroster12.users
            SELECT * FROM #staging_users;
            
        COMMIT TRANSACTION;
        
        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;
        
    END TRY
    BEGIN CATCH
        -- Rollback any open transaction
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
            ('users', @ErrorMessage, @ErrorSeverity, @ErrorState, 
             'sp_refresh_users', ERROR_LINE());
        
        -- Update history with failure
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Failed'
        WHERE history_id = @HistoryID;
        
        -- Re-raise error
        RAISERROR (@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH;
END;