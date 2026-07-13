# SPDX-License-Identifier: Apache-2.0
# Licensed to 1EdTech Consortium, Inc. under one or more agreements.
# 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
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

            # Match docker compose env-file behavior by unwrapping balanced quotes
            # when the full value is wrapped as a single quoted string.
            if ($value.Length -ge 2) {
                $firstChar = $value[0]
                $lastChar = $value[$value.Length - 1]
                if (($firstChar -eq '"' -and $lastChar -eq '"') -or ($firstChar -eq "'" -and $lastChar -eq "'")) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }

            $envFile[$key] = $value
        }
    }
    catch {
         Write-Error "Please provide valid .env file."
    }
    return $envFile
}
