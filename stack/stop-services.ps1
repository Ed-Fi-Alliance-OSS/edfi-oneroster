<#
.SYNOPSIS
    Stops the Docker Compose services.

.EXAMPLE
    ./stop-services.ps1
    Stops the Docker Compose services and keeps existing volumes/images.

.EXAMPLE
    ./stop-services.ps1 -Purge -EnvFile ".env.5.2.0.example"
    Stops the services and removes all containers, named volumes, and images defined by the compose files while using the specified environment file.
#>

param(
    # Remove containers, volumes, and images that belong to the compose project
    [Switch]
    $Purge,

    # Path to the environment file passed to docker compose
    [string]
    $EnvFile = ".env"
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

$files = @(
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "edfi-services.yml"),
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "nginx-compose.yml"),
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "oneroster-service.yml")
)

Write-Host "Stopping Docker Compose services..." -ForegroundColor Yellow
Write-Host "Using environment file: $envFilePath" -ForegroundColor Cyan

$composeArgs = @("compose")
$composeArgs += $files
$composeArgs += @("--env-file", $envFilePath, "down", "--remove-orphans")

if ($Purge) {
    Write-Host "Purging containers, volumes, and images defined by the stack..." -ForegroundColor Red
    $composeArgs += @("--volumes", "--rmi", "all")
}

& docker @composeArgs

if ($Purge) {
    Write-Host "Services stopped and resources purged." -ForegroundColor Green
} else {
    Write-Host "Services stopped." -ForegroundColor Green
}
