-- SPDX-License-Identifier: Apache-2.0
-- Licensed to 1EdTech Consortium, Inc. under one or more agreements.
-- 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

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
    educationOrganizationId INT NULL,
    participantUSI INT NULL,
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
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_educationOrganizationId')
BEGIN
    CREATE INDEX IX_users_educationOrganizationId ON oneroster12.users (educationOrganizationId) WHERE educationOrganizationId IS NOT NULL;
    PRINT '  ✓ Created IX_users_educationOrganizationId on users';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.users') AND name = 'IX_users_participantUSI')
BEGIN
    CREATE INDEX IX_users_participantUSI ON oneroster12.users (participantUSI) WHERE participantUSI IS NOT NULL;
    PRINT '  ✓ Created IX_users_participantUSI on users';
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
            -- PostgreSQL column order for consistency.
            -- HEAP load: a clustered PK on the random MD5 sourcedId would sort these
            -- wide rows on every insert. Uniqueness is enforced by a nonclustered index IX_staging_users_sourcedId
            -- built once after load (see below).
            sourcedId NVARCHAR(64) NOT NULL,
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
            educationOrganizationId INT NULL,
            participantUSI INT NULL,
            email NVARCHAR(256) NULL,
            sms NVARCHAR(32) NULL,
            phone NVARCHAR(32) NULL,
            agentSourceIds NVARCHAR(MAX) NULL,
            grades NVARCHAR(MAX) NULL,
            password NVARCHAR(256) NULL,
            metadata NVARCHAR(MAX) NULL
        );

        -- Materialize intermediates into indexed #temp tables, then do three simple
        -- inserts. SQL Server does not materialize CTEs, so the previous single
        -- WITH ... UNION ALL ... INSERT re-expanded the staff classification chain per
        -- staff row, producing a huge cardinality estimate and a tempdb-spilling
        -- sort. Materializing each step gives the optimizer real row counts; the
        -- emitted output is unchanged apart from the roles dedup noted below.

        -- ---- Students -------------------------------------------------------

        -- Latest grade level per student (by entry date)
        SELECT x.StudentUSI, x.grade_level
        INTO #student_grade
        FROM (
            SELECT
                ssa.StudentUSI,
                gld.CodeValue as grade_level,
                ROW_NUMBER() OVER (
                    -- partition by student alone (not student, schoolyear) so a
                    -- student with enrolments in multiple years yields one user row
                    PARTITION BY ssa.StudentUSI
                    ORDER BY
                        ssa.EntryDate DESC,
                        ssa.ExitWithdrawDate DESC,
                        gld.CodeValue DESC
                ) as seq
            FROM edfi.StudentSchoolAssociation ssa
                JOIN edfi.Descriptor gld
                    ON ssa.EntryGradeLevelDescriptorId = gld.DescriptorId
        ) x
        WHERE x.seq = 1;
        CREATE CLUSTERED INDEX IX_tmp_student_grade ON #student_grade (StudentUSI);

        -- Student identification codes (JSON array per student/edorg)
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
             ORDER BY d2.CodeValue
             FOR JSON PATH) AS ids
        INTO #student_ids
        FROM edfi.StudentEducationOrganizationAssociationStudentIdentificationCode seoa_sid
        GROUP BY seoa_sid.StudentUSI, seoa_sid.EducationOrganizationId;
        CREATE CLUSTERED INDEX IX_tmp_student_ids ON #student_ids (StudentUSI, EducationOrganizationId);

        -- Student org associations (one row per enrollment) with school-scoped sourcedId
        SELECT
            ssa.StudentUSI,
            s.LocalEducationAgencyId,
            s.SchoolId,
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(s.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) as sourcedid,
            ssa.PrimarySchool,
            ssa.EntryDate
        INTO #student_orgs
        FROM edfi.StudentSchoolAssociation ssa
            JOIN edfi.School s ON ssa.SchoolId = s.SchoolId;
        CREATE CLUSTERED INDEX IX_tmp_student_orgs ON #student_orgs (StudentUSI, SchoolId);

        -- Distinct (student, school) with a per-school "primary enrollment" flag, so a
        -- re-enrollment at the same school does not duplicate the org in roles.
        SELECT
            StudentUSI,
            SchoolId,
            sourcedid,
            MAX(CAST(PrimarySchool AS INT)) AS primary_flag
        INTO #student_orgs_distinct
        FROM #student_orgs
        GROUP BY StudentUSI, SchoolId, sourcedid;
        CREATE CLUSTERED INDEX IX_tmp_student_orgs_distinct ON #student_orgs_distinct (StudentUSI);

        -- Most-recently-entered school per student, preserving the original
        -- "primary = flagged primary OR most-recent enrollment" semantics.
        SELECT StudentUSI, SchoolId
        INTO #student_recent_org
        FROM (
            SELECT
                StudentUSI,
                SchoolId,
                ROW_NUMBER() OVER (
                    PARTITION BY StudentUSI
                    ORDER BY EntryDate DESC
                ) AS seq
            FROM #student_orgs
        ) ranked
        WHERE seq = 1;
        CREATE CLUSTERED INDEX IX_tmp_student_recent_org ON #student_recent_org (StudentUSI);

        -- roles JSON per student (set-based STRING_AGG over the deduped orgs)
        SELECT
            sod.StudentUSI,
            '[' + STRING_AGG(
                CAST(
                    '{"roleType":"' +
                    CASE WHEN sod.primary_flag = 1 OR sod.SchoolId = sro.SchoolId
                         THEN 'primary' ELSE 'secondary' END +
                    '","role":"student","org":{"href":"/orgs/' + sod.sourcedid +
                    '","sourcedId":"' + sod.sourcedid + '","type":"org"}}'
                AS NVARCHAR(MAX)),
                ','
            ) WITHIN GROUP (ORDER BY sod.SchoolId) + ']' AS roles
        INTO #student_orgs_agg
        FROM #student_orgs_distinct sod
            LEFT JOIN #student_recent_org sro ON sod.StudentUSI = sro.StudentUSI
        GROUP BY sod.StudentUSI;
        CREATE CLUSTERED INDEX IX_tmp_student_orgs_agg ON #student_orgs_agg (StudentUSI);

        -- Distinct (student, school): one user row per school (re-enrollments collapse)
        SELECT DISTINCT StudentUSI, SchoolId
        INTO #student_school
        FROM #student_orgs;
        CREATE CLUSTERED INDEX IX_tmp_student_school ON #student_school (StudentUSI, SchoolId);

        -- Preferred student email (Home/Personal first)
        SELECT StudentUSI, ElectronicMailAddress
        INTO #student_email
        FROM (
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
        ) x
        WHERE x.email_rank = 1;
        CREATE CLUSTERED INDEX IX_tmp_student_email ON #student_email (StudentUSI);

        -- ---- Staff ----------------------------------------------------------

        -- Preferred staff email (Work first)
        SELECT StaffUSI, ElectronicMailAddress
        INTO #staff_email
        FROM (
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
        ) x
        WHERE x.email_rank = 1;
        CREATE CLUSTERED INDEX IX_tmp_staff_email ON #staff_email (StaffUSI);

        -- Staff that teach at least one section
        SELECT DISTINCT StaffUSI
        INTO #teaching_staff
        FROM edfi.StaffSectionAssociation;
        CREATE CLUSTERED INDEX IX_tmp_teaching_staff ON #teaching_staff (StaffUSI);

        -- Staff identification codes (additional identifiers like State ID)
        SELECT
            StaffUSI,
            (
                SELECT
                    JSON_QUERY(
                        (SELECT
                            d.CodeValue AS [type],
                            sic.IdentificationCode AS [identifier]
                         FROM edfi.StaffIdentificationCode sic
                         JOIN edfi.Descriptor d ON sic.StaffIdentificationSystemDescriptorId = d.DescriptorId
                         WHERE sic.StaffUSI = staff_main.StaffUSI
                         ORDER BY d.CodeValue
                         FOR JSON PATH)
                    )
            ) as ids
        INTO #staff_ids
        FROM (SELECT DISTINCT StaffUSI FROM edfi.Staff) staff_main;
        CREATE CLUSTERED INDEX IX_tmp_staff_ids ON #staff_ids (StaffUSI);

        -- Staff-classification mapping, deduped to one deterministic MappedValue per
        -- (Namespace, CodeValue) so duplicate DescriptorMapping rows can't fan out the
        -- classification join. A no-op when there are no duplicate mappings.
        SELECT
            Namespace,
            Value AS CodeValue,
            MIN(MappedValue) AS MappedValue
        INTO #staff_class_map
        FROM edfi.DescriptorMapping
        WHERE MappedNamespace = 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
        GROUP BY Namespace, Value;
        CREATE CLUSTERED INDEX IX_tmp_staff_class_map ON #staff_class_map (CodeValue, Namespace);

        -- Staff classification per (staff, school): school-level assignment first,
        -- then LEA-level (COALESCE). May yield >1 row per (staff, school) when a
        -- staff member has multiple assignments; downstream dedupe collapses it.
        SELECT
            ssa.StaffUSI,
            ssa.SchoolId,
            COALESCE(mappedschool.MappedValue, mappedlea.MappedValue) as staff_classification
        INTO #staff_school_class
        FROM edfi.StaffSchoolAssociation ssa
            JOIN edfi.School school
                ON ssa.SchoolId = school.SchoolId
            LEFT JOIN edfi.StaffEducationOrganizationAssignmentAssociation school_assign
                ON ssa.StaffUSI = school_assign.StaffUSI
                AND ssa.SchoolId = school_assign.EducationOrganizationId
            LEFT JOIN edfi.Descriptor schoolstaffclassificationdescriptor
                ON school_assign.StaffClassificationDescriptorId = schoolstaffclassificationdescriptor.DescriptorId
            LEFT JOIN #staff_class_map mappedschool
                ON mappedschool.CodeValue = schoolstaffclassificationdescriptor.CodeValue
                AND mappedschool.Namespace = schoolstaffclassificationdescriptor.Namespace
            LEFT JOIN edfi.StaffEducationOrganizationAssignmentAssociation lea_assign
                ON ssa.StaffUSI = lea_assign.StaffUSI
                AND school.LocalEducationAgencyId = lea_assign.EducationOrganizationId
            LEFT JOIN edfi.Descriptor leastaffclassificationdescriptor
                ON lea_assign.StaffClassificationDescriptorId = leastaffclassificationdescriptor.DescriptorId
            LEFT JOIN #staff_class_map mappedlea
                ON mappedlea.CodeValue = leastaffclassificationdescriptor.CodeValue
                AND mappedlea.Namespace = leastaffclassificationdescriptor.Namespace
        WHERE school.SchoolId IS NOT NULL;
        CREATE CLUSTERED INDEX IX_tmp_staff_school_class ON #staff_school_class (StaffUSI);

        -- One role per staff. If multiple, prefer admin over teacher.
        SELECT StaffUSI, staff_classification
        INTO #staff_role
        FROM (
            SELECT
                staff_school.StaffUSI,
                staff_school.staff_classification,
                ROW_NUMBER() OVER(PARTITION BY staff_school.StaffUSI ORDER BY staff_classification) as seq
            FROM #staff_school_class AS staff_school
            LEFT JOIN #teaching_staff ts
                ON staff_school.StaffUSI = ts.StaffUSI
            -- either has a staff_classification, or teaches a section
            WHERE (staff_school.staff_classification IS NOT NULL OR ts.StaffUSI IS NOT NULL)
        ) x
        WHERE seq = 1;
        CREATE CLUSTERED INDEX IX_tmp_staff_role ON #staff_role (StaffUSI);

        -- Staff org associations (single classification per staff, joined from staff_role)
        SELECT DISTINCT
            ssa.StaffUSI,
            ssa.SchoolId,
            sr.staff_classification,
            ssa.CreateDate
        INTO #staff_orgs
        FROM edfi.StaffSchoolAssociation ssa
            LEFT JOIN #staff_role sr ON ssa.StaffUSI = sr.StaffUSI;
        CREATE CLUSTERED INDEX IX_tmp_staff_orgs ON #staff_orgs (StaffUSI, SchoolId);

        -- Staff primary org (most recently created assignment)
        SELECT StaffUSI, SchoolId
        INTO #staff_primary_org
        FROM (
            SELECT
                so.StaffUSI,
                so.SchoolId,
                ROW_NUMBER() OVER (
                    PARTITION BY so.StaffUSI
                    ORDER BY so.CreateDate DESC, so.SchoolId
                ) AS seq
            FROM #staff_orgs so
        ) ranked
        WHERE seq = 1;
        CREATE CLUSTERED INDEX IX_tmp_staff_primary_org ON #staff_primary_org (StaffUSI);

        -- Distinct (staff, school, classification) so multiple associations to the same
        -- school do not duplicate the org in roles.
        SELECT
            StaffUSI,
            SchoolId,
            staff_classification,
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedid
        INTO #staff_orgs_distinct
        FROM #staff_orgs
        GROUP BY StaffUSI, SchoolId, staff_classification;
        CREATE CLUSTERED INDEX IX_tmp_staff_orgs_distinct ON #staff_orgs_distinct (StaffUSI);

        -- roles JSON per staff (set-based STRING_AGG). A NULL classification omits the
        -- "role" key, matching the prior FOR JSON output.
        SELECT
            sod.StaffUSI,
            '[' + STRING_AGG(
                CAST(
                    '{"roleType":"' +
                    CASE WHEN spo.SchoolId IS NOT NULL AND sod.SchoolId = spo.SchoolId
                         THEN 'primary' ELSE 'secondary' END + '"' +
                    ISNULL(',"role":"' + sod.staff_classification + '"', '') +
                    ',"org":{"href":"/orgs/' + sod.sourcedid +
                    '","sourcedId":"' + sod.sourcedid + '","type":"org"}}'
                AS NVARCHAR(MAX)),
                ','
            ) WITHIN GROUP (ORDER BY sod.SchoolId) + ']' AS roles
        INTO #staff_orgs_agg
        FROM #staff_orgs_distinct sod
            LEFT JOIN #staff_primary_org spo ON spo.StaffUSI = sod.StaffUSI
        GROUP BY sod.StaffUSI;
        CREATE CLUSTERED INDEX IX_tmp_staff_orgs_agg ON #staff_orgs_agg (StaffUSI);

        -- Distinct (staff, school): one user row per school
        SELECT DISTINCT StaffUSI, SchoolId
        INTO #staff_school
        FROM #staff_orgs;
        CREATE CLUSTERED INDEX IX_tmp_staff_school ON #staff_school (StaffUSI, SchoolId);

        -- ---- Parents --------------------------------------------------------

        -- Preferred parent email (primary, publishable)
        SELECT ParentUSI, ElectronicMailAddress
        INTO #parent_email
        FROM (
            SELECT DISTINCT
                ceo.ParentUSI,
                ceo.ElectronicMailAddress,
                ROW_NUMBER() OVER (
                    PARTITION BY ceo.ParentUSI
                    ORDER BY ceo.ElectronicMailAddress
                ) as email_rank
            FROM edfi.ParentElectronicMail ceo
            WHERE ceo.PrimaryEmailAddressIndicator = 1
                AND ceo.DoNotPublishIndicator = 0
                AND ceo.ElectronicMailAddress IS NOT NULL
        ) x
        WHERE x.email_rank = 1;
        CREATE CLUSTERED INDEX IX_tmp_parent_email ON #parent_email (ParentUSI);

        -- Parent org associations, deduped to one row per (parent, school) first, so a
        -- parent linked to a student with multiple enrollments (or to two students at
        -- the same school) does not fan out or duplicate the org in the parent's roles.
        SELECT
            ParentUSI,
            SchoolId,
            ROW_NUMBER() OVER (
                PARTITION BY ParentUSI
                ORDER BY max_entrydate DESC, SchoolId
            ) AS seq
        INTO #parent_orgs
        FROM (
            SELECT
                sca.ParentUSI,
                s.SchoolId,
                MAX(ssa.EntryDate) AS max_entrydate
            FROM edfi.StudentParentAssociation sca
            JOIN edfi.StudentSchoolAssociation ssa ON sca.StudentUSI = ssa.StudentUSI
            JOIN edfi.School s ON ssa.SchoolId = s.SchoolId
            GROUP BY sca.ParentUSI, s.SchoolId
        ) distinct_parent_school;
        CREATE CLUSTERED INDEX IX_tmp_parent_orgs ON #parent_orgs (ParentUSI);

        -- Parent primary org (keys the single parent user row)
        SELECT ParentUSI, SchoolId
        INTO #parent_primary_org
        FROM #parent_orgs
        WHERE seq = 1;
        CREATE CLUSTERED INDEX IX_tmp_parent_primary_org ON #parent_primary_org (ParentUSI);

        -- roles JSON per parent
        SELECT
            po.ParentUSI,
            '[' + STRING_AGG(
                CAST(
                '{"roleType":"primary","role":"parent","org":{"href":"/orgs/' +
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(po.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) +
                    '","sourcedId":"' +
                    LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST(po.SchoolId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) +
                    '","type":"org"}}'
                AS NVARCHAR(MAX)), ','
            ) + ']' AS roles
        INTO #parent_roles
        FROM #parent_orgs po
        GROUP BY po.ParentUSI;
        CREATE CLUSTERED INDEX IX_tmp_parent_roles ON #parent_roles (ParentUSI);

        -- Populate staging from the #temp tables: three inserts (one per user type),
        -- each planned independently. Column order matches #staging_users.

        -- Students
        INSERT INTO #staging_users
        SELECT
            LOWER(CONVERT(
                VARCHAR(32),
                HASHBYTES(
                    'MD5',
                    CONVERT(
                        VARCHAR(4000),
                        CASE
                            WHEN so.SchoolId IS NOT NULL THEN
                                'STU-' + CONVERT(VARCHAR(256), s.StudentUniqueId) + '-' + CONVERT(VARCHAR(20), so.SchoolId)
                            ELSE
                                'STU-' + CONVERT(VARCHAR(256), s.StudentUniqueId)
                        END
                    ) COLLATE Latin1_General_BIN
                ),
                2
            )) AS sourcedId,
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
            NULL AS preferredFirstName, -- DS4 doesn't have PreferredFirstName column
            NULL AS preferredMiddleName,
            NULL AS preferredLastName, -- DS4 doesn't have PreferredLastSurname column
            NULL AS pronouns,
            'student' AS role,
            soa.roles AS roles,
            NULL AS userProfiles,
            CAST(s.StudentUniqueId AS NVARCHAR(256)) AS identifier,
            so.SchoolId AS educationOrganizationId,
            s.StudentUSI AS participantUSI,
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
                '{"edfi":{"resource":"students","naturalKey":{"studentUniqueId":"' + CAST(s.StudentUniqueId AS NVARCHAR(256)) + '"},"educationOrganizationId":' +
                    ISNULL(CONVERT(VARCHAR(20), so.SchoolId), 'null') +
                '}}'
            ) AS metadata
        FROM edfi.Student s
            LEFT JOIN #student_email se ON s.StudentUSI = se.StudentUSI
            LEFT JOIN #student_grade sg ON s.StudentUSI = sg.StudentUSI
            -- dedupe to one row per (student, school): a student with multiple
            -- associations to the same school (e.g. re-enrollments) must not
            -- duplicate the school-keyed user sourcedId.
            LEFT JOIN #student_school so ON s.StudentUSI = so.StudentUSI
            LEFT JOIN #student_ids si ON s.StudentUSI = si.StudentUSI AND so.SchoolId = si.EducationOrganizationId
            LEFT JOIN #student_orgs_agg soa ON s.StudentUSI = soa.StudentUSI;

        -- Staff
        INSERT INTO #staging_users
        SELECT
            LOWER(CONVERT(
                VARCHAR(32),
                HASHBYTES(
                    'MD5',
                    CONVERT(
                        VARCHAR(4000),
                        CASE
                            WHEN sso.SchoolId IS NULL THEN
                                'STA-' + CONVERT(VARCHAR(256), st.StaffUniqueId)
                            ELSE
                                'STA-' + CONVERT(VARCHAR(256), st.StaffUniqueId) + '-' + CONVERT(VARCHAR(20), sso.SchoolId)
                        END
                    ) COLLATE Latin1_General_BIN
                ),
                2
            )) AS sourcedId,
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
            NULL AS preferredFirstName, -- DS4 doesn't have PreferredFirstName column
            NULL AS preferredMiddleName,
            NULL AS preferredLastName, -- DS4 doesn't have PreferredLastSurname column
            NULL AS pronouns,
            sr.staff_classification AS role,
            stoa.roles AS roles,
            NULL AS userProfiles,
            CAST(st.StaffUniqueId AS NVARCHAR(256)) AS identifier,
            sso.SchoolId AS educationOrganizationId,
            st.StaffUSI AS participantUSI,
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
                    '"staffClassification":' + ISNULL('"' + sr.staff_classification + '"', 'null') + ',' +
                    '"educationOrganizationId":' + ISNULL(CONVERT(VARCHAR(20), sso.SchoolId), 'null') + '}' +
                '}'
            ) AS metadata
        FROM edfi.staff st
            LEFT JOIN #staff_email ste ON st.staffusi = ste.staffusi
            LEFT JOIN #staff_role sr ON st.StaffUSI = sr.StaffUSI
            LEFT JOIN #staff_ids si ON st.StaffUSI = si.StaffUSI
            LEFT JOIN #staff_orgs_agg stoa ON st.StaffUSI = stoa.StaffUSI
            LEFT JOIN #staff_school sso ON st.StaffUSI = sso.StaffUSI;

        -- Parents
        INSERT INTO #staging_users
        SELECT
            LOWER(CONVERT(
                VARCHAR(32),
                HASHBYTES(
                    'MD5',
                    CONVERT(
                        VARCHAR(4000),
                        CASE
                            WHEN ppo.SchoolId IS NOT NULL THEN
                                'PAR-' + CONVERT(VARCHAR(256), p.parentUniqueId) + '-' + CONVERT(VARCHAR(20), ppo.SchoolId)
                            ELSE
                                'PAR-' + CONVERT(VARCHAR(256), p.parentUniqueId)
                        END
                    ) COLLATE Latin1_General_BIN
                ),
                2
            )) AS sourcedId,
            'active' AS status,
            p.lastmodifieddate AS dateLastModified,
            NULL AS userMasterIdentifier,
            CASE WHEN ce.electronicmailaddress IS NULL THEN '' ELSE ce.electronicmailaddress END AS username,
            '[{"type":"parentUniqueId","identifier":"' + CAST(p.parentUniqueId AS NVARCHAR(256)) + '"}]' AS userIds,
            'true' AS enabledUser,
            p.firstname AS givenName,
            p.lastsurname AS familyName,
            p.middlename AS middleName,
            NULL AS preferredFirstName, -- DS4 doesn't have preferredfirstname column
            NULL AS preferredMiddleName,
            NULL AS preferredLastName, -- DS4 doesn't have preferredlastsurname column
            NULL AS pronouns,
            'parent' AS role,
            pr.roles AS roles,
            NULL AS userProfiles,
            CAST(p.parentuniqueid AS NVARCHAR(256)) AS identifier,
            ppo.SchoolId AS educationOrganizationId,
            p.ParentUSI AS participantUSI,
            ce.electronicmailaddress AS email,
            NULL AS sms,
            NULL AS phone,
            NULL AS agentSourceIds,
            NULL AS grades,
            NULL AS password,
            JSON_QUERY(
                '{"edfi":{"resource":"parents","naturalKey":{"parentUniqueId":"' + CAST(p.parentUniqueId AS NVARCHAR(256)) + '"},"educationOrganizationId":' +
                    ISNULL(CONVERT(VARCHAR(20), ppo.SchoolId), 'null') +
                '}}'
            ) AS metadata
        FROM edfi.parent p
            LEFT JOIN #parent_email ce ON p.parentusi = ce.parentusi
            LEFT JOIN #parent_roles pr ON p.ParentUSI = pr.ParentUSI
            LEFT JOIN #parent_primary_org ppo ON p.ParentUSI = ppo.ParentUSI
        ;

        -- Enforce sourcedId uniqueness once, after load - cheaper than a clustered key
        -- on the random MD5, and fails fast on duplicates before the swap.
        CREATE UNIQUE NONCLUSTERED INDEX IX_staging_users_sourcedId
            ON #staging_users (sourcedId);

        SET @RowCount = (SELECT COUNT(*) FROM #staging_users);

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
