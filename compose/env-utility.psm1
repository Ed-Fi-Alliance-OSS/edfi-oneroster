# SPDX-License-Identifier: Apache-2.0
# Licensed to EdTech Consortium, Inc. under one or more agreements.
# EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

function ReadValuesFromEnvFile {
    param (
        [string]$EnvironmentFile
    )

    if (-Not (Test-Path $EnvironmentFile)) {
        throw "Environment file not found: $EnvironmentFile"
    }
    $envFile = @{}

    try {
        Get-Content $EnvironmentFile | ForEach-Object {
            $line = $_
            if ([string]::IsNullOrWhiteSpace($line)) { return }

            $trimmed = $line.Trim()
            if ($trimmed.StartsWith('#')) { return }

            $delimiterIndex = $trimmed.IndexOf('=')
            if ($delimiterIndex -lt 1) { return }

            $key = $trimmed.Substring(0, $delimiterIndex).Trim()
            if ([string]::IsNullOrWhiteSpace($key)) { return }

            $value = $trimmed.Substring($delimiterIndex + 1).Trim()

            $commentIndex = $value.IndexOf(' #')
            if ($commentIndex -ge 0) {
                $value = $value.Substring(0, $commentIndex).TrimEnd()
            }

            $envFile[$key] = $value
        }
    }
    catch {
         Write-Error "Please provide valid .env file."
    }
    return $envFile
}
