-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- =============================================
-- MS SQL Server Setup for Demographics
-- Creates table, indexes, and refresh procedure
-- Based on PostgreSQL demographics materialized view
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================
-- Drop and Create Demographics Table
-- =============================================
IF OBJECT_ID('oneroster12.demographics', 'U') IS NOT NULL
    DROP TABLE oneroster12.demographics;
GO

CREATE TABLE oneroster12.demographics (
    sourcedId NVARCHAR(64) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    dateLastModified DATETIME2 NULL,
    birthDate NVARCHAR(32) NULL,
    sex NVARCHAR(32) NULL,
    americanIndianOrAlaskaNative NVARCHAR(8) NULL,
    asian NVARCHAR(8) NULL,
    blackOrAfricanAmerican NVARCHAR(8) NULL,
    nativeHawaiianOrOtherPacificIslander NVARCHAR(8) NULL,
    white NVARCHAR(8) NULL,
    demographicRaceTwoOrMoreRaces NVARCHAR(8) NULL,
    hispanicOrLatinoEthnicity NVARCHAR(8) NULL,
    countryOfBirthCode NVARCHAR(8) NULL,
    stateOfBirthAbbreviation NVARCHAR(8) NULL,
    cityOfBirth NVARCHAR(256) NULL,
    publicSchoolResidenceStatus NVARCHAR(256) NULL,
    metadata NVARCHAR(MAX) NULL -- JSON
);
GO

-- =============================================
-- Create Indexes for Demographics
-- =============================================

    ALTER TABLE oneroster12.demographics ADD CONSTRAINT PK_demographics PRIMARY KEY (sourcedId);
    PRINT '  ✓ Created primary key on demographics';

-- Unique index on sourcedId for lookups
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.demographics') AND name = 'IX_demographics_sourcedId')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_demographics_sourcedId ON oneroster12.demographics (sourcedId);
    PRINT '  ✓ Created IX_demographics_sourcedId unique index on demographics';
END;


-- Primary access patterns: by birthDate, by sex, by race fields
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.demographics') AND name = 'IX_demographics_birthdate_sex')
BEGIN
    CREATE INDEX IX_demographics_birthdate_sex ON oneroster12.demographics (birthDate, sex) WHERE birthDate IS NOT NULL;
    PRINT '  ✓ Created IX_demographics_birthdate_sex on demographics';
END;

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('oneroster12.demographics') AND name = 'IX_demographics_race_flags')
BEGIN
    CREATE INDEX IX_demographics_race_flags ON oneroster12.demographics (
        americanIndianOrAlaskaNative, asian, blackOrAfricanAmerican,
        nativeHawaiianOrOtherPacificIslander, white, hispanicOrLatinoEthnicity
    ) WHERE americanIndianOrAlaskaNative = 'true';
    PRINT '  ✓ Created IX_demographics_race_flags on demographics';
END;
GO

IF OBJECT_ID('oneroster12.sp_refresh_demographics', 'P') IS NOT NULL
    DROP PROCEDURE oneroster12.sp_refresh_demographics;
GO

CREATE PROCEDURE oneroster12.sp_refresh_demographics
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
    VALUES ('demographics', @StartTime, 'Running');

    DECLARE @HistoryID INT = SCOPE_IDENTITY();

    BEGIN TRY
        -- Create staging table
        IF OBJECT_ID('tempdb..#staging_demographics') IS NOT NULL
            DROP TABLE #staging_demographics;

        CREATE TABLE #staging_demographics (
            sourcedId NVARCHAR(64) NOT NULL,
            status NVARCHAR(16) NOT NULL,
            dateLastModified DATETIME2 NULL,
            birthDate NVARCHAR(32) NULL,
            sex NVARCHAR(32) NULL,
            americanIndianOrAlaskaNative NVARCHAR(8) NULL,
            asian NVARCHAR(8) NULL,
            blackOrAfricanAmerican NVARCHAR(8) NULL,
            nativeHawaiianOrOtherPacificIslander NVARCHAR(8) NULL,
            white NVARCHAR(8) NULL,
            demographicRaceTwoOrMoreRaces NVARCHAR(8) NULL,
            hispanicOrLatinoEthnicity NVARCHAR(8) NULL,
            countryOfBirthCode NVARCHAR(8) NULL,
            stateOfBirthAbbreviation NVARCHAR(8) NULL,
            cityOfBirth NVARCHAR(256) NULL,
            publicSchoolResidenceStatus NVARCHAR(256) NULL,
            metadata NVARCHAR(MAX) NULL
        );

        -- Insert data into staging table following PostgreSQL pattern exactly
        WITH student AS (
            SELECT * FROM edfi.Student
        ),
        student_hispanic AS (
            SELECT
                StudentUSI,
                CAST(MAX(CAST(HispanicLatinoEthnicity AS INT)) AS BIT) AS hispaniclatinoethnicity,
                MAX(LastModifiedDate) AS edorg_lmdate
            FROM edfi.StudentEducationOrganizationAssociation
            GROUP BY StudentUSI
        ),
        student_race AS (
            SELECT
                StudentUSI,
                STRING_AGG(CAST(mappedracedescriptor.MappedValue AS NVARCHAR(MAX)), ',') AS race_values,
                -- Check for specific race values
                MAX(CASE WHEN mappedracedescriptor.MappedValue = 'americanIndianOrAlaskaNative' THEN 1 ELSE 0 END) AS americanIndianOrAlaskaNative,
                MAX(CASE WHEN mappedracedescriptor.MappedValue = 'asian' THEN 1 ELSE 0 END) AS asian,
                MAX(CASE WHEN mappedracedescriptor.MappedValue = 'blackOrAfricanAmerican' THEN 1 ELSE 0 END) AS blackOrAfricanAmerican,
                MAX(CASE WHEN mappedracedescriptor.MappedValue = 'nativeHawaiianOrOtherPacificIslander' THEN 1 ELSE 0 END) AS nativeHawaiianOrOtherPacificIslander,
                MAX(CASE WHEN mappedracedescriptor.MappedValue = 'white' THEN 1 ELSE 0 END) AS white,
                -- Count ALL race records (mapped + unmapped) to match PostgreSQL logic
                COUNT(DISTINCT racedescriptor.CodeValue) AS race_count
            FROM edfi.StudentEducationOrganizationAssociationRace seoar
            JOIN edfi.Descriptor racedescriptor ON seoar.RaceDescriptorId = racedescriptor.DescriptorId
            LEFT JOIN edfi.DescriptorMapping mappedracedescriptor
                ON mappedracedescriptor.Value = racedescriptor.CodeValue
                AND mappedracedescriptor.Namespace = racedescriptor.Namespace
                AND mappedracedescriptor.MappedNamespace = 'uri://1edtech.org/oneroster12/RaceDescriptor'
            GROUP BY StudentUSI
        )
        INSERT INTO #staging_demographics
        SELECT
            LOWER(CONVERT(VARCHAR(32), HASHBYTES('MD5', CAST('STU-' + student.StudentUniqueId AS VARCHAR(MAX)) COLLATE Latin1_General_BIN), 2)) AS sourcedId,
            'active' AS status,
            CASE
                WHEN sh.edorg_lmdate > student.LastModifiedDate THEN sh.edorg_lmdate
                ELSE student.LastModifiedDate
            END AS dateLastModified,
            CONVERT(NVARCHAR(32), student.BirthDate, 23) AS birthDate,
            mappedsexdescriptor.MappedValue AS sex,
            CASE WHEN ISNULL(student_race.americanIndianOrAlaskaNative, 0) = 1 THEN 'true' ELSE 'false' END AS americanIndianOrAlaskaNative,
            CASE WHEN ISNULL(student_race.asian, 0) = 1 THEN 'true' ELSE 'false' END AS asian,
            CASE WHEN ISNULL(student_race.blackOrAfricanAmerican, 0) = 1 THEN 'true' ELSE 'false' END AS blackOrAfricanAmerican,
            CASE WHEN ISNULL(student_race.nativeHawaiianOrOtherPacificIslander, 0) = 1 THEN 'true' ELSE 'false' END AS nativeHawaiianOrOtherPacificIslander,
            CASE WHEN ISNULL(student_race.white, 0) = 1 THEN 'true' ELSE 'false' END AS white,
            CASE WHEN student_race.race_count > 1 THEN 'true' ELSE 'false' END AS demographicRaceTwoOrMoreRaces,
            CASE WHEN ISNULL(sh.hispaniclatinoethnicity, 0) = 1 THEN 'true' ELSE 'false' END AS hispanicOrLatinoEthnicity,
            countrydescriptor.CodeValue AS countryOfBirthCode,
            statedescriptor.CodeValue AS stateOfBirthAbbreviation,
            student.BirthCity AS cityOfBirth,
            NULL AS publicSchoolResidenceStatus,
            (SELECT
                'students' AS [edfi.resource],
                student.StudentUniqueId AS [edfi.naturalKey.studentUniqueId]
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS metadata
        FROM student
        LEFT JOIN student_hispanic sh ON student.StudentUSI = sh.StudentUSI
        LEFT JOIN student_race ON student.StudentUSI = student_race.StudentUSI
        LEFT JOIN edfi.Descriptor sexdescriptor ON student.BirthSexDescriptorId = sexdescriptor.DescriptorId
        LEFT JOIN edfi.DescriptorMapping mappedsexdescriptor
            ON mappedsexdescriptor.Value = sexdescriptor.CodeValue
            AND mappedsexdescriptor.Namespace = sexdescriptor.Namespace
            AND mappedsexdescriptor.MappedNamespace = 'uri://1edtech.org/oneroster12/SexDescriptor'
        LEFT JOIN edfi.Descriptor countrydescriptor ON student.BirthCountryDescriptorId = countrydescriptor.DescriptorId
        LEFT JOIN edfi.Descriptor statedescriptor ON student.BirthStateAbbreviationDescriptorId = statedescriptor.DescriptorId;

        SET @RowCount = @@ROWCOUNT;

        -- Atomic swap
        BEGIN TRANSACTION;
            TRUNCATE TABLE oneroster12.demographics;

            INSERT INTO oneroster12.demographics
                (sourcedId, status, dateLastModified, birthDate, sex,
                 americanIndianOrAlaskaNative, asian, blackOrAfricanAmerican,
                 nativeHawaiianOrOtherPacificIslander, white, demographicRaceTwoOrMoreRaces,
                 hispanicOrLatinoEthnicity, countryOfBirthCode, stateOfBirthAbbreviation,
                 cityOfBirth, publicSchoolResidenceStatus, metadata)
            SELECT
                sourcedId, status, dateLastModified, birthDate, sex,
                americanIndianOrAlaskaNative, asian, blackOrAfricanAmerican,
                nativeHawaiianOrOtherPacificIslander, white, demographicRaceTwoOrMoreRaces,
                hispanicOrLatinoEthnicity, countryOfBirthCode, stateOfBirthAbbreviation,
                cityOfBirth, publicSchoolResidenceStatus, metadata
            FROM #staging_demographics;
        COMMIT TRANSACTION;

        -- Update history with success
        UPDATE oneroster12.refresh_history
        SET refresh_end = GETDATE(),
            status = 'Success',
            row_count = @RowCount
        WHERE history_id = @HistoryID;

        -- Clean up
        DROP TABLE #staging_demographics;

        PRINT CONCAT('Demographics refresh completed successfully. Rows: ', @RowCount);

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
            ('demographics', @ErrorMessage, @ErrorSeverity, @ErrorState,
             'sp_refresh_demographics', ERROR_LINE());

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

PRINT 'Stored procedure oneroster12.sp_refresh_demographics created successfully';
GO
