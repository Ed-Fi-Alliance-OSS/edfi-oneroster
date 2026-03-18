#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

set -e
set +x

if [ -z "${POSTGRES_PORT:-}" ]; then
  export POSTGRES_PORT=5432
fi

EDFI_ODS_CONNECTION_STRING="host=$ODS_POSTGRES_HOST;port=$POSTGRES_PORT;username=$POSTGRES_USER;password=$POSTGRES_PASSWORD;database=EdFi_Ods;application name=EdFi.Ods.WebApi;pooling=${NPG_POOLING_ENABLED};minimum pool size=10;maximum pool size=${NPG_API_MAX_POOL_SIZE_ODS};"

psql --username "$POSTGRES_USER" --port $POSTGRES_PORT --dbname "EdFi_Admin" <<-EOSQL

UPDATE dbo.OdsInstances SET ConnectionString = '$EDFI_ODS_CONNECTION_STRING'
WHERE  EXISTS (SELECT 1 FROM dbo.OdsInstances WHERE Name = 'Ods Instance' AND InstanceType = 'ODS');

INSERT INTO dbo.OdsInstances (Name, InstanceType, ConnectionString)
SELECT 'Ods Instance', 'ODS', '$EDFI_ODS_CONNECTION_STRING'
WHERE NOT EXISTS (SELECT 1 FROM dbo.OdsInstances WHERE Name = 'Ods Instance' AND InstanceType = 'ODS');

DO \$\$
DECLARE

vendor_name varchar(150) := 'Test Vendor';
namespace_prefix varchar(255) := 'uri://ed-fi.org';
user_full_name varchar(150) := 'Test User';
user_email_address varchar(150) := 'testuser@ed-fi.org';
application_name varchar(255) := 'Test Application';
claimset_name varchar(255) := 'Ed-Fi Sandbox';

lea_api_client_name varchar(50) := 'LEA Test Api Client';
lea_client_key varchar(50) := 'leatestkey';
lea_client_secret varchar(100) := 'leatestsecret';
lea_education_organization_id int := 255901; --Must be an ed-org in the ODS

school_api_client_name varchar(50) := 'School Test Api Client';
school_client_key varchar(50) := 'schooltestkey';
school_client_secret varchar(100) := 'schooltestsecret';
school_education_organization_id int := 255901107; --Must be an ed-org in the ODS

ods_instance_id int := (SELECT OdsInstanceId FROM dbo.OdsInstances WHERE Name = 'Ods Instance' AND InstanceType = 'ODS');

is_populated_sandbox int := 1;
-- For Non-Sandbox deployments
use_sandbox boolean := False;
-- For Sandbox
--use_sandbox bit = 1;

vendor_id int;
user_id int;
application_id int;
application_education_organization_id int;
api_client_id int;
client_rec record;

BEGIN
-- Clear is_populated_sandbox if not using sandbox
IF NOT use_sandbox
THEN
    SELECT 0 INTO is_populated_sandbox;
END IF;

-- Ensure Vendor exists
SELECT VendorId INTO vendor_id FROM dbo.Vendors WHERE VendorName = vendor_name;

IF(vendor_id IS NULL)
THEN
    INSERT INTO dbo.Vendors (VendorName)
    VALUES (vendor_name);

    SELECT LASTVAL() INTO vendor_id;
END IF;

-- Ensure correct namespace prefixes are set up
DELETE FROM dbo.VendorNamespacePrefixes WHERE Vendor_VendorId = vendor_id;
INSERT INTO dbo.VendorNamespacePrefixes (Vendor_VendorId, NamespacePrefix)
VALUES (vendor_id, namespace_prefix);

-- Ensure User exists for test Vendor
SELECT UserId INTO user_id FROM dbo.Users WHERE FullName = user_full_name AND Vendor_VendorId = vendor_id;


IF(user_id IS NULL)
THEN
    INSERT INTO dbo.Users (Email, FullName, Vendor_VendorId)
    VALUES (user_email_address, user_full_name, vendor_id);

    SELECT LASTVAL() INTO user_id;
ELSE
	UPDATE dbo.Users SET Email = user_email_address WHERE UserId = user_id;
END IF;

-- Ensure Application exists
SELECT ApplicationId INTO application_id FROM dbo.Applications WHERE ApplicationName = application_name AND Vendor_VendorId = vendor_id;

IF (application_id IS NULL)
THEN
    INSERT INTO dbo.Applications (ApplicationName, Vendor_VendorId, ClaimSetName)
    VALUES (application_name, vendor_id, claimset_name);

	SELECT LASTVAL() INTO application_id;
ELSE
	UPDATE dbo.Applications SET ClaimSetName = claimset_name WHERE ApplicationId = application_id;
END IF;

-- Ensure ApiClient exists
-- Reset ed-org associations; the loop below re-populates the desired set.
DELETE
FROM dbo.ApiClientApplicationEducationOrganizations WHERE
ApplicationEdOrg_ApplicationEdOrgId IN ( SELECT ApplicationEducationOrganizationId
                                             FROM dbo.ApplicationEducationOrganizations
                                             WHERE Application_ApplicationId = application_id);
DELETE FROM dbo.ApplicationEducationOrganizations WHERE Application_ApplicationId = application_id;

FOR client_rec IN
    SELECT *
    FROM (VALUES
        (lea_api_client_name, lea_client_key, lea_client_secret, lea_education_organization_id),
        (school_api_client_name, school_client_key, school_client_secret, school_education_organization_id)
    ) AS client_data(api_client_name, client_key, client_secret, education_organization_id)
    WHERE client_data.api_client_name IS NOT NULL
LOOP
    -- Ensure ApiClient exists for each configured ed-org
    SELECT ApiClientId INTO api_client_id FROM dbo.ApiClients WHERE Application_ApplicationId = application_id AND Name = client_rec.api_client_name;

    IF(api_client_id IS NULL)
    THEN
        INSERT INTO dbo.ApiClients (Key, Secret, Name, IsApproved, UseSandbox, SandboxType, Application_ApplicationId, User_UserId, SecretIsHashed)
        VALUES (client_rec.client_key, client_rec.client_secret, client_rec.api_client_name, TRUE, use_sandbox, is_populated_sandbox, application_id, user_id, FALSE);

        SELECT  LASTVAL() INTO api_client_id;
    ELSE
        UPDATE dbo.ApiClients SET Key = client_rec.client_key, Secret = client_rec.client_secret, UseSandbox = use_sandbox, SandboxType = is_populated_sandbox, User_UserId = user_id, SecretIsHashed = FALSE WHERE ApiClientId = api_client_id;
    END IF;

    -- Ensure ApiClientOdsInstance exists
    INSERT INTO dbo.ApiClientOdsInstances (ApiClient_ApiClientId, OdsInstance_OdsInstanceId)
    SELECT api_client_id, ods_instance_id
    WHERE NOT EXISTS (SELECT * FROM dbo.ApiClientOdsInstances WHERE ApiClient_ApiClientId = api_client_id AND OdsInstance_OdsInstanceId = ods_instance_id);

    IF (client_rec.education_organization_id IS NOT NULL)
    THEN
        INSERT INTO dbo.ApplicationEducationOrganizations (EducationOrganizationId, Application_ApplicationId)
        VALUES (client_rec.education_organization_id, application_id);
        SELECT  LASTVAL() INTO application_education_organization_id;

        INSERT INTO dbo.ApiClientApplicationEducationOrganizations (applicationedorg_applicationedorgid, ApiClient_ApiClientId)
        VALUES (application_education_organization_id, api_client_id);
    END IF;
END LOOP;
END \$\$;

EOSQL
