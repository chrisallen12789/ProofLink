# CODEX PowerShell Setup Documentation

## Introduction
This document provides instructions on how to use the PowerShell scripts to run CODEX locally on Windows.

## Prerequisites
- PowerShell 5.1 or later (built into Windows 10/11)
- [Node.js](https://nodejs.org) (includes npm)
- [Netlify CLI](https://docs.netlify.com/cli/get-started/): `npm install -g netlify-cli`

## Setup Instructions

1. **Clone the Repository:**
   ```powershell
   git clone https://github.com/chrisallen12789/ProofLink.git
   cd ProofLink
   ```

2. **Allow Script Execution (one-time):**
   Open PowerShell as your normal user and run:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

3. **Set Up the Dev Environment:**
   ```powershell
   .\setup-dev.ps1
   ```
   This installs npm dependencies and creates `.env.local` from `.env.example`.
   Fill in your actual values in `.env.local` before continuing.

4. **Start the Dev Server:**
   ```powershell
   .\dev.ps1
   ```
   Optionally pass a custom port:
   ```powershell
   .\dev.ps1 9000
   ```

## Codex CLI Commands

Run project tasks with `codex.ps1`:

```powershell
# Validate project structure
.\codex.ps1 validate

# Generate documentation index
.\codex.ps1 generate

# Run unit tests
.\codex.ps1 run-tests
```

## Useful Commands

- Check your current directory: `Get-Location`
- List files: `Get-ChildItem`
- Load env vars manually: `.\load-env.ps1` (defaults to `.env.local`, falls back to `.env.example`)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "cannot be loaded because running scripts is disabled" | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| "netlify CLI not found" | Run `npm install -g netlify-cli` |
| "npm not found" | Install Node.js from https://nodejs.org |
| `.env.local` missing | Run `.\setup-dev.ps1` or copy `.env.example` manually |

For more information, refer to the repository README or open an issue on GitHub.
