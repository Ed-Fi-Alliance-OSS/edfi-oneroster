# Runs Ed-Fi OneRoster stack and Bruno E2E tests
param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('4.0.0','5.2.0')]
    [string]$Version = '5.2.0',
    [switch]$NeedEnvironmentSetup,
    [string]$BrunoConfig = "ci.bru",
    # When omitted, the stack uses ONEROSTER_IMAGE (which defaults to edfialliance/one-roster-api:pre).
    [Switch]$BuildImage,
    [Parameter(Mandatory=$false)]
    [ValidateSet("SingleTenant", "MultiTenant")]
    [string]$InstallType = "SingleTenant",
    [Parameter(Mandatory=$false)]
    [ValidateSet("Postgres", "Mssql")]
    [string]$DbType = "Postgres"
)

function Get-EnvFileName {
    param(
        [string]$Version,
        [string]$InstallType,
        [string]$DbType
    )

    if ($DbType -eq "Mssql") {
        if ($InstallType -eq "MultiTenant") {
            return "$Version-mssql-multi-tenant.env"
        }

        return "$Version-mssql.env"
    }

    if ($InstallType -eq "MultiTenant") {
        return "$Version-multi-tenant.env"
    }

    return "$Version.env"
}

function New-AdminConnectionString {
    param(
        [string]$DbType,
        [string]$ServerHost,
        [string]$Port,
        [string]$User,
        [string]$Password,
        [string]$Database
    )

    if ($DbType -eq "Mssql") {
        return "Server=$ServerHost;Database=$Database;User Id=$User;Password=$Password;Application Name=EdFi.Ods.WebApi;Integrated Security=false;Encrypt=false;TrustServerCertificate=true;"
    }

    return "host=$ServerHost;port=$Port;user=$User;password=$Password;database=$Database"
}

# Helper function to set up environment and containers
function Setup-EnvironmentAndContainers {
    param(
        [string]$Version
    )
    # 1. Set up environment variables from .env file and generate keys if needed
    $envSuffix = Get-EnvFileName -Version $Version -InstallType $InstallType -DbType $DbType
    $envFile = Join-Path $PSScriptRoot "environments\$envSuffix"
    if (!(Test-Path $envFile)) {
        Write-Error "Could not find $envFile"
        exit 1
    }

    $envUtilPath = Join-Path $PSScriptRoot "..\..\stack\env-utility.psm1"
    Import-Module $envUtilPath -Force
    $envVars = ReadValuesFromEnvFile -EnvironmentFile $envFile
    foreach ($pair in $envVars.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'Process')
    }

    # Generate random values for keys/secrets if not set
    function New-RandomString($length) {
        -join ((65..90) + (97..122) + (48..57) | Get-Random -Count $length | % {[char]$_})
    }

    if (-not $env:LEA_KEY) {
        $leaKey = "lea-key-" + (New-RandomString 5)
        $env:LEA_KEY = $leaKey
    }
    if (-not $env:LEA_SECRET) {
        $leaSecret = "lea-secret-" + (New-RandomString 5)
        $env:LEA_SECRET = $leaSecret
    }
    if (-not $env:SCHOOL_KEY) {
        $schoolKey = "school-key-" + (New-RandomString 5)
        $env:SCHOOL_KEY = $schoolKey
    }
    if (-not $env:SCHOOL_SECRET) {
        $schoolSecret = "school-secret-" + (New-RandomString 5)
        $env:SCHOOL_SECRET = $schoolSecret
    }

    $dbPort = if ($DbType -eq "Mssql") { "1433" } else { "5432" }
    $dbUser = if ($DbType -eq "Mssql") {
        if ($env:SQLSERVER_USER) { $env:SQLSERVER_USER } else { "sa" }
    } else {
        if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
    }
    $dbPass = if ($DbType -eq "Mssql") {
         if ($env:SQLSERVER_PASSWORD) { $env:SQLSERVER_PASSWORD }
         else { throw "SQLSERVER_PASSWORD must be set for MSSQL" }
    } else {
        if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "postgres" }
    }
    $adminDb = "EdFi_Admin"

    if ($InstallType -eq "MultiTenant") {
        # Generate TENANTS_CONNECTION_CONFIG dynamically for multi-tenant setup
        if (-not $env:TENANTS_CONNECTION_CONFIG) {
            $conn1 = New-AdminConnectionString -DbType $DbType -ServerHost 'db-admin-tenant1' -Port $dbPort -User $dbUser -Password $dbPass -Database $adminDb
            $conn2 = New-AdminConnectionString -DbType $DbType -ServerHost 'db-admin-tenant2' -Port $dbPort -User $dbUser -Password $dbPass -Database $adminDb
            $tenantsConfig = "{`"Tenant1`":{`"adminConnection`":`"$conn1`"},`"Tenant2`":{`"adminConnection`":`"$conn2`"}}"
            $env:TENANTS_CONNECTION_CONFIG = $tenantsConfig
            $env:PG_BOSS_CONNECTION_CONFIG = "{`"adminConnection`":`"$conn1`"}"
            Write-Host "Generated TENANTS_CONNECTION_CONFIG from environment variables"
        }
    } else {
        # Generate CONNECTION_CONFIG dynamically for single-tenant setup
        if (-not $env:CONNECTION_CONFIG) {
            $adminConnection = New-AdminConnectionString -DbType $DbType -ServerHost 'db-admin' -Port $dbPort -User $dbUser -Password $dbPass -Database $adminDb
            $connectionConfig = "{`"adminConnection`":`"$adminConnection`"}"
            $env:CONNECTION_CONFIG = $connectionConfig
            $env:PG_BOSS_CONNECTION_CONFIG = $connectionConfig
            Write-Host "Generated CONNECTION_CONFIG from environment variables"
        }
    }

    # Export key variables for Bruno .bru environments
    $keys = @('LEA_KEY','LEA_SECRET','SCHOOL_KEY','SCHOOL_SECRET','BASE_URL','ODS_API_VIRTUAL_NAME','ONEROSTER_API_VIRTUAL_NAME')
    foreach ($key in $keys) {
        $val = [System.Environment]::GetEnvironmentVariable($key, 'Process')
        Write-Host "$key=$val"
    }

    # 2. Start Docker containers
    Write-Host "Starting Ed-Fi OneRoster containers..."
    $composeScript = Join-Path $PSScriptRoot '..\..\stack\start-services.ps1'
    if ($BuildImage) {
        Write-Host "Building OneRoster image from local Dockerfile..." -ForegroundColor Cyan
        & $composeScript -EnvFile $envFile -GenerateSigningKeys -InitializeAdminClients -InitializeOneRosterViews -Rebuild -InstallType $InstallType -DbType $DbType
    } else {
        Write-Host "Using prebuilt image: $env:ONEROSTER_IMAGE" -ForegroundColor Cyan
        & $composeScript -EnvFile $envFile -GenerateSigningKeys -InitializeAdminClients -InitializeOneRosterViews -InstallType $InstallType -DbType $DbType
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to start Docker containers."
        exit 1
    }

    # 3. Wait for API URLs to be healthy
    Write-Host "Waiting for https://localhost/api and https://localhost/oneroster-api to be healthy..."
    $urls = @('https://localhost/api', 'https://localhost/oneroster-api')
    $maxWaitSeconds = 250
    $waited = 0
    $allHealthy = $false
    while ($waited -lt $maxWaitSeconds) {
        $allHealthy = $true
        foreach ($url in $urls) {
            try {
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -SkipCertificateCheck -TimeoutSec 5
                if ($response.StatusCode -ne 200) {
                    Write-Host "$url returned status $($response.StatusCode). Waiting..."
                    $allHealthy = $false
                }
            } catch {
                Write-Host "$url not reachable yet. Waiting..."
                $allHealthy = $false
            }
        }
        if ($allHealthy) { break }
        Start-Sleep -Seconds 5
        $waited += 5
    }
    if (-not $allHealthy) {
        Write-Error "Timeout waiting for API URLs to become healthy."
        exit 1
    }
    Write-Host "All required API URLs are healthy."
  }

Write-Host "Running Bruno E2E tests for version $Version" -ForegroundColor Green

# Only copy SSL files if they do not already exist in the destination directory
$sslSourceDir = Join-Path $PSScriptRoot "test-certs\ssl"
$sslDestDir = Join-Path $PSScriptRoot '..\..\stack\ssl'
if (Test-Path $sslSourceDir) {
    $copied = $false
    Get-ChildItem -Path $sslSourceDir -File | ForEach-Object {
        $destFile = Join-Path $sslDestDir $_.Name
        if (-not (Test-Path $destFile)) {
            Copy-Item -Path $_.FullName -Destination $sslDestDir
            $copied = $true
        }
    }
    if ($copied) {
        Write-Host "Copied missing SSL files to $sslDestDir."
    } else {
        Write-Host "All SSL files already exist in $sslDestDir. No copy needed."
    }
} else {
    Write-Warning "SSL source directory '$sslSourceDir' not found. Ensure SSL certificates are in place for nginx."
}

# Only set up environment and containers if requested
if ($NeedEnvironmentSetup) {
    Setup-EnvironmentAndContainers -Version $Version
}

# Run Bruno tests with NODE_TLS_REJECT_UNAUTHORIZED=0 for local testing
Write-Host "Running Bruno E2E tests with NODE_TLS_REJECT_UNAUTHORIZED=0..."
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

Push-Location $PSScriptRoot

# Auto-select Bruno env config when not explicitly overridden
$effectiveBrunoConfig = if ($BrunoConfig -eq "ci.bru" -and $InstallType -eq "MultiTenant") {
    "ci-tenant1.bru"
} else {
    $BrunoConfig
}

try {
    if ($InstallType -eq "MultiTenant") {
        Write-Host "Running Bruno tests against Tenant1..." -ForegroundColor Cyan
        npx bru run tests --env-file environments/ci-tenant1.bru -r
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Bruno tests failed for Tenant1 with exit code $LASTEXITCODE."
            exit $LASTEXITCODE
        }

        Write-Host "Running Bruno tests against Tenant2..." -ForegroundColor Cyan
        npx bru run tests --env-file environments/ci-tenant2.bru -r
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Bruno tests failed for Tenant2 with exit code $LASTEXITCODE."
            exit $LASTEXITCODE
        }
    } else {
        npx bru run tests --env-file environments/$effectiveBrunoConfig -r
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Bruno tests failed with exit code $LASTEXITCODE."
            exit $LASTEXITCODE
        }
    }

    Write-Host "Bruno tests completed successfully."
}
finally {
    # Stop all services after tests
    $stopScript = Join-Path $PSScriptRoot '..\..\stack\stop-services.ps1'
    $stopEnvSuffix = Get-EnvFileName -Version $Version -InstallType $InstallType -DbType $DbType
    $envFilePath = Join-Path $PSScriptRoot "environments\$stopEnvSuffix"
    & $stopScript -Purge -EnvFile $envFilePath -InstallType $InstallType -DbType $DbType

    Pop-Location
}
