<#
.SYNOPSIS
    Starts the Docker Compose services.

.EXAMPLE
    ./start-services.ps1
    Starts the Docker Compose services

.EXAMPLE
    ./start-services.ps1 -Rebuild
    Starts the Docker Compose services, rebuilding the OneRoster images before starting them.

.EXAMPLE
    ./start-services.ps1 -EnvFile ".env.5.2.0.example"
    Starts the Docker Compose services using the specified environment file.

.NOTES
    If the edfioneroster-network does not exist, it will be created.
#>

param(
    # Rebuild the images before starting
    [Switch]
    $Rebuild,

    # Path to the environment file passed to docker compose
    [string]
    $EnvFile = ".env",

    # Directory that contains jwt-private.pem and jwt-public.pem
    [string]
    $SecurityKeysPath = "keys"
)

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $envFilePath = $EnvFile
} else {
    $envFilePath = Join-Path -Path $scriptDir -ChildPath $EnvFile
}

if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) {
    throw "Environment file '$EnvFile' was not found."
}

function Set-JwtSigningEnvVars {
    param([string]$KeyDirectory)

    if (-not $KeyDirectory) {
        return
    }

    if (-not [System.IO.Path]::IsPathRooted($KeyDirectory)) {
        $KeyDirectory = Join-Path -Path $scriptDir -ChildPath $KeyDirectory
    }

    if (-not (Test-Path -LiteralPath $KeyDirectory -PathType Container)) {
        throw "Security keys directory '$KeyDirectory' was not found."
    }

    $privateKeyPath = Join-Path -Path $KeyDirectory -ChildPath "jwt-private.pem"
    $publicKeyPath = Join-Path -Path $KeyDirectory -ChildPath "jwt-public.pem"

    foreach ($keyPath in @($privateKeyPath, $publicKeyPath)) {
        if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
            throw "Required key file '$keyPath' was not found."
        }
    }

    $env:SECURITY__JWT__PRIVATEKEY = (Get-Content -Path $privateKeyPath -Raw) -replace "`r`n", "`n"
    $env:SECURITY__JWT__PUBLICKEY = (Get-Content -Path $publicKeyPath -Raw) -replace "`r`n", "`n"

    Write-Host "Loaded JWT signing keys from $KeyDirectory" -ForegroundColor Cyan
}

Set-JwtSigningEnvVars -KeyDirectory $SecurityKeysPath

$networkExists = docker network ls --filter name=edfioneroster-network --format '{{.Name}}' | Select-String -Pattern 'edfioneroster-network'
if (-not $networkExists) {
    Write-Host "Creating edfioneroster-network..." -ForegroundColor Yellow
    docker network create edfioneroster-network --driver bridge
}
$files = @(
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "edfi-services.yml"),
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "nginx-compose.yml"),
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "oneroster-service.yml")
)

Write-Host "Starting Docker Compose services..." -ForegroundColor Green
Write-Host "Using environment file: $envFilePath" -ForegroundColor Cyan
$composeArgs = @("compose")
$composeArgs += $files
$composeArgs += @("--env-file", $envFilePath, "up", "-d")
if ($Rebuild) {
    $composeArgs += "--build"
}
& docker @composeArgs
Write-Host "Services started successfully!" -ForegroundColor Green
