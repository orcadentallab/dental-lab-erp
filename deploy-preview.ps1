param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$previewBranch = 'preview'
$excludedPaths = @(
    ':(exclude).tmp/**',
    ':(exclude)tmp/**',
    ':(exclude)output/**',
    ':(exclude)playwright-report/**',
    ':(exclude)test-results/**',
    ':(exclude)supabase/.temp/**'
)

function Write-Step([string]$message) {
    Write-Host "[PREVIEW] $message" -ForegroundColor Cyan
}

function Assert-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name is not installed or is not available in PATH."
    }
}

function Invoke-Checked([string]$label, [scriptblock]$command) {
    Write-Step $label
    & $command
    if ($LASTEXITCODE -ne 0) {
        throw "$label failed."
    }
}

try {
    Assert-Command 'git'
    Assert-Command 'npm'

    Invoke-Checked 'Checking Git repository' { git rev-parse --git-dir | Out-Null }
    $currentBranch = (git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)) {
        throw 'Could not determine the current Git branch.'
    }

    if ($currentBranch -ne $previewBranch) {
        throw "Preview deploy is allowed only from branch '$previewBranch'. Current branch: '$currentBranch'."
    }

    Write-Host '[SAFE] No Supabase migration command is executed by this script.' -ForegroundColor Green
    Write-Host '[SAFE] This script never pushes to master.' -ForegroundColor Green
    Write-Host '[REQUIRED] Vercel Preview variables must point to a separate staging Supabase project.' -ForegroundColor Yellow

    Invoke-Checked 'Running typecheck' { npm run typecheck }
    Invoke-Checked 'Running source lint' { npx eslint src/ }
    Invoke-Checked 'Running unit tests' { npm run test:unit }
    Invoke-Checked 'Building preview bundle' { npm run build }

    Write-Step 'Reviewing working tree'
    git status --short

    if ($DryRun) {
        Write-Host '[DRY RUN] Checks passed. Nothing was staged, committed, merged, or pushed.' -ForegroundColor Green
        exit 0
    }

    $confirmation = Read-Host "Type DEPLOY PREVIEW to stage non-generated project files and continue"
    if ($confirmation -cne 'DEPLOY PREVIEW') {
        throw 'Preview deployment cancelled.'
    }

    Write-Step 'Staging project changes (generated/temp folders are excluded)'
    & git add -A -- .
    if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }

    # Exclude local/generated paths after staging. Passing ignored paths as
    # negative pathspecs to `git add` can still return exit code 1 on Windows,
    # even though the intended project files were staged successfully.
    & git reset --quiet HEAD -- @($excludedPaths | ForEach-Object {
        $_ -replace '^:\(exclude\)', '' -replace '/\*\*$', ''
    })
    if ($LASTEXITCODE -ne 0) { throw 'Could not exclude generated/temp folders.' }

    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) {
        $commitMessage = Read-Host "Commit message (default: preview update)"
        if ([string]::IsNullOrWhiteSpace($commitMessage)) {
            $commitMessage = 'chore(preview): update preview deployment'
        }
        Invoke-Checked 'Committing preview changes' { git commit -m $commitMessage }
    }
    elseif ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect staged changes.'
    }

    Invoke-Checked 'Fetching latest production branch' { git fetch origin master }
    Invoke-Checked 'Merging latest production code into preview' { git merge --no-edit origin/master }

    # The merge can change application code, so verify the final commit again.
    Invoke-Checked 'Re-running typecheck after merge' { npm run typecheck }
    Invoke-Checked 'Re-building after merge' { npm run build }

    Invoke-Checked 'Pushing only to origin/preview' { git push -u origin HEAD:preview }

    Write-Host '[OK] Preview branch pushed. Vercel/Netlify should create a non-production deployment.' -ForegroundColor Green
    Write-Host '[NEXT] Open the hosting dashboard and use the deployment URL for branch preview.' -ForegroundColor Cyan
}
catch {
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
