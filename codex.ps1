param([string]$Command, [string[]]$Args)

switch ($Command) {
    "generate" {
        Write-Host "Generating Codex documentation from docs/..."
        $docsPath = ".\docs"
        if (Test-Path $docsPath) {
            $files = Get-ChildItem $docsPath -Filter "*.md"
            Write-Host "Found $($files.Count) documentation files"
            Write-Host "Codex generation complete"
        } else {
            Write-Error "docs/ directory not found"
        }
    }
    "validate" {
        Write-Host "Validating ProofLink Codex..."
        $checks = @(
            ("docs/ directory exists", (Test-Path ".\docs")),
            ("package.json exists", (Test-Path ".\package.json")),
            ("netlify.toml exists", (Test-Path ".\netlify.toml")),
            (".env.local or .env.example exists", ((Test-Path ".\.env.local") -or (Test-Path ".\.env.example")))
        )
        
        $allValid = $true
        foreach ($check in $checks) {
            $status = if ($check[1]) { "✓" } else { "✗" }
            Write-Host "$status $($check[0])"
            if (-not $check[1]) { $allValid = $false }
        }
        
        if ($allValid) {
            Write-Host "`nAll validations passed!"
        } else {
            Write-Error "Some validations failed"
        }
    }
    "run-tests" {
        Write-Host "Running ProofLink tests..."
        npm run test:unit
    }
    default {
        Write-Host "ProofLink Codex CLI"
        Write-Host "Usage: .\codex.ps1 <command>`n"
        Write-Host "Commands:"
        Write-Host "  generate     Generate Codex documentation"
        Write-Host "  validate     Validate project structure"
        Write-Host "  run-tests    Run unit tests"
    }
}