# setup-dev.ps1

# Check Node.js installation
try {
    $nodeVersion = & node --version
    Write-Host "Node.js version: $nodeVersion"
} catch {
    Write-Host "Node.js is not installed. Please install Node.js before proceeding."
    exit 1
}

# Install npm dependencies
try {
    npm install
    Write-Host "NPM dependencies installed successfully."
} catch {
    Write-Host "Failed to install NPM dependencies."
    exit 1
}

# Create .env.local from .env.example
try {
    Copy-Item .env.example .env.local -Force
    Write-Host ".env.local created from .env.example"
} catch {
    Write-Host "Failed to create .env.local file."
    exit 1
}