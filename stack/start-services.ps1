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

  # Generate a temporary RSA key pair for this run instead of relying on env-provided values
  [Switch]
  $GenerateSigningKeys,

  # Execute the Ed-Fi Admin bootstrap script with LEA/SCHOOL credentials
  [Switch]
  $InitializeAdminClients,

  # Run OneRoster SQL artifacts against the ODS database
  [Switch]
  $InitializeOneRosterViews,

  [string]
  [ValidateSet("SingleTenant", "MultiTenant")]
  $InstallType = "SingleTenant"
)

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ([System.IO.Path]::IsPathRooted($EnvFile)) {
  $envFilePath = $EnvFile
}
else {
  $envFilePath = Join-Path -Path $scriptDir -ChildPath $EnvFile
}

if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) {
  throw "Environment file '$EnvFile' was not found."
}

Import-Module (Join-Path -Path $scriptDir -ChildPath "setup-admin-data.psm1") -Force
Import-Module (Join-Path -Path $scriptDir -ChildPath "setup-oneroster-data.psm1") -Force
Import-Module (Join-Path -Path $scriptDir -ChildPath "env-utility.psm1") -Force
$script:envFileValues = ReadValuesFromEnvFile -EnvironmentFile $envFilePath

function Get-ConfigValue {
  param(
    [string]$Name
  )

  if ($script:envFileValues -and $script:envFileValues.ContainsKey($Name)) {
    return $script:envFileValues[$Name]
  }

  return $null
}

function Initialize-TenantOneRosterViews {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.IDictionary]
    $Tenants,

    [Parameter(Mandatory = $true)]
    [string]
    $TenantName,

    [Parameter(Mandatory = $true)]
    [string]
    $ContainerId,

    [Parameter(Mandatory = $true)]
    [string]
    $ArtifactVersion,

    [Parameter(Mandatory = $true)]
    [string]
    $ScriptDir
  )

  $tenant = if ($Tenants.Contains($TenantName)) { $Tenants[$TenantName] } else { $null }
  $tenantAdminConnection = if ($tenant -is [System.Collections.IDictionary] -and $tenant.Contains('adminConnection')) { $tenant['adminConnection'] } else { $null }

  if (-not [string]::IsNullOrWhiteSpace($tenantAdminConnection)) {
    Invoke-OneRosterBootstrapScript `
      -ScriptDir $ScriptDir `
      -ContainerId $ContainerId `
      -ConnectionConfig $tenantAdminConnection `
      -ArtifactVersion $ArtifactVersion
  }
  else {
    Write-Host "$TenantName not found in TENANTS_CONNECTION_CONFIG. Skipping OneRoster views initialization for $TenantName." -ForegroundColor Yellow
  }
}

function Generate-JwtSigningKeys {
  $modulePath = Join-Path -Path $scriptDir -ChildPath "public-private-key-pair.psm1"
  if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    throw "Unable to locate public-private-key-pair.psm1 at $modulePath"
  }

  Import-Module $modulePath -Force
  $pair = New-PublicPrivateKeyPair

  if ([string]::IsNullOrWhiteSpace($pair.PrivateKey) -or [string]::IsNullOrWhiteSpace($pair.PublicKey)) {
    throw "Failed to generate signing keys. Ensure PowerShell 7+ is installed to support PEM export."
  }

  $env:SECURITY__JWT__PRIVATEKEY = $pair.PrivateKey -replace "`r`n", "`n"
  $env:SECURITY__JWT__PUBLICKEY = $pair.PublicKey -replace "`r`n", "`n"

  Write-Host "Generated ephemeral JWT signing keys for this session." -ForegroundColor Cyan
}

function Ensure-SigningKeysProvided {
  $envPrivate = $env:SECURITY__JWT__PRIVATEKEY
  $envPublic = $env:SECURITY__JWT__PUBLICKEY

  $hasEnvKeys = -not [string]::IsNullOrWhiteSpace($envPrivate) -and -not [string]::IsNullOrWhiteSpace($envPublic)
  if ($hasEnvKeys) {
    Write-Host "Using JWT signing keys from environment variables."
    return
  }

  $dotenvPrivate = Get-ConfigValue -Name 'SECURITY__JWT__PRIVATEKEY'
  $dotenvPublic = Get-ConfigValue -Name 'SECURITY__JWT__PUBLICKEY'
  $hasDotenvKeys = -not [string]::IsNullOrWhiteSpace($dotenvPrivate) -and -not [string]::IsNullOrWhiteSpace($dotenvPublic)
  if ($hasDotenvKeys) {
    Write-Host "Using JWT signing keys defined in $EnvFile." -ForegroundColor Cyan
    return
  }

  throw "JWT signing keys were not provided. Set SECURITY__JWT__PRIVATEKEY and SECURITY__JWT__PUBLICKEY in the environment or $EnvFile, or rerun with -GenerateSigningKeys."
}

function Get-AdminSeedValues {
  $requiredKeys = 'LEA_KEY', 'LEA_SECRET', 'SCHOOL_KEY', 'SCHOOL_SECRET'
  $seedValues = [ordered]@{}

  foreach ($key in $requiredKeys) {
    # Check environment variable first
    $envValue = [System.Environment]::GetEnvironmentVariable($key)
    Write-Host "Checking for $key - $envValue in environment variables..."
    if (-not [string]::IsNullOrWhiteSpace($envValue)) {
      $value = $envValue
    }
    else {
      $value = Get-ConfigValue -Name $key
      if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Admin client initialization requires $key to be set."
      }
    }
    $seedValues[$key] = $value
  }

  return $seedValues
}


if ($GenerateSigningKeys) {
  Generate-JwtSigningKeys
}

# Ensure the signing keys are present
Ensure-SigningKeysProvided

$networkExists = docker network ls --filter name=edfioneroster-network --format '{{.Name}}' | Select-String -Pattern 'edfioneroster-network'
if (-not $networkExists) {
  Write-Host "Creating edfioneroster-network..." -ForegroundColor Yellow
  docker network create edfioneroster-network --driver bridge
}

if ($InstallType -eq "SingleTenant") {
  Write-Host "Starting in Single-Tenant mode..." -ForegroundColor Green

  $files = @(
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "pgsql/single-tenant/edfi-services.yml"),
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "pgsql/single-tenant/nginx-compose.yml"),
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "pgsql/single-tenant/oneroster-service.yml")
  )

  if ($Rebuild) {
    $files += "-f"
    $files += (Join-Path -Path $scriptDir -ChildPath "pgsql/oneroster-service-build.yml")
  }

  Write-Host "Starting Docker Compose services..." -ForegroundColor Green
  Write-Host "Using environment file: $envFilePath" -ForegroundColor Green
  $composeArgs = @("compose")
  $composeArgs += $files
  $composeArgs += @("--env-file", $envFilePath, "up", "-d")
  if ($Rebuild) {
    $composeArgs += "--build"
  }
  & docker @composeArgs
  Write-Host "Services started successfully!"

  if ($InitializeAdminClients) {
    $adminSeedValues = Get-AdminSeedValues
    Invoke-AdminBootstrapScript -ScriptDir $scriptDir -ContainerId 'db-admin' -SeedValues $adminSeedValues
  }

  if ($InitializeOneRosterViews) {
    $connectionConfig = Get-ConfigValue -Name 'CONNECTION_CONFIG'
    if ([string]::IsNullOrWhiteSpace($connectionConfig)) {
      $connectionConfig = $env:CONNECTION_CONFIG
    }
    if ([string]::IsNullOrWhiteSpace($connectionConfig)) {
      throw "OneRoster views initialization requires CONNECTION_CONFIG to be set."
    }

    $artifactVersion = Get-ConfigValue -Name 'ONEROSTER_ARTIFACT_VERSION'
    if ([string]::IsNullOrWhiteSpace($artifactVersion)) {
      throw "OneRoster views initialization requires ONEROSTER_ARTIFACT_VERSION to be set."
    }

    Invoke-OneRosterBootstrapScript `
      -ScriptDir $scriptDir `
      -ContainerId 'db-admin' `
      -ConnectionConfig $connectionConfig `
      -ArtifactVersion $artifactVersion
  }
}
else {
  Write-Host "Starting in Multi-Tenant mode..." -ForegroundColor Green
  $files = @(
    "-f",
    (Join-Path -Path $scriptDir -ChildPath "pgsql/multi-tenant/compose-multi-tenant-env.yml")
  )

  $composeArgs = @("compose")
  $composeArgs += $files
  $composeArgs += @("--env-file", $envFilePath, "up", "-d")
  if ($Rebuild) {
    $composeArgs += "--build"
  }
  & docker @composeArgs
  Write-Host "Services started successfully!"

  if ($InitializeAdminClients) {
    $adminSeedValues = Get-AdminSeedValues
    Invoke-AdminBootstrapScript -ScriptDir $scriptDir -ContainerId 'db-admin-tenant1' -SeedValues $adminSeedValues
    Invoke-AdminBootstrapScript -ScriptDir $scriptDir -ContainerId 'db-admin-tenant2' -SeedValues $adminSeedValues
  }

  if ($InitializeOneRosterViews) {

    # Read connection strings from TENANTS_CONNECTION_CONFIG for both tenants
    $tenantsConfig = Get-ConfigValue -Name 'TENANTS_CONNECTION_CONFIG'
    if ([string]::IsNullOrWhiteSpace($tenantsConfig)) {
      $tenantsConfig = $env:TENANTS_CONNECTION_CONFIG
    }
    if ([string]::IsNullOrWhiteSpace($tenantsConfig)) {
      throw "OneRoster views initialization requires TENANTS_CONNECTION_CONFIG to be set for multi-tenant setup."
    }
    try {
      $tenants = ConvertFrom-Json $tenantsConfig -AsHashtable -ErrorAction Stop
    }
    catch {
      throw "TENANTS_CONNECTION_CONFIG is not valid JSON. $_"
    }

    if ($tenants -isnot [System.Collections.IDictionary]) {
      throw "TENANTS_CONNECTION_CONFIG must be a JSON object keyed by tenant name (for example: Tenant1, Tenant2)."
    }

    $artifactVersion = Get-ConfigValue -Name 'ONEROSTER_ARTIFACT_VERSION'
    if ([string]::IsNullOrWhiteSpace($artifactVersion)) {
      throw "OneRoster views initialization requires ONEROSTER_ARTIFACT_VERSION to be set."
    }

    Initialize-TenantOneRosterViews `
      -Tenants $tenants `
      -TenantName 'Tenant1' `
      -ContainerId 'db-admin-tenant1' `
      -ArtifactVersion $artifactVersion `
      -ScriptDir $scriptDir

    Initialize-TenantOneRosterViews `
      -Tenants $tenants `
      -TenantName 'Tenant2' `
      -ContainerId 'db-admin-tenant2' `
      -ArtifactVersion $artifactVersion `
      -ScriptDir $scriptDir
  }
}
