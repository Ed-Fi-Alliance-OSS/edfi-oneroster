#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.
#
# Seeds EdFi_Admin on SQL Server with:
#   - ODS instance connection string (dbo.OdsInstances)
#   - Test Vendor, User, Application
#   - LEA and School API clients
#
# Required environment variables (injected by setup-admin-data.psm1 via docker exec -e):
#   SQLSERVER_USER          SQL Server login name
#   SQLSERVER_PASSWORD      SQL Server login password
#   SQLSERVER_ODS_HOST      Hostname of the ODS SQL Server (e.g. ed-fi-db-ods)
#   LEA_KEY / LEA_SECRET
#   SCHOOL_KEY / SCHOOL_SECRET

set -e
set +x

SQLCMD=/opt/mssql-tools18/bin/sqlcmd

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
sql_escape() {
    # Doubles single-quotes for safe embedding in T-SQL string literals
    printf "%s" "$1" | sed "s/'/''/g"
}

LEA_KEY_SQL=$(sql_escape "${LEA_KEY}")
LEA_SECRET_SQL=$(sql_escape "${LEA_SECRET}")
SCHOOL_KEY_SQL=$(sql_escape "${SCHOOL_KEY}")
SCHOOL_SECRET_SQL=$(sql_escape "${SCHOOL_SECRET}")

# Build the MSSQL ODS connection string (ADO.NET / SQL Server format)
ODS_CONN="Data Source=${SQLSERVER_ODS_HOST};Initial Catalog=EdFi_Ods;User Id=${SQLSERVER_USER};Password=${SQLSERVER_PASSWORD};Application Name=EdFi.Ods.WebApi;Integrated Security=false;Encrypt=false;TrustServerCertificate=true;"
ODS_CONN_SQL=$(sql_escape "${ODS_CONN}")

echo "Seeding EdFi_Admin on SQL Server..."

$SQLCMD -C -b \
  -S "localhost" \
  -U "${SQLSERVER_USER}" \
  -P "${SQLSERVER_PASSWORD}" \
  -d "EdFi_Admin" \
  -Q "
SET NOCOUNT ON;

-- -----------------------------------------------------------------------
-- OdsInstances: upsert the single ODS record
-- -----------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM dbo.OdsInstances WHERE [Name] = 'Ods Instance' AND InstanceType = 'ODS')
BEGIN
    UPDATE dbo.OdsInstances
    SET    ConnectionString = '${ODS_CONN_SQL}'
    WHERE  [Name] = 'Ods Instance' AND InstanceType = 'ODS';
END
ELSE
BEGIN
    INSERT INTO dbo.OdsInstances ([Name], InstanceType, ConnectionString)
    VALUES ('Ods Instance', 'ODS', '${ODS_CONN_SQL}');
END

DECLARE @OdsInstanceId INT = (
    SELECT OdsInstanceId FROM dbo.OdsInstances
    WHERE [Name] = 'Ods Instance' AND InstanceType = 'ODS'
);

-- -----------------------------------------------------------------------
-- Vendor
-- -----------------------------------------------------------------------
DECLARE @VendorName   NVARCHAR(150) = 'Test Vendor';
DECLARE @NSPrefix     NVARCHAR(255) = 'uri://ed-fi.org';
DECLARE @VendorId     INT;

SELECT @VendorId = VendorId FROM dbo.Vendors WHERE VendorName = @VendorName;
IF @VendorId IS NULL
BEGIN
    INSERT INTO dbo.Vendors (VendorName) VALUES (@VendorName);
    SET @VendorId = SCOPE_IDENTITY();
END

DELETE FROM dbo.VendorNamespacePrefixes WHERE Vendor_VendorId = @VendorId;
INSERT INTO dbo.VendorNamespacePrefixes (Vendor_VendorId, NamespacePrefix)
VALUES (@VendorId, @NSPrefix);

-- -----------------------------------------------------------------------
-- User
-- -----------------------------------------------------------------------
DECLARE @UserFullName NVARCHAR(150) = 'Test User';
DECLARE @UserEmail    NVARCHAR(150) = 'testuser@ed-fi.org';
DECLARE @UserId       INT;

SELECT @UserId = UserId FROM dbo.Users WHERE FullName = @UserFullName AND Vendor_VendorId = @VendorId;
IF @UserId IS NULL
BEGIN
    INSERT INTO dbo.Users (Email, FullName, Vendor_VendorId)
    VALUES (@UserEmail, @UserFullName, @VendorId);
    SET @UserId = SCOPE_IDENTITY();
END
ELSE
    UPDATE dbo.Users SET Email = @UserEmail WHERE UserId = @UserId;

-- -----------------------------------------------------------------------
-- Application
-- -----------------------------------------------------------------------
DECLARE @AppName      NVARCHAR(255) = 'Test Application';
DECLARE @ClaimSet     NVARCHAR(255) = 'Ed-Fi Sandbox';
DECLARE @AppId        INT;

SELECT @AppId = ApplicationId FROM dbo.Applications
WHERE ApplicationName = @AppName AND Vendor_VendorId = @VendorId;

IF @AppId IS NULL
BEGIN
    INSERT INTO dbo.Applications (ApplicationName, Vendor_VendorId, ClaimSetName)
    VALUES (@AppName, @VendorId, @ClaimSet);
    SET @AppId = SCOPE_IDENTITY();
END
ELSE
    UPDATE dbo.Applications SET ClaimSetName = @ClaimSet WHERE ApplicationId = @AppId;

-- -----------------------------------------------------------------------
-- ApiClients (LEA + School) -- loop via cursor
-- -----------------------------------------------------------------------
-- Clear existing ed-org associations for this application so they are rebuilt cleanly.
DELETE acaeo
FROM   dbo.ApiClientApplicationEducationOrganizations acaeo
INNER JOIN dbo.ApplicationEducationOrganizations aeo
       ON aeo.ApplicationEducationOrganizationId = acaeo.ApplicationEdOrg_ApplicationEdOrgId
WHERE  aeo.Application_ApplicationId = @AppId;

DELETE FROM dbo.ApplicationEducationOrganizations WHERE Application_ApplicationId = @AppId;

DECLARE @Clients TABLE (
    ClientName   NVARCHAR(50),
    ClientKey    NVARCHAR(50),
    ClientSecret NVARCHAR(100),
    EdOrgId      INT
);

INSERT INTO @Clients VALUES
    ('LEA Test Api Client',    '${LEA_KEY_SQL}',    '${LEA_SECRET_SQL}',    255901),
    ('School Test Api Client', '${SCHOOL_KEY_SQL}', '${SCHOOL_SECRET_SQL}', 255901107);

DECLARE @ClientName   NVARCHAR(50);
DECLARE @ClientKey    NVARCHAR(50);
DECLARE @ClientSecret NVARCHAR(100);
DECLARE @EdOrgId      INT;
DECLARE @ApiClientId  INT;
DECLARE @AppEdOrgId   INT;

DECLARE client_cur CURSOR FOR SELECT ClientName, ClientKey, ClientSecret, EdOrgId FROM @Clients;
OPEN client_cur;
FETCH NEXT FROM client_cur INTO @ClientName, @ClientKey, @ClientSecret, @EdOrgId;

WHILE @@FETCH_STATUS = 0
BEGIN
    SELECT @ApiClientId = ApiClientId FROM dbo.ApiClients
    WHERE  Application_ApplicationId = @AppId AND [Name] = @ClientName;

    IF @ApiClientId IS NULL
    BEGIN
        INSERT INTO dbo.ApiClients
            ([Key], Secret, [Name], IsApproved, UseSandbox, SandboxType,
             Application_ApplicationId, User_UserId, SecretIsHashed)
        VALUES
            (@ClientKey, @ClientSecret, @ClientName, 1, 0, 1,
             @AppId, @UserId, 0);
        SET @ApiClientId = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.ApiClients
        SET    [Key] = @ClientKey, Secret = @ClientSecret,
               UseSandbox = 0, SandboxType = 1,
               User_UserId = @UserId, SecretIsHashed = 0
        WHERE  ApiClientId = @ApiClientId;
    END

    -- ApiClientOdsInstance
    IF NOT EXISTS (
        SELECT 1 FROM dbo.ApiClientOdsInstances
        WHERE ApiClient_ApiClientId = @ApiClientId
          AND OdsInstance_OdsInstanceId = @OdsInstanceId
    )
        INSERT INTO dbo.ApiClientOdsInstances (ApiClient_ApiClientId, OdsInstance_OdsInstanceId)
        VALUES (@ApiClientId, @OdsInstanceId);

    -- ApplicationEducationOrganization
    IF @EdOrgId IS NOT NULL
    BEGIN
        INSERT INTO dbo.ApplicationEducationOrganizations
            (EducationOrganizationId, Application_ApplicationId)
        VALUES (@EdOrgId, @AppId);
        SET @AppEdOrgId = SCOPE_IDENTITY();

        INSERT INTO dbo.ApiClientApplicationEducationOrganizations
            (ApplicationEdOrg_ApplicationEdOrgId, ApiClient_ApiClientId)
        VALUES (@AppEdOrgId, @ApiClientId);
    END

    FETCH NEXT FROM client_cur INTO @ClientName, @ClientKey, @ClientSecret, @EdOrgId;
END

CLOSE client_cur;
DEALLOCATE client_cur;

PRINT 'Admin bootstrap completed successfully.';
"

echo "Admin bootstrap completed."
