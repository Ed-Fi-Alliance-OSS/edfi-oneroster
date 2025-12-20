param(
  [ValidateSet('ds4','ds5')]
  [string]$DataStandard = 'ds5'
)

# PowerShell OneRoster PostgreSQL Deployment Script
# Runs the materialized view SQL files using local psql from the sql folder

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Load-EnvFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Could not load environment file: $Path"
  }
  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^[\s]*#') { return }
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^(?<k>[^#=]+?)\s*=\s*(?<v>.*)$') {
      $k = $Matches.k.Trim()
      $v = $Matches.v.Trim()
      [Environment]::SetEnvironmentVariable($k, $v)
    }
  }
}

function Get-PsqlPath {
  # Try PATH first
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  # Common default install path (adjust version if needed)
  $candidates = @(
    'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    'C:\Program Files\PostgreSQL\15\bin\psql.exe',
    'C:\Program Files\PostgreSQL\14\bin\psql.exe'
  )
  foreach ($p in $candidates) { if (Test-Path -LiteralPath $p) { return $p } }
  throw "psql.exe not found. Ensure PostgreSQL client is installed and in PATH."
}

# Resolve paths (prefer $PSScriptRoot; fallback for older PowerShell)
if ($PSScriptRoot) {
  $scriptDir = $PSScriptRoot
} else {
  $scriptPath = $MyInvocation.MyCommand.Path
  $scriptDir = Split-Path -Path $scriptPath -Parent
}
$projectRoot = Split-Path -Path $scriptDir -Parent

# Load env based on data standard
if ($DataStandard -eq 'ds4') {
  Write-Host "🔧 Using Ed-Fi Data Standard 4 configuration"
  Load-EnvFile -Path (Join-Path $projectRoot '.env.postgres')
} else {
  Write-Host "🔧 Using Ed-Fi Data Standard 5 configuration (default)"
  Load-EnvFile -Path (Join-Path $projectRoot '.env.postgres')
}

$PGHOST = $env:DB_HOST
$PGPORT = $env:DB_PORT
$PGUSER = $env:DB_USER
$PGPASSWORD = $env:DB_PASS
$PGDATABASE = $env:DB_NAME

if (-not $PGHOST -or -not $PGPORT -or -not $PGUSER -or -not $PGPASSWORD -or -not $PGDATABASE) {
  throw "Database environment variables missing. Ensure .env.postgres/.env.ds4.postgres contains DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME."
}

[Environment]::SetEnvironmentVariable('PGPASSWORD', $PGPASSWORD)
$psql = Get-PsqlPath

Write-Host "========================================"
Write-Host "OneRoster 1.2 PostgreSQL Deployment"
Write-Host "========================================"
Write-Host "📊 Data Standard: $($DataStandard.ToUpper())"
Write-Host "Target Server: $PGHOST.$PGPORT"
Write-Host "Target Database: $PGDATABASE"
Write-Host "User: $PGUSER"
Write-Host "Deployment Time: $(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')"
Write-Host "========================================"
Write-Host ""

# Select user/enrollment files per DS
if ($DataStandard -eq 'ds4') {
  $usersSql = 'users_ds4.sql'
  $enrollSql = 'enrollments_ds4.sql'
} else {
  $usersSql = 'users.sql'
  $enrollSql = 'enrollments.sql'
}

$sqlFiles = @(
  '00_setup.sql',
  '01_descriptors.sql',
  '02_descriptorMappings.sql',
  'academic_sessions.sql',
  'orgs.sql',
  'courses.sql',
  'classes.sql',
  'demographics.sql',
  $usersSql,
  $enrollSql
)

# Test connectivity
Write-Host "🔌 Testing PostgreSQL connectivity..."
& $psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c 'SELECT 1;' | Out-Null
Write-Host "✅ Connected successfully"
Write-Host ""

$successful = 0
$failed = 0

Push-Location $scriptDir
try {
  foreach ($file in $sqlFiles) {
    if (Test-Path -LiteralPath $file) {
      Write-Host "⚡ Executing $file..."
      $execOutput = & $psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -f $file 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ $file executed successfully"
        $successful++
      } else {
        Write-Host "❌ Error executing $file"
        Write-Host "SQL Error Output:"
        ($execOutput -split "`n" | ForEach-Object { "  $_" }) | Write-Host
        $failed++
      }
    } else {
      Write-Host "⚠️  Skipping $file (file not found)"
      $failed++
    }
  }
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "========================================"
if ($failed -eq 0) {
  Write-Host "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
} else {
  Write-Host "❌ DEPLOYMENT COMPLETED WITH ERRORS!"
}
Write-Host "📊 SQL Files: $successful successful, $failed failed"
Write-Host "========================================"

exit $failed
