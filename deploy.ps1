# Strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

function Write-Success {
    param($Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-ErrorMsg {
    param($Message)
    Write-Host "[!] $Message" -ForegroundColor Red
}

function Write-Info {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

# Main
try {
    # 1. Request Commit Message
    $commitMessage = Read-Host "Enter commit message"
    if (-not $commitMessage) {
        Write-ErrorMsg "Commit message cannot be empty."
        exit 1
    }

    # 2. Run Build
    Write-Info "Running build..."
    # Using cmd /c mainly to ensure npm is found in path correctly on some windows envs, 
    # but direct call usually works too. Let's try direct first.
    # Note: npm outputs to stderr for info sometimes, so we check $LASTEXITCODE
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Build failed. Aborting deployment."
        exit 1
    }
    Write-Success "Build passed."

    # 3. Git Add
    Write-Info "Staging changes..."
    git add .
    
    # 4. Git Commit
    Write-Info "Committing changes..."
    git commit -m "$commitMessage"
    # git commit returns 1 if nothing to commit usually, but could be other errors. 
    # We'll check output or just proceed if git status shows clean.
    
    # 5. Git Push
    Write-Info "Pushing to remote..."
    git push origin master
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Push failed."
        exit 1
    }

    Write-Success "Deployment logic completed successfully."
    Write-Info "Changes are pushed to 'master'. Deployment should trigger automatically."
    exit 0
}
catch {
    Write-Warning "An unexpected error occurred: $_"
    exit 1
}
