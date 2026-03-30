# PowerShell script to start Netlify dev server

# Load environment variables from .env file
$envVars = Get-Content .\.env | ForEach-Object { $name, $value = $_ -split '='; [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim()) }

# Set default port and check for command line argument for port
$defaultPort = 8888
$port = if ($args.Count -gt 0) { $args[0] } else { $defaultPort }

# Start Netlify dev server with configured port
Start-Process -NoNewWindow -File "netlify" -ArgumentList "dev --port $port"