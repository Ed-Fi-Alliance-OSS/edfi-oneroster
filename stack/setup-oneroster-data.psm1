# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

function Wait-ForDbAdminContainerRunning {
    param(
        [string]
        $ContainerId,

        [int]
        $TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $state = ((& docker inspect --format '{{.State.Status}}' $ContainerId 2>$null) | Out-String).Trim()

        if ($state -eq 'running') {
            return
        }

        if ([string]::IsNullOrWhiteSpace($state)) {
            Write-Host "Container '$ContainerId' not found yet, retrying..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
            continue
        }

        Write-Host "Waiting for '$ContainerId' to be running (current: $state)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }

    throw "Container '$ContainerId' did not enter a running state within $TimeoutSeconds seconds."
}

function Wait-ForOdsDatabaseReady {
    param(
        [string]
        $ContainerId,

        [hashtable]
        $OdsConn,

        [string]
        [ValidateSet('postgres', 'mssql')]
        $DbType = 'postgres',

        [int]
        $TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $logged   = $false
    while ((Get-Date) -lt $deadline) {
        if ($DbType -eq 'mssql') {
            $checkArgs = @(
                'exec',
                $ContainerId,
                '/opt/mssql-tools18/bin/sqlcmd',
                '-C',
                '-S', "$($OdsConn['Host']),$($OdsConn['Port'])",
                '-U', "$($OdsConn['Username'])",
                '-P', "$($OdsConn['Password'])",
                '-d', "$($OdsConn['Database'])",
                '-Q', 'SELECT 1'
            )
            & docker @checkArgs 2>$null | Out-Null
        }
        else {
            $checkArgs = @(
                'exec',
                '-e', "PGPASSWORD=$($OdsConn['Password'])",
                $ContainerId,
                'psql',
                "--host=$($OdsConn['Host'])",
                "--port=$($OdsConn['Port'])",
                "--username=$($OdsConn['Username'])",
                "--dbname=$($OdsConn['Database'])",
                '--no-password',
                '--command=SELECT 1'
            )
            & docker @checkArgs 2>$null | Out-Null
        }

        if ($LASTEXITCODE -eq 0) {
            return
        }

        if (-not $logged) {
            Write-Host "Waiting for ODS database '$($OdsConn['Database'])' to be ready..." -ForegroundColor Yellow
            $logged = $true
        }
        Start-Sleep -Seconds 5
    }

    throw "ODS database '$($OdsConn['Database'])' was not reachable within $TimeoutSeconds seconds."
}

function ConvertFrom-DbConnectionString {
    param(
        [string]
        $ConnectionString,

        [string]
        [ValidateSet('postgres', 'mssql')]
        $DbType = 'postgres'
    )

    $result = @{}
    $parts = $ConnectionString -split ';'

    foreach ($part in $parts) {
        $part = $part.Trim()
        if ([string]::IsNullOrWhiteSpace($part)) { continue }

        $idx = $part.IndexOf('=')
        if ($idx -lt 1) { continue }

        $key   = $part.Substring(0, $idx).Trim().ToLower()
        $value = $part.Substring($idx + 1).Trim()

        switch ($key) {
            { $_ -in @('host', 'server', 'data source', 'datasource', 'addr', 'address', 'network address') } { $result['Host']     = $value }
            'port'                                                                   { $result['Port']     = $value }
            { $_ -in @('database', 'initial catalog', 'initialcatalog') }           { $result['Database'] = $value }
            { $_ -in @('username', 'user id', 'userid', 'user', 'uid') }            { $result['Username'] = $value }
            { $_ -in @('password', 'pwd') }                                         { $result['Password'] = $value }
        }
    }

    if ($DbType -eq 'mssql' -and -not [string]::IsNullOrWhiteSpace($result['Host'])) {
        if ($result['Host'] -like 'tcp:*') {
            $result['Host'] = $result['Host'].Substring(4)
        }

        if ([string]::IsNullOrWhiteSpace($result['Port']) -and $result['Host'] -match '^(?<host>[^,]+),(?<port>\d+)$') {
            $result['Host'] = $Matches['host']
            $result['Port'] = $Matches['port']
        }
    }

        if ([string]::IsNullOrWhiteSpace($result['Port'])) {
            if ($DbType -eq 'mssql') {
                $result['Port'] = '1433'
            }
            else {
                $result['Port'] = '5432'
            }
        }

    return $result
}

function Get-AdminConnectionDetails {
    param(
        [string]
        $ConnectionConfig,

        [string]
        [ValidateSet('postgres', 'mssql')]
        $DbType = 'postgres'
    )

    if ([string]::IsNullOrWhiteSpace($ConnectionConfig)) {
        throw "CONNECTION_CONFIG is empty."
    }

    $trimmed = $ConnectionConfig.Trim()

    # Support both JSON payloads ({"adminConnection":"..."}) and raw Npgsql strings (host=...;port=...)
    if ($trimmed.StartsWith('{') -or $trimmed.StartsWith('[')) {
        try {
            $config = $trimmed | ConvertFrom-Json -AsHashtable -ErrorAction Stop
        }
        catch {
            throw "Failed to parse CONNECTION_CONFIG as JSON: $_"
        }

        if ($config -isnot [System.Collections.IDictionary] -or -not $config.Contains('adminConnection')) {
            throw "CONNECTION_CONFIG JSON does not contain an 'adminConnection' property."
        }

        return ConvertFrom-DbConnectionString -ConnectionString $config['adminConnection'] -DbType $DbType
    }

    return ConvertFrom-DbConnectionString -ConnectionString $trimmed -DbType $DbType
}

function Invoke-OneRosterBootstrapScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]
        $ScriptDir,

        [Parameter(Mandatory = $true)]
        [string]
        $ContainerId,

        [Parameter(Mandatory = $true)]
        [string]
        $ConnectionConfig,

        [Parameter(Mandatory = $true)]
        [string]
        $ArtifactVersion,

        [string]
        [ValidateSet('postgres', 'mssql')]
        $DbType = 'postgres',

        [int]
        $TimeoutSeconds = 180
    )

    # Step 1: Verify the db-admin container is running
    Write-Host "Checking container '$ContainerId' is running..." -ForegroundColor Cyan
    Wait-ForDbAdminContainerRunning -ContainerId $ContainerId -TimeoutSeconds $TimeoutSeconds

    # Step 2: Parse admin connection string from CONNECTION_CONFIG
    Write-Host "Parsing CONNECTION_CONFIG..." -ForegroundColor Cyan
    $adminConn = Get-AdminConnectionDetails -ConnectionConfig $ConnectionConfig -DbType $DbType

    foreach ($field in @('Host', 'Port', 'Database', 'Username', 'Password')) {
        if ([string]::IsNullOrWhiteSpace($adminConn[$field])) {
            throw "Admin connection string is missing required field: $field"
        }
    }

    # Step 3: Verify the EdFi_Admin database is reachable
    Write-Host "Checking '$($adminConn['Database'])' database exists on $($adminConn['Host']):$($adminConn['Port'])..." -ForegroundColor Cyan
        if ($DbType -eq 'mssql') {
            $dbCheckArgs = @(
                'exec',
                $ContainerId,
                '/opt/mssql-tools18/bin/sqlcmd',
                '-C',
                '-W',
                '-h', '-1',
                '-S', "$($adminConn['Host']),$($adminConn['Port'])",
                '-U', "$($adminConn['Username'])",
                '-P', "$($adminConn['Password'])",
                '-d', 'master',
                '-Q', "SET NOCOUNT ON; SELECT DB_ID(N'$($adminConn['Database'])')"
            )
            $dbCheckOutput = ((& docker @dbCheckArgs 2>&1) | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or -not ($dbCheckOutput -match '^[0-9]+$')) {
                throw "Database '$($adminConn['Database'])' was not found or could not be reached. Output: $dbCheckOutput"
            }
        }
        else {
            $dbCheckArgs = @(
                'exec',
                '-e', "PGPASSWORD=$($adminConn['Password'])",
                $ContainerId,
                'psql',
                "--host=$($adminConn['Host'])",
                "--port=$($adminConn['Port'])",
                "--username=$($adminConn['Username'])",
                '--dbname=postgres',
                '--tuples-only', '--no-align',
                "--command=SELECT 1 FROM pg_database WHERE datname='$($adminConn['Database'])'"
            )
            $dbCheckOutput = ((& docker @dbCheckArgs 2>&1) | Out-String).Trim()

            if ($LASTEXITCODE -ne 0 -or $dbCheckOutput -notmatch '1') {
                throw "Database '$($adminConn['Database'])' was not found or could not be reached. Output: $dbCheckOutput"
            }
        }

    Write-Host "Database '$($adminConn['Database'])' confirmed." -ForegroundColor Green

    # Step 4: Read first OdsInstances record to obtain the ODS connection string
    Write-Host "Querying first record from dbo.OdsInstances..." -ForegroundColor Cyan
        if ($DbType -eq 'mssql') {
            $odsQueryArgs = @(
                'exec',
                $ContainerId,
                '/opt/mssql-tools18/bin/sqlcmd',
                '-C',
                '-W',
                '-h', '-1',
                '-S', "$($adminConn['Host']),$($adminConn['Port'])",
                '-U', "$($adminConn['Username'])",
                '-P', "$($adminConn['Password'])",
                '-d', "$($adminConn['Database'])",
                '-Q', "SET NOCOUNT ON; SELECT TOP 1 ConnectionString FROM dbo.OdsInstances WHERE [Name] = 'Ods Instance' AND [InstanceType] = 'ODS'"
            )
            $odsConnString = ((& docker @odsQueryArgs 2>&1) | Out-String).Trim()
        }
        else {
            $odsQueryArgs = @(
                'exec',
                '-e', "PGPASSWORD=$($adminConn['Password'])",
                $ContainerId,
                'psql',
                "--host=$($adminConn['Host'])",
                "--port=$($adminConn['Port'])",
                "--username=$($adminConn['Username'])",
                "--dbname=$($adminConn['Database'])",
                '--tuples-only', '--no-align',
                "--command=SELECT connectionstring FROM dbo.odsinstances WHERE Name = 'Ods Instance' AND InstanceType = 'ODS' LIMIT 1"
            )
            $odsConnString = ((& docker @odsQueryArgs 2>&1) | Out-String).Trim()
        }

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query dbo.OdsInstances. output: $odsConnString"
    }

    if ([string]::IsNullOrWhiteSpace($odsConnString)) {
        throw "No records found in dbo.OdsInstances."
    }

    Write-Host "ODS connection string retrieved." -ForegroundColor Green

    # Step 5: Parse ODS connection string for host, database, username, password
    $odsConn = ConvertFrom-DbConnectionString -ConnectionString $odsConnString -DbType $DbType

    foreach ($field in @('Host', 'Port', 'Database', 'Username', 'Password')) {
        if ([string]::IsNullOrWhiteSpace($odsConn[$field])) {
            throw "ODS connection string is missing required field: $field"
        }
    }

    Write-Host "ODS target: $($odsConn['Database']) on $($odsConn['Host']):$($odsConn['Port'])" -ForegroundColor Cyan

    # Step 6: Wait until the ODS database is reachable
    Write-Host "Waiting for ODS database '$($odsConn['Database'])' to be reachable..." -ForegroundColor Cyan
    Wait-ForOdsDatabaseReady -ContainerId $ContainerId -OdsConn $odsConn -DbType $DbType -TimeoutSeconds $TimeoutSeconds
    Write-Host "ODS database '$($odsConn['Database'])' is reachable." -ForegroundColor Green

    # Step 7: Run SQL scripts from standard/${ArtifactVersion}/artifacts/<dbType>/core
    $artifactDbFolder = if ($DbType -eq 'mssql') { 'mssql' } else { 'pgsql' }
    $artifactDir = [System.IO.Path]::GetFullPath(
        (Join-Path -Path $ScriptDir -ChildPath "..\standard\$ArtifactVersion\artifacts\$artifactDbFolder\core")
    )

    if (-not (Test-Path -LiteralPath $artifactDir -PathType Container)) {
        throw "Artifact directory not found: $artifactDir"
    }

    $sqlFiles = Get-ChildItem -Path $artifactDir -Filter '*.sql' | Sort-Object Name

    if ($sqlFiles.Count -eq 0) {
        throw "No SQL files found in $artifactDir"
    }

    Write-Host "Running $($sqlFiles.Count) SQL file(s) from $artifactDir..." -ForegroundColor Cyan

    foreach ($sqlFile in $sqlFiles) {
        $containerPath = "/tmp/oneroster-$($sqlFile.Name)"
        $copiedToContainer = $false

        try{
        Write-Host "Copying $($sqlFile.Name) into '$ContainerId'..." -ForegroundColor Yellow
        & docker cp $sqlFile.FullName "${ContainerId}:${containerPath}"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to copy '$($sqlFile.Name)' into container '$ContainerId'."
        }
        $copiedToContainer = $true

                Write-Host "Executing $($sqlFile.Name)..." -ForegroundColor Yellow
                if ($DbType -eq 'mssql') {
                    $runArgs = @(
                        'exec',
                        $ContainerId,
                        '/opt/mssql-tools18/bin/sqlcmd',
                        '-C',
                        '-b',
                        '-S', "$($odsConn['Host']),$($odsConn['Port'])",
                        '-U', "$($odsConn['Username'])",
                        '-P', "$($odsConn['Password'])",
                        '-d', "$($odsConn['Database'])",
                        '-i', $containerPath
                    )
                }
                else {
                    $runArgs = @(
                        'exec',
                        '-e', "PGPASSWORD=$($odsConn['Password'])",
                        $ContainerId,
                        'psql',
                        "--host=$($odsConn['Host'])",
                        "--port=$($odsConn['Port'])",
                        "--username=$($odsConn['Username'])",
                        "--dbname=$($odsConn['Database'])",
                        '--set=ON_ERROR_STOP=on',
                        "--file=$containerPath"
                    )
                }

                $runOutput = (& docker @runArgs 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "SQL script '$($sqlFile.Name)' failed. Output: $runOutput"
        }

        Write-Host "Finished $($sqlFile.Name)." -ForegroundColor Green
    }
     finally {
             if ($copiedToContainer) {
                 $cleanupArgs = @(
                     'exec',
                     '--user', 'root',
                     $ContainerId,
                     'rm',
                     '-f',
                     $containerPath
                 )
                 & docker @cleanupArgs | Out-Null
                 if ($LASTEXITCODE -ne 0) {
                     Write-Host "Warning: Failed to remove temporary file '$containerPath' from container '$ContainerId'." -ForegroundColor Yellow
                 }
             }
         }
  }

    if ($DbType -eq 'mssql') {
        # Deploy orchestration proc that creates oneroster12.sp_refresh_all.
        $orchestrationDir = [System.IO.Path]::GetFullPath(
            (Join-Path -Path $ScriptDir -ChildPath "..\standard\$ArtifactVersion\artifacts\mssql\orchestration")
        )
        $masterRefreshPath = Join-Path -Path $orchestrationDir -ChildPath 'master_refresh.sql'

        if (Test-Path -LiteralPath $masterRefreshPath -PathType Leaf) {
            $containerPath = '/tmp/oneroster-master_refresh.sql'
            $copiedToContainer = $false

            try {
                Write-Host 'Deploying orchestration script master_refresh.sql...' -ForegroundColor Cyan
                & docker cp $masterRefreshPath "${ContainerId}:${containerPath}"
                if ($LASTEXITCODE -ne 0) {
                    throw "Failed to copy 'master_refresh.sql' into container '$ContainerId'."
                }
                $copiedToContainer = $true

                $runArgs = @(
                    'exec',
                    $ContainerId,
                    '/opt/mssql-tools18/bin/sqlcmd',
                    '-C',
                    '-b',
                    '-S', "$($odsConn['Host']),$($odsConn['Port'])",
                    '-U', "$($odsConn['Username'])",
                    '-P', "$($odsConn['Password'])",
                    '-d', "$($odsConn['Database'])",
                    '-i', $containerPath
                )

                $runOutput = (& docker @runArgs 2>&1)
                if ($LASTEXITCODE -ne 0) {
                    throw "SQL script 'master_refresh.sql' failed. Output: $runOutput"
                }

                Write-Host 'master_refresh.sql deployed successfully.' -ForegroundColor Green
            }
            finally {
                if ($copiedToContainer) {
                    $cleanupArgs = @(
                        'exec',
                        '--user', 'root',
                        $ContainerId,
                        'rm',
                        '-f',
                        $containerPath
                    )
                    & docker @cleanupArgs | Out-Null
                }
            }

            # Prime OneRoster tables so APIs have data immediately after bootstrap.
            Write-Host 'Running initial OneRoster refresh via oneroster12.sp_refresh_all...' -ForegroundColor Cyan
            $refreshArgs = @(
                'exec',
                $ContainerId,
                '/opt/mssql-tools18/bin/sqlcmd',
                '-C',
                '-b',
                '-S', "$($odsConn['Host']),$($odsConn['Port'])",
                '-U', "$($odsConn['Username'])",
                '-P', "$($odsConn['Password'])",
                '-d', "$($odsConn['Database'])",
                '-Q', 'SET NOCOUNT ON; EXEC oneroster12.sp_refresh_all;'
            )

            $refreshOutput = (& docker @refreshArgs 2>&1)
            if ($LASTEXITCODE -ne 0) {
                throw "Initial OneRoster refresh failed. Output: $refreshOutput"
            }

            Write-Host 'Initial OneRoster refresh completed.' -ForegroundColor Green
        }
        else {
            Write-Host "Warning: Orchestration script not found at '$masterRefreshPath'. Skipping sp_refresh_all deployment." -ForegroundColor Yellow
        }
    }

    Write-Host "OneRoster views bootstrap completed." -ForegroundColor Green
}

Export-ModuleMember -Function Invoke-OneRosterBootstrapScript
