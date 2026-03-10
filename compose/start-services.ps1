<#
.SYNOPSIS
    Starts the Docker Compose services.

.EXAMPLE
    ./start-services.ps1
    Starts the Docker Compose services

.EXAMPLE
    ./start-services.ps1 -Rebuild
    Starts the Docker Compose services, rebuilding the OneRoster images before starting them.

.NOTES
    If the edfioneroster-network does not exist, it will be created.
#>

param(
    # Rebuild the images before starting
    [Switch]
    $Rebuild
)

$networkExists = docker network ls --filter name=edfioneroster-network --format '{{.Name}}' | Select-String -Pattern 'edfioneroster-network'
if (-not $networkExists) {
    Write-Host "Creating edfioneroster-network..." -ForegroundColor Yellow
    docker network create edfioneroster-network --driver bridge
}
$files = @(
    "-f",
    "edfi-services.yml",
    "-f",
    "nginx-compose.yml",
    "-f",
    "oneroster-service.yml"
)

Write-Host "Starting Docker Compose services..." -ForegroundColor Green
docker compose $files --env-file ".env" up -d $(if ($Rebuild) { "--build" })
Write-Host "Services started successfully!" -ForegroundColor Green
