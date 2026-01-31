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

function Write-WarningMsg {
    param($Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

# Main
try {
    Write-Info "Starting deployment process..."
    
    # Check if we are on master branch
    $branch = git branch --show-current
    Write-Info "Deploying from branch: $branch"

    # 1. Run Build
    Write-Info "Running build..."
    # Using npm run build
    cmd /c "npm run build"
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Build failed. Aborting deployment."
        Read-Host "Press Enter to exit..."
        exit 1
    }
    Write-Success "Build passed."

    # 2. Check for changes
    $status = git status --porcelain
    if (-not $status) {
        Write-Info "No changes to commit. Proceeding to push..."
    }
    else {
        # 3. Request Commit Message
        $commitMessage = Read-Host "Enter commit message (Leave empty for 'Auto-update')"
        if (-not $commitMessage) {
            $commitMessage = "Auto-update: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
            Write-Info "No message entered. Using default: $commitMessage"
        }
        
        # 4. Git Add & Commit
        Write-Info "Staging changes..."
        git add .
        
        Write-Info "Committing changes..."
        git commit -m "$commitMessage"
    }
    
    # 5. Git Push
    Write-Info "Pushing to remote..."
    git push origin HEAD
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Push failed. Please check your internet connection or git credentials."
        Read-Host "Press Enter to exit..."
        exit 1
    }

    Write-Success "Deployment completed successfully."
    Write-Info "Changes are pushed to 'master'."
    Read-Host "Press Enter to exit..."
    exit 0
}
catch {
    Write-ErrorMsg "An unexpected error occurred: $_"
    Read-Host "Press Enter to exit..."
    exit 1
}
