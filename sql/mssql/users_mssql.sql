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
    -- PostgreSQL column order for consistency
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    userMasterIdentifier NVARCHAR(256) NULL,
    username NVARCHAR(256) NULL,
    userIds NVARCHAR(MAX) NULL, -- JSON array
    enabledUser NVARCHAR(8) NOT NULL DEFAULT 'true',
    givenName NVARCHAR(256) NULL,
    familyName NVARCHAR(256) NULL,
    middleName NVARCHAR(256) NULL,
    preferredFirstName NVARCHAR(256) NULL,
    preferredMiddleName NVARCHAR(256) NULL,
    preferredLastName NVARCHAR(256) NULL,
    pronouns NVARCHAR(64) NULL,
    role NVARCHAR(32) NULL,
    roles NVARCHAR(MAX) NULL, -- JSON array
    userProfiles NVARCHAR(MAX) NULL, -- JSON array (for OneRoster compatibility)
    identifier NVARCHAR(256) NULL,
    email NVARCHAR(256) NULL,
    sms NVARCHAR(32) NULL,
    phone NVARCHAR(32) NULL,
    agentSourceIds NVARCHAR(MAX) NULL, -- text field (for OneRoster compatibility)
    grades NVARCHAR(MAX) NULL, -- JSON array or comma-separated
    password NVARCHAR(256) NULL,
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Users
-- =============================================
    ALTER TABLE oneroster12.users ADD CONSTRAINT PK_users PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on users';

-- Create unique constraint on sourcedId
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'UQ_users_sourcedId')
BEGIN
    ALTER TABLE oneroster12.users ADD CONSTRAINT UQ_users_sourcedId UNIQUE (sourcedId);
    PRINT '  ✓ Created unique constraint on sourcedId';
END;

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
            -- PostgreSQL column order for consistency
            sourcedId NVARCHAR(64) NOT NULL PRIMARY KEY,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            userMasterIdentifier NVARCHAR(256) NULL,
            username NVARCHAR(256) NULL,
            userIds NVARCHAR(MAX) NULL,
            enabledUser NVARCHAR(8) NOT NULL DEFAULT 'true',
            givenName NVARCHAR(256) NULL,
            familyName NVARCHAR(256) NULL,
            middleName NVARCHAR(256) NULL,
            preferredFirstName NVARCHAR(256) NULL,
            preferredMiddleName NVARCHAR(256) NULL,
            preferredLastName NVARCHAR(256) NULL,
            pronouns NVARCHAR(64) NULL,
            role NVARCHAR(32) NULL,
            roles NVARCHAR(MAX) NULL,
            userProfiles NVARCHAR(MAX) NULL,
            identifier NVARCHAR(256) NULL,
            email NVARCHAR(256) NULL,
            sms NVARCHAR(32) NULL,
            phone NVARCHAR(32) NULL,
            agentSourceIds NVARCHAR(MAX) NULL,
            grades NVARCHAR(MAX) NULL,
            password NVARCHAR(256) NULL,
            metadata NVARCHAR(MAX) NULL
        );
        
        -- Create student_grade CTE to match PostgreSQL logic
        WITH student_grade AS (
            SELECT 
                x.StudentUSI,
                x.grade_level
            FROM (
                SELECT 
                    ssa.StudentUSI,
                    gld.CodeValue as grade_level,
                    ROW_NUMBER() OVER (
                        PARTITION BY ssa.StudentUSI, ssa.SchoolYear
                        ORDER BY 
                            ssa.EntryDate DESC,
                            ssa.ExitWithdrawDate DESC,
                            gld.CodeValue DESC
                    ) as seq
                FROM edfi.StudentSchoolAssociation ssa
                    JOIN edfi.Descriptor gld 
                        ON ssa.EntryGradeLevelDescriptorId = gld.DescriptorId
            ) x
            WHERE x.seq = 1
        ),
        -- Create student_ids CTE to match PostgreSQL logic
        student_ids AS (
            SELECT 
                seoa_sid.StudentUSI,
                seoa_sid.EducationOrganizationId,
                (SELECT 
                    d2.CodeValue AS type,
                    seoa_sid2.IdentificationCode AS identifier
                 FROM edfi.StudentEducationOrganizationAssociationStudentIdentificationCode seoa_sid2
                    JOIN edfi.Descriptor d2 ON seoa_sid2.StudentIdentificationSystemDescriptorId = d2.DescriptorId
                 WHERE seoa_sid2.StudentUSI = seoa_sid.StudentUSI
                   AND seoa_sid2.EducationOrganizationId = seoa_sid.EducationOrganizationId
                 FOR JSON PATH) AS ids
            FROM edfi.StudentEducationOrganizationAssociationStudentIdentificationCode seoa_sid
            GROUP BY seoa_sid.StudentUSI, seoa_sid.EducationOrganizationId
        ),
        -- Create student_orgs CTE to match PostgreSQL logic
        student_orgs AS (
            SELECT 
                ssa.StudentUSI,
                s.LocalEducationAgencyId,
                s.SchoolId,
                LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(s.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) as sourcedid,
                ssa.PrimarySchool,
                ssa.EntryDate
            FROM edfi.StudentSchoolAssociation ssa
                JOIN edfi.School s ON ssa.SchoolId = s.SchoolId
        ),
        -- Create student_orgs_agg CTE
        student_orgs_agg AS (
            SELECT 
                StudentUSI,
                (SELECT 
                    CASE 
                        WHEN so2.PrimarySchool = 1 OR so2.SchoolId = (
                            SELECT TOP 1 so3.SchoolId 
                            FROM student_orgs so3 
                            WHERE so3.StudentUSI = so.StudentUSI 
                            ORDER BY so3.EntryDate DESC
                        ) THEN 'primary'
                        ELSE 'secondary'
                    END AS roleType,
                    'student' AS role,
                    JSON_QUERY('{"href":"/orgs/' + so2.sourcedid + '","sourcedId":"' + so2.sourcedid + '","type":"org"}') AS org
                 FROM student_orgs so2
                 WHERE so2.StudentUSI = so.StudentUSI
                 FOR JSON PATH) AS roles
            FROM student_orgs so
            GROUP BY so.StudentUSI
        ),
        -- NOTE: staff_orgs and staff_orgs_agg CTEs moved after staff_role definition for proper dependency order
        -- Create email CTEs for each user type
        student_email AS (
            SELECT DISTINCT
                seo.StudentUSI,
                seo.ElectronicMailAddress,
                ROW_NUMBER() OVER (
                    PARTITION BY seo.StudentUSI 
                    ORDER BY 
                        CASE WHEN d.CodeValue = 'Home/Personal' THEN 1 ELSE 2 END,
                        d.CodeValue
                ) as email_rank
            FROM edfi.StudentEducationOrganizationAssociationElectronicMail seo
                JOIN edfi.Descriptor d 
                    ON seo.ElectronicMailTypeDescriptorId = d.DescriptorId
            WHERE seo.ElectronicMailAddress IS NOT NULL
        ),
        staff_email AS (
            SELECT DISTINCT
                seo.StaffUSI,
                seo.ElectronicMailAddress,
                ROW_NUMBER() OVER (
                    PARTITION BY seo.StaffUSI 
                    ORDER BY 
                        CASE WHEN d.CodeValue = 'Work' THEN 1 ELSE 2 END,
                        d.CodeValue
                ) as email_rank
            FROM edfi.StaffElectronicMail seo
                JOIN edfi.Descriptor d 
                    ON seo.ElectronicMailTypeDescriptorId = d.DescriptorId
            WHERE seo.ElectronicMailAddress IS NOT NULL
        ),
        contact_email AS (
            SELECT DISTINCT
                ceo.ContactUSI,
                ceo.ElectronicMailAddress,
                ROW_NUMBER() OVER (
                    PARTITION BY ceo.ContactUSI 
                    ORDER BY ceo.ElectronicMailAddress
                ) as email_rank
            FROM edfi.ContactElectronicMail ceo
            WHERE ceo.PrimaryEmailAddressIndicator = 1 
                AND ceo.DoNotPublishIndicator = 0
                AND ceo.ElectronicMailAddress IS NOT NULL
        ),
        -- Parent roles - build roles array from associated student organizations
        parent_roles AS (
            SELECT 
                sca.ContactUSI,
                '[' + STRING_AGG(
                    '{"roleType":"primary","role":"parent","org":{"href":"/orgs/' + 
                        LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(s.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) + 
                        '","sourcedId":"' + 
                        LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(s.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) + 
                        '","type":"org"}}', ','
                ) + ']' AS roles
            FROM edfi.StudentContactAssociation sca
            JOIN edfi.StudentSchoolAssociation ssa ON sca.StudentUSI = ssa.StudentUSI  
            JOIN edfi.School s ON ssa.SchoolId = s.SchoolId
            GROUP BY sca.ContactUSI
        ),
        -- Staff role classification logic (ported from PostgreSQL)
        teaching_staff AS (
            SELECT DISTINCT StaffUSI  
            FROM edfi.StaffSectionAssociation
        ),
        -- Staff identification codes (additional identifiers like State ID)
        staff_ids AS (
            SELECT 
                StaffUSI,
                (
                    SELECT 
                        JSON_QUERY('[' + STRING_AGG(
                            JSON_QUERY(
                                '{"type":"' + d.CodeValue + '","identifier":"' + sic.IdentificationCode + '"}'
                            ), ','
                        ) + ']')
                    FROM edfi.StaffIdentificationCode sic
                    JOIN edfi.Descriptor d ON sic.StaffIdentificationSystemDescriptorId = d.DescriptorId
                    WHERE sic.StaffUSI = staff_main.StaffUSI
                ) as ids
            FROM (SELECT DISTINCT StaffUSI FROM edfi.Staff) staff_main
        ),
        staff_school_with_classification AS (
            SELECT
                ssa.StaffUSI,
                ssa.SchoolId,
                COALESCE(mappedschoolstaffclassificationdescriptor.MappedValue, 
                         mappedleastaffclassificationdescriptor.MappedValue) as staff_classification
            FROM edfi.StaffSchoolAssociation ssa
                JOIN edfi.School school
                    ON ssa.SchoolId = school.SchoolId
                LEFT JOIN edfi.StaffEducationOrganizationAssignmentAssociation school_assign
                    ON ssa.StaffUSI = school_assign.StaffUSI
                    AND ssa.SchoolId = school_assign.EducationOrganizationId
                LEFT JOIN edfi.StaffEducationOrganizationAssignmentAssociation lea_assign
                    ON ssa.StaffUSI = lea_assign.StaffUSI
                    AND school.LocalEducationAgencyId = lea_assign.EducationOrganizationId
                LEFT JOIN edfi.Descriptor schoolstaffclassificationdescriptor
                    ON school_assign.StaffClassificationDescriptorId = schoolstaffclassificationdescriptor.DescriptorId
                LEFT JOIN edfi.DescriptorMapping mappedschoolstaffclassificationdescriptor
                    ON mappedschoolstaffclassificationdescriptor.Value = schoolstaffclassificationdescriptor.CodeValue
                    AND mappedschoolstaffclassificationdescriptor.Namespace = schoolstaffclassificationdescriptor.Namespace
                    AND mappedschoolstaffclassificationdescriptor.MappedNamespace = 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
                LEFT JOIN edfi.Descriptor leastaffclassificationdescriptor
                    ON lea_assign.StaffClassificationDescriptorId = leastaffclassificationdescriptor.DescriptorId
                LEFT JOIN edfi.DescriptorMapping mappedleastaffclassificationdescriptor
                    ON mappedleastaffclassificationdescriptor.Value = leastaffclassificationdescriptor.CodeValue
                    AND mappedleastaffclassificationdescriptor.Namespace = leastaffclassificationdescriptor.Namespace
                    AND mappedleastaffclassificationdescriptor.MappedNamespace = 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
            WHERE school.SchoolId IS NOT NULL
        ),
        staff_role AS (
            SELECT x.*
            FROM (
                SELECT 
                    staff_school.StaffUSI,
                    staff_school.staff_classification,
                    ROW_NUMBER() OVER(PARTITION BY staff_school.StaffUSI ORDER BY staff_classification) as seq
                FROM staff_school_with_classification AS staff_school
                LEFT JOIN teaching_staff 
                    ON staff_school.StaffUSI = teaching_staff.StaffUSI
                -- either has a staff_classification, or teaches a section
                WHERE (staff_school.staff_classification IS NOT NULL OR teaching_staff.StaffUSI IS NOT NULL)
            ) x
            -- only one role per staff. if multiple, prefer admin over teacher
            WHERE seq = 1
        ),
        -- Create staff_orgs CTE (must come after staff_role)
        staff_orgs AS (
            SELECT DISTINCT
                ssa.StaffUSI,
                ssa.SchoolId,
                sr.staff_classification,
                ssa.CreateDate
            FROM edfi.StaffSchoolAssociation ssa
                LEFT JOIN staff_role sr ON ssa.StaffUSI = sr.StaffUSI
        ),
        -- Create staff_orgs_agg CTE
        staff_orgs_agg AS (
            SELECT 
                StaffUSI,
                (SELECT 
                    CASE 
                        WHEN so2.SchoolId = (
                            SELECT TOP 1 so3.SchoolId 
                            FROM staff_orgs so3 
                            WHERE so3.StaffUSI = so.StaffUSI 
                            ORDER BY so3.CreateDate DESC
                        ) THEN 'primary'
                        ELSE 'secondary'
                    END AS roleType,
                    so2.staff_classification AS role,
                    JSON_QUERY('{"href":"/orgs/' + LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(so2.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) + '","sourcedId":"' + LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(so2.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) + '","type":"org"}') AS org
                 FROM staff_orgs so2
                 WHERE so2.StaffUSI = so.StaffUSI
                 FOR JSON PATH) AS roles
            FROM staff_orgs so
            GROUP BY so.StaffUSI
        )
        
        -- Insert all three user types with correct column mapping
        INSERT INTO #staging_users
        -- Students (column order matching PostgreSQL)
        SELECT 
            -- Core OneRoster fields in PostgreSQL order
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(CONCAT('STU-', CAST(s.StudentUniqueId AS VARCHAR(50))) AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
            'active' AS status,
            s.LastModifiedDate AS dateLastModified,
            NULL AS userMasterIdentifier,
            CASE WHEN se.ElectronicMailAddress IS NULL THEN '' ELSE se.ElectronicMailAddress END AS username,
            CASE 
                WHEN si.ids IS NOT NULL THEN 
                    '[{"type":"studentUniqueId","identifier":"' + CAST(s.StudentUniqueId AS NVARCHAR(256)) + '"},' + 
                    SUBSTRING(si.ids, 2, LEN(si.ids) - 1)
                ELSE 
                    '[{"type":"studentUniqueId","identifier":"' + CAST(s.StudentUniqueId AS NVARCHAR(256)) + '"}]'
            END AS userIds,
            'true' AS enabledUser,
            s.FirstName AS givenName,
            s.LastSurname AS familyName,
            s.MiddleName AS middleName,
            s.PreferredFirstName AS preferredFirstName,
            NULL AS preferredMiddleName,
            s.PreferredLastSurname AS preferredLastName,
            NULL AS pronouns,
            'student' AS role,
            soa.roles AS roles,
            NULL AS userProfiles,
            CAST(s.StudentUniqueId AS NVARCHAR(256)) AS identifier,
            se.ElectronicMailAddress AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agentSourceIds,
            CASE 
                WHEN sg.grade_level IS NOT NULL THEN '["' + sg.grade_level + '"]'
                ELSE NULL 
            END AS grades,
            NULL AS password,
            JSON_QUERY(
                '{"edfi":{"resource":"students","naturalKey":{"studentUniqueId":"' + CAST(s.StudentUniqueId AS NVARCHAR(256)) + '"}}}'
            ) AS metadata
        FROM edfi.Student s
            LEFT JOIN student_email se ON s.StudentUSI = se.StudentUSI AND se.email_rank = 1
            LEFT JOIN student_grade sg ON s.StudentUSI = sg.StudentUSI
            LEFT JOIN student_ids si ON s.StudentUSI = si.StudentUSI
            LEFT JOIN student_orgs_agg soa ON s.StudentUSI = soa.StudentUSI
        
        UNION ALL
        
        -- Staff (column order matching PostgreSQL)
        SELECT 
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(CONCAT('STA-', CAST(st.StaffUniqueId AS VARCHAR(50))) AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
            'active' AS status,
            st.LastModifiedDate AS dateLastModified,
            NULL AS userMasterIdentifier,
            CASE WHEN ste.ElectronicMailAddress IS NULL THEN '' ELSE ste.ElectronicMailAddress END AS username,
            CASE 
                WHEN si.ids IS NOT NULL THEN 
                    '[{"type":"staffUniqueId","identifier":"' + CAST(st.StaffUniqueId AS NVARCHAR(256)) + '"},' + 
                    SUBSTRING(si.ids, 2, LEN(si.ids) - 1)
                ELSE 
                    '[{"type":"staffUniqueId","identifier":"' + CAST(st.StaffUniqueId AS NVARCHAR(256)) + '"}]'
            END AS userIds,
            'true' AS enabledUser,
            st.FirstName AS givenName,
            st.LastSurname AS familyName,
            st.MiddleName AS middleName,
            st.PreferredFirstName AS preferredFirstName,
            NULL AS preferredMiddleName,
            st.PreferredLastSurname AS preferredLastName,
            NULL AS pronouns,
            sr.staff_classification AS role,
            stoa.roles AS roles,
            NULL AS userProfiles,
            CAST(st.StaffUniqueId AS NVARCHAR(256)) AS identifier,
            ste.ElectronicMailAddress AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agentSourceIds,
            NULL AS grades,
            NULL AS password,
            JSON_QUERY(
                '{"edfi":' +
                    '{"resource":"staffs",' +
                    '"naturalKey":{"staffUniqueId":"' + CAST(st.staffUniqueId AS NVARCHAR(256)) + '"},' +
                    '"staffClassification":' + ISNULL('"' + sr.staff_classification + '"', 'null') + '}' +
                '}'
            ) AS metadata
        FROM edfi.staff st
            LEFT JOIN staff_email ste ON st.staffusi = ste.staffusi AND ste.email_rank = 1
            LEFT JOIN staff_role sr ON st.StaffUSI = sr.StaffUSI
            LEFT JOIN staff_ids si ON st.StaffUSI = si.StaffUSI
            LEFT JOIN staff_orgs_agg stoa ON st.StaffUSI = stoa.StaffUSI
        
        UNION ALL
        
        -- Parents/Contacts (column order matching PostgreSQL)
        SELECT 
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(CONCAT('PAR-', CAST(c.contactUniqueId AS VARCHAR(50))) AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
            'active' AS status,
            c.lastmodifieddate AS dateLastModified,
            NULL AS userMasterIdentifier,
            CASE WHEN ce.electronicmailaddress IS NULL THEN '' ELSE ce.electronicmailaddress END AS username,
            '[{"type":"contactUniqueId","identifier":"' + CAST(c.contactUniqueId AS NVARCHAR(256)) + '"}]' AS userIds,
            'true' AS enabledUser,
            c.firstname AS givenName,
            c.lastsurname AS familyName,
            c.middlename AS middleName,
            c.preferredfirstname AS preferredFirstName,
            NULL AS preferredMiddleName,
            c.preferredlastsurname AS preferredLastName,
            NULL AS pronouns,
            'parent' AS role,
            pr.roles AS roles,
            NULL AS userProfiles,
            CAST(c.contactuniqueid AS NVARCHAR(256)) AS identifier,
            ce.electronicmailaddress AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agentSourceIds,
            NULL AS grades,
            NULL AS password,
            JSON_QUERY(
                '{"edfi":{"resource":"contacts","naturalKey":{"contactUniqueId":"' + CAST(c.contactUniqueId AS NVARCHAR(256)) + '"}}}'
            ) AS metadata
        FROM edfi.contact c
            LEFT JOIN contact_email ce ON c.contactusi = ce.contactusi AND ce.email_rank = 1
            LEFT JOIN parent_roles pr ON c.ContactUSI = pr.ContactUSI
        ;
        
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