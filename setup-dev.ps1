# No-Admin Version of setup-dev.ps1

# This script sets up the development environment without requiring admin rights.

$ErrorActionPreference = 'Stop'

# Verify Node.js is available
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js not found. Please install Node.js from https://nodejs.org and re-run this script."
    exit 1
}

# Verify npm is available
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm not found. Please install Node.js (which includes npm) from https://nodejs.org"
    exit 1
}

# Install npm dependencies
Write-Host "Installing npm dependencies..."
npm install

# Create .env.local from .env.example if it does not already exist
if (-not (Test-Path '.\.env.local')) {
    if (Test-Path '.\.env.example') {
        Copy-Item '.\.env.example' '.\.env.local'
        Write-Host "Created .env.local from .env.example. Fill in your values before starting the dev server."
    } else {
        Write-Host "Warning: .env.example not found. Create a .env.local file manually."
    }
} else {
    Write-Host ".env.local already exists, skipping."
}

Write-Host "Development environment setup completed without admin rights."
