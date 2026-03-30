# Load-Env PowerShell Script

param (
    [string]$envFile = '.env.local'
)

# Check if the specified .env file exists, if not, fallback to .env.example
if (-Not (Test-Path $envFile)) {
    $envFile = '.env.example'
}

# Check if the envFile exists after fallback
if (-Not (Test-Path $envFile)) {
    Write-Error "The specified .env file '$envFile' does not exist."
    return
}

# Load environment variables from the .env file
Get-Content $envFile | ForEach-Object {
    if ($_.Contains('=') -and -not $_.StartsWith('#')) {
        $name, $value = $_ -split '=', 2;
        [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim());
    }
}

Write-Output "Environment variables loaded from $envFile successfully!"