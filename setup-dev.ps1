# No-Admin Version of setup-dev.ps1

# This script sets up the development environment without requiring admin rights.

# Check if the script is run with the CurrentUser scope
if (-not ([Windows.Security.AccessControl.AuthorizationManager]::CheckAccess([Windows.Security.AccessControl.WindowsPrincipal]::CurrentPrincipal))) {
    Write-Host "CurrentUser scope is required. Exiting..."
    exit
}

# Function to install necessary modules for development
function Install-Modules {
    $modules = @('Module1', 'Module2', 'Module3')  # Update this list with actual module names
    foreach ($module in $modules) {
        if (-not (Get-Module -ListAvailable -Name $module)) {
            Write-Host "Installing $module..."
            Install-Module -Name $module -Scope CurrentUser -Force
        } else {
            Write-Host "$module is already installed."
        }
    }
}

# Main script execution
Install-Modules

Write-Host "Development environment setup completed without admin rights.">
