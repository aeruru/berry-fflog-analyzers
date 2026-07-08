param(
    [string]$EnvFile = ".env.local"
)

if (!(Test-Path $EnvFile)) {
    Write-Error "Missing env file: $EnvFile"
    exit 1
}

Get-Content $EnvFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -match "^\s*$") {
        return
    }

    $parts = $_ -split "=", 2
    if ($parts.Length -eq 2) {
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

if (!$env:FFLOGS_CLIENT_ID -or !$env:FFLOGS_CLIENT_SECRET) {
    Write-Error "Missing FFLOGS_CLIENT_ID or FFLOGS_CLIENT_SECRET in $EnvFile"
    exit 1
}

$response = & curl.exe `
    --silent `
    --show-error `
    --fail `
    --user "$($env:FFLOGS_CLIENT_ID):$($env:FFLOGS_CLIENT_SECRET)" `
    --data "grant_type=client_credentials" `
    "https://www.fflogs.com/oauth/token"

if ($LASTEXITCODE -ne 0) {
    Write-Error "curl.exe failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

try {
    $json = $response | ConvertFrom-Json
}
catch {
    Write-Error "Failed to parse FFLogs token response as JSON."
    Write-Host $response
    exit 1
}

if (!$json.access_token) {
    Write-Error "FFLogs response did not include access_token."
    $json | ConvertTo-Json -Depth 10
    exit 1
}

Write-Host ""
Write-Host "Paste this into Altair's Authorization header:"
Write-Host ""
Write-Host "Bearer $($json.access_token)"
Write-Host "Access token expires in: $($json.expires_in) seconds"
Write-Host "Approx minutes: $([math]::Round($json.expires_in / 60, 1))"
Write-Host ""