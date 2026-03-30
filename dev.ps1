# PowerShell script to start Netlify dev server

$ErrorActionPreference = 'Stop'

# Load environment variables from .env file if it exists
$envFile = '.\.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_.Contains('=') -and -not $_.StartsWith('#')) {
            $parts = $_ -split '=', 2
            [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
        }
    }
} else {
    Write-Host "Warning: .env file not found, continuing without it."
}

# Set default port and check for command line argument for port
$defaultPort = 8888
$port = if ($args.Count -gt 0) { $args[0] } else { $defaultPort }

# Verify netlify CLI is available
if (-not (Get-Command netlify -ErrorAction SilentlyContinue)) {
    Write-Error "netlify CLI not found. Run: npm install -g netlify-cli"
    exit 1
}

# Start Netlify dev server with configured port
netlify dev --port $port
