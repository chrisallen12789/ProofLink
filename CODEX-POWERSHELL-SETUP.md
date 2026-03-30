# CODEX PowerShell Setup Documentation

## Introduction
This document provides instructions on how to use the new PowerShell scripts to run CODEX locally.

## Prerequisites
- Make sure you have PowerShell installed on your machine.
- Clone the repository containing the PowerShell scripts.

## Setup Instructions
1. **Clone the Repository:**  
   Open PowerShell and run the following command:
   ```powershell
   git clone https://github.com/chrisallen12789/ProofLink.git
   ```

2. **Navigate to the Scripts Directory:**  
   ```powershell
   cd ProofLink/path_to_scripts_directory
   ```

3. **Run the PowerShell Script:**  
   Depending on your requirement, you can invoke the required script. For example:
   ```powershell
   .\run_codex.ps1
   ```

4. **Follow on-screen instructions** to complete the setup.

## Useful Commands
- To check the current directory:
  ```powershell
  Get-Location
  ```

- To list files in the current directory:
  ```powershell
  Get-ChildItem
  ```

## Troubleshooting
- If you encounter any issues, ensure that your PowerShell's execution policy allows running scripts. You can set it by running:
  ```powershell
  Set-ExecutionPolicy RemoteSigned
  ```

For more information or additional support, refer to the repository's README or contact the maintainers.

## Conclusion
This documentation will help you get started with running CODEX locally using PowerShell scripts. For further details, please refer to other documents in the repository.