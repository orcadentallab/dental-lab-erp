Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

function Assert-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name is not installed or is not available in PATH."
    }
}

function Get-SupabaseStatusValue([string[]]$lines, [string]$name) {
    $prefix = "$name="
    $line = $lines | Where-Object { $_.StartsWith($prefix) } | Select-Object -First 1
    if (-not $line) { throw "Supabase status did not return $name." }
    return $line.Substring($prefix.Length).Trim().Trim('"')
}

try {
    Assert-Command 'npm'
    Assert-Command 'supabase'

    $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    Set-Location $projectRoot

    Write-Host '[LOCAL] Starting isolated Supabase services...' -ForegroundColor Cyan
    supabase start
    if ($LASTEXITCODE -ne 0) { throw 'supabase start failed.' }

    Write-Host '[LOCAL] Applying pending migrations locally only...' -ForegroundColor Cyan
    supabase migration up --local
    if ($LASTEXITCODE -ne 0) { throw 'Local migrations failed.' }

    Write-Host '[LOCAL] Creating the local-only test login...' -ForegroundColor Cyan
    $localSeedPath = Join-Path $projectRoot 'supabase\seeds\local_preview_admin.sql'
    if (-not (Test-Path -LiteralPath $localSeedPath)) {
        throw 'Local Preview login seed is missing.'
    }
    Get-Content -LiteralPath $localSeedPath -Raw |
        docker exec -e PGPASSWORD=postgres -i supabase_db_dental-lab-erp `
            psql -U supabase_admin -v ON_ERROR_STOP=1 -d postgres
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local test login.' }

    # Supabase may report optional stopped services (for example imgproxy or
    # pooler) on stderr even while the required local API is healthy. Do not
    # let PowerShell promote that informational warning to a terminating error.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $statusLines = @(supabase status -o env 2>$null)
    $statusExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($statusExitCode -ne 0) { throw 'Could not read local Supabase status.' }

    $env:VITE_SUPABASE_URL = Get-SupabaseStatusValue $statusLines 'API_URL'
    $env:VITE_SUPABASE_ANON_KEY = Get-SupabaseStatusValue $statusLines 'ANON_KEY'
    $env:VITE_OTP_CHANNEL = 'mock'

    Write-Host "[SAFE] Frontend will use local Supabase at $($env:VITE_SUPABASE_URL)." -ForegroundColor Green
    Write-Host '[LOGIN] Username: Sleem' -ForegroundColor Yellow
    Write-Host '[LOGIN] Password: LocalPreview123!' -ForegroundColor Yellow
    Write-Host '[NOTE] This account and database exist on this computer only.' -ForegroundColor Yellow
    Write-Host '[LOCAL] Starting Vite at http://127.0.0.1:5173 ...' -ForegroundColor Cyan
    npm run dev -- --host 127.0.0.1
    if ($LASTEXITCODE -ne 0) { throw 'Vite development server failed.' }
}
catch {
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
