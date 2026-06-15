#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Licensed to the Ed-Fi Alliance under one or more agreements.
# The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

set -e
set +x

STATUS_SA=1
STATUS_USER=1
while [[ $STATUS_SA -ne 0 && $STATUS_USER -ne 0 ]]; do
  >&2 echo "Waiting for server to be online... "
  STATUS_SA=$(/opt/mssql-tools18/bin/sqlcmd -C -W -h -1 -U sa -P "${SQLSERVER_PASSWORD}" -Q "SET NOCOUNT ON; SELECT SUM(state) FROM sys.databases" > /dev/null 2>&1 || echo 1)

  STATUS_USER=$(/opt/mssql-tools18/bin/sqlcmd -C -W -h -1 -U ${SQLSERVER_USER} -P "${SQLSERVER_PASSWORD}" -Q "SET NOCOUNT ON; SELECT SUM(state) FROM sys.databases" > /dev/null 2>&1 || echo 1)

  sleep 10
done

if [[ $STATUS_USER -ne 0 ]]; then
  if [[ $STATUS_SA -ne 0 ]]; then
    echo "Neither 'sa' nor '${SQLSERVER_USER}' can connect to SQL Server." >&2
    exit 1
  fi

  echo "Configuring SQL login ${SQLSERVER_USER}..."
  /opt/mssql-tools18/bin/sqlcmd -C -b -U sa -P "${SQLSERVER_PASSWORD}" -Q "
    IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE [name] = N'${SQLSERVER_USER}')
    BEGIN
        CREATE LOGIN [${SQLSERVER_USER}] WITH PASSWORD = N'${SQLSERVER_PASSWORD}';
    END;

    IF IS_SRVROLEMEMBER(N'sysadmin', N'${SQLSERVER_USER}') <> 1
    BEGIN
        ALTER SERVER ROLE [sysadmin] ADD MEMBER [${SQLSERVER_USER}];
    END;"

  if [[ "${SQLSERVER_USER,,}" != "sa" ]]; then
    /opt/mssql-tools18/bin/sqlcmd -C -b -U sa -P "${SQLSERVER_PASSWORD}" -Q "
      IF EXISTS (SELECT 1 FROM sys.sql_logins WHERE [name] = N'sa' AND is_disabled = 0)
      BEGIN
          ALTER LOGIN [sa] DISABLE;
      END;"
  fi
fi

echo "Verifying SQL login ${SQLSERVER_USER}..."
/opt/mssql-tools18/bin/sqlcmd -C -b -U "${SQLSERVER_USER}" -P "${SQLSERVER_PASSWORD}" -Q "SELECT 1" > /dev/null

# If the Admin database is restored, we skip restoring it again
if [[ ! -f "/var/opt/mssql/data/EdFi_Admin.mdf" ]]; then
  echo "Loading EdFi_Admin database from backup..."
  /opt/mssql-tools18/bin/sqlcmd -C -U "${SQLSERVER_USER}" -P "${SQLSERVER_PASSWORD}" -Q "
    RESTORE DATABASE [EdFi_Admin] FROM DISK = N'/app/backups/EdFi_Admin.bak'
    WITH MOVE 'EdFi_Admin' TO '/var/opt/mssql/data/EdFi_Admin.mdf',
         MOVE 'EdFi_Admin_Log' TO '/var/opt/mssql/log/EdFi_Admin_log.ldf';"
fi

# If the Security database is restored, we skip restoring it again
if [[ ! -f "/var/opt/mssql/data/EdFi_Security.mdf" ]]; then
  echo "Loading EdFi_Security Database from backup..."
  /opt/mssql-tools18/bin/sqlcmd -C -U "${SQLSERVER_USER}" -P "${SQLSERVER_PASSWORD}" -Q "
    RESTORE DATABASE [EdFi_Security] FROM DISK = N'/app/backups/EdFi_Security.bak'
    WITH MOVE 'EdFi_Security' TO '/var/opt/mssql/data/EdFi_Security.mdf',
         MOVE 'EdFi_Security_Log' TO '/var/opt/mssql/log/EdFi_Security_log.ldf';"
fi
