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
    $EnvFile = ".env",

    # Whether to stop a single-tenant or multi-tenant stack
    [string]
    [ValidateSet("SingleTenant", "MultiTenant")]
    $InstallType = "SingleTenant",

    # Database engine selection.
    [string]
    [ValidateSet("Postgres", "Mssql")]
    $DbType = "Postgres"
)

function Resolve-DbType {
    $explicit = $DbType.Trim().ToLowerInvariant()
    if ($explicit -eq 'postgres') { return 'postgres' }
    if ($explicit -eq 'mssql') { return 'mssql' }

    return 'postgres'
}

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

$resolvedDbType = Resolve-DbType

if ($InstallType -eq "MultiTenant") {
    if ($resolvedDbType -eq 'mssql') {
        $files = @(
            "-f",
            (Join-Path -Path $scriptDir -ChildPath "mssql/multi-tenant/docker-compose-multi-tenant-mssql.yml")
        )
    } else {
        $files = @(
            "-f",
            (Join-Path -Path $scriptDir -ChildPath "pgsql/multi-tenant/compose-multi-tenant-env.yml")
        )
    }
} else {
    if ($resolvedDbType -eq 'mssql') {
        $files = @(
            "-f",
            (Join-Path -Path $scriptDir -ChildPath "mssql/single-tenant/docker-compose-mssql.yml")
        )
    } else {
        $files = @(
            "-f",
            (Join-Path -Path $scriptDir -ChildPath "pgsql/single-tenant/edfi-services.yml"),
            "-f",
            (Join-Path -Path $scriptDir -ChildPath "pgsql/single-tenant/nginx-compose.yml"),
            "-f",
            (Join-Path -Path $scriptDir -ChildPath "pgsql/single-tenant/oneroster-service.yml")
        )
    }
}

Write-Host "Stopping Docker Compose services ($InstallType, $resolvedDbType)..." -ForegroundColor Yellow
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
