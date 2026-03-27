# Runs Ed-Fi OneRoster stack and Bruno E2E tests
param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('4.0.0','5.2.0')]
    [string]$Version = '5.2.0',
    [switch]$NeedEnvironmentSetup
)

# Helper function to set up environment and containers
function Setup-EnvironmentAndContainers {
    param(
        [string]$Version
    )
    # 1. Set up environment variables from .env file and generate keys if needed
    $envFile = Join-Path $PSScriptRoot "environments\$Version.env"
    if (!(Test-Path $envFile)) {
        Write-Error "Could not find $envFile"
        exit 1
    }

    $envUtilPath = Join-Path $PSScriptRoot "..\..\compose\env-utility.psm1"
    Import-Module $envUtilPath -Force
    $envVars = ReadValuesFromEnvFile -EnvironmentFile $envFile
    foreach ($pair in $envVars.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'Process')
    }

    # Generate random values for keys/secrets if not set
    function New-RandomString($length) {
        -join ((65..90) + (97..122) + (48..57) | Get-Random -Count $length | % {[char]$_})
    }

    if (-not $leaKey) {
        $leaKey = "lea-key-" + (New-RandomString 5)
        $env:LEA_KEY = $leaKey
    }
    if (-not $leaSecret) {
        $leaSecret = "lea-secret-" + (New-RandomString 5)
        $env:LEA_SECRET = $leaSecret
    }
    if (-not $schoolKey) {
        $schoolKey = "school-key-" + (New-RandomString 5)
        $env:SCHOOL_KEY = $schoolKey
    }
    if (-not $schoolSecret) {
        $schoolSecret = "school-secret-" + (New-RandomString 5)
        $env:SCHOOL_SECRET = $schoolSecret
    }

    # Export key variables for Bruno .bru environments
    $keys = @('LEA_KEY','LEA_SECRET','SCHOOL_KEY','SCHOOL_SECRET','BASE_URL','ODS_API_VIRTUAL_NAME','ONEROSTER_API_VIRTUAL_NAME')
    foreach ($key in $keys) {
        $val = [System.Environment]::GetEnvironmentVariable($key, 'Process')
        Write-Host "$key=$val"
    }

    # 2. Start Docker containers
    Write-Host "Starting Ed-Fi OneRoster containers..."
    $composeScript = Join-Path $PSScriptRoot '..\..\compose\start-services.ps1'
    & $composeScript -EnvFile $envFile -GenerateSigningKeys -InitializeAdminClients
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
$sslDestDir = Join-Path $PSScriptRoot '..\..\compose\ssl'
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

try {
    npx bru run tests --env-file environments/local.bru -r

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Bruno tests failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }

    Write-Host "Bruno tests completed successfully."
}
finally {
    # Stop all services after tests
    $stopScript = Join-Path $PSScriptRoot '..\..\compose\stop-services.ps1'
    $envFilePath = Join-Path $PSScriptRoot "environments\$Version.env"
    & $stopScript -Purge -EnvFile $envFilePath

    Pop-Location
}
