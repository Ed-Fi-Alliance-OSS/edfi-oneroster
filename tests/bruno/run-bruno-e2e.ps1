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

    # 3. Wait for services to be healthy (simple sleep, adjust as needed)
    Write-Host "Waiting for services to initialize..."
    Start-Sleep -Seconds 60
}

# Only set up environment and containers if requested
if ($NeedEnvironmentSetup) {
    Setup-EnvironmentAndContainers -Version $Version
}

# Run Bruno tests with NODE_TLS_REJECT_UNAUTHORIZED=0 for local testing
Write-Host "Running Bruno E2E tests with NODE_TLS_REJECT_UNAUTHORIZED=0..."
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
npx bru run oauth --env-file "$PSScriptRoot/environments/local.bru"
npx bru run oneroster --env-file "$PSScriptRoot/environments/local.bru"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Bruno tests completed successfully."
} else {
    Write-Error "Bruno tests failed."
    exit 2
}
