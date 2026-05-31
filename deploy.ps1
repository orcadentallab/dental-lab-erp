# Strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

function Write-WarningMsg {
    param($Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Test-Command {
    param($Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

# Main
try {
    Write-Info "Starting deployment process..."

    # 0. Pre-flight checks
    if (-not (Test-Command "git")) {
        throw "git is not installed or not in PATH."
    }
    if (-not (Test-Command "npm")) {
        throw "npm is not installed or not in PATH."
    }

    # Verify we're inside a git repository
    git rev-parse --git-dir | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Not inside a git repository. Aborting."
    }

    # Check current branch
    $branch = git branch --show-current
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to determine current branch."
    }
    Write-Info "Deploying from branch: $branch"

    # 1. Run Build
    Write-Info "Running build..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed. Aborting deployment."
    }
    Write-Success "Build passed."

    # 2. Check for changes
    $status = git status --porcelain
    if ([string]::IsNullOrWhiteSpace($status)) {
        Write-Info "No changes to commit. Proceeding to push..."
    }
    else {
        # 3. Request Commit Message
        $commitMessage = Read-Host "Enter commit message (Leave empty for 'Auto-update')"
        if ([string]::IsNullOrWhiteSpace($commitMessage)) {
            $commitMessage = "Auto-update: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
            Write-Info "No message entered. Using default: $commitMessage"
        }

        # 4. Git Add & Commit
        Write-Info "Staging changes..."
        git add .
        if ($LASTEXITCODE -ne 0) {
            throw "git add failed."
        }

        Write-Info "Committing changes..."
        git commit -m "$commitMessage"
        if ($LASTEXITCODE -ne 0) {
            throw "git commit failed."
        }
    }

    # 5. Git Push
    Write-Info "Pushing to remote..."
    git push origin HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Push failed. Please check your internet connection or git credentials."
    }

    Write-Success "Deployment completed successfully."
    Write-Info "Changes are pushed to remote repo. Your online deployment should trigger automatically."
}
catch {
    Write-ErrorMsg "Deployment failed: $_"
    exit 1
}
finally {
    Read-Host "Press Enter to exit..."
}
