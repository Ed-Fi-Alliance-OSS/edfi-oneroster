# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

function Wait-ForAdminContainerHealthy {
    param(
        [string]
        $ContainerId,

        [int]
        $TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = (& docker inspect --format '{{.State.Health.Status}}' $ContainerId 2>$null).Trim()

        if ($status -eq 'healthy') {
            return
        }

        if ([string]::IsNullOrWhiteSpace($status)) {
            Start-Sleep -Seconds 5
            continue
        }

        Write-Host "Waiting for $ContainerId health (current: $status)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }

    throw "$ContainerId did not enter a healthy state within $TimeoutSeconds seconds."
}

function Invoke-AdminBootstrapScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]
        $ScriptDir,

        [Parameter(Mandatory = $true)]
        [string]
        $ContainerId,

        [Parameter(Mandatory = $true)]
        [hashtable]
        $SeedValues,

        [int]
        $TimeoutSeconds = 180
    )

    Wait-ForAdminContainerHealthy -ContainerId $ContainerId -TimeoutSeconds $TimeoutSeconds

    $bootstrapScriptPath = Join-Path -Path $ScriptDir -ChildPath "settings/bootstrap.sh"
    if (-not (Test-Path -LiteralPath $bootstrapScriptPath -PathType Leaf)) {
        throw "Unable to locate bootstrap.sh at $bootstrapScriptPath"
    }

    $containerScriptPath = "/tmp/oneroster-bootstrap.sh"

    Write-Host "Copying bootstrap script into $ContainerId..." -ForegroundColor Cyan
    & docker @('cp', $bootstrapScriptPath, "${ContainerId}:${containerScriptPath}")

    Write-Host "Executing admin bootstrap script inside $ContainerId..." -ForegroundColor Cyan
    $execArgs = @('exec')
    foreach ($key in $SeedValues.Keys) {
        $execArgs += '-e'
        $execArgs += "$key=$($SeedValues[$key])"
    }

    $execArgs += $ContainerId
    $execArgs += '/bin/sh'
    $execArgs += $containerScriptPath

    & docker @execArgs
    Write-Host "Admin bootstrap completed." -ForegroundColor Green
}

Export-ModuleMember -Function Invoke-AdminBootstrapScript
