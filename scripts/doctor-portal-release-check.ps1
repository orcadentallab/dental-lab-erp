# Windows PowerShell 5 turns benign CLI stderr into NativeCommandError.
# Every native command below checks its actual exit code explicitly.
$ErrorActionPreference = 'Continue'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$releaseQa = Join-Path $releaseRoot '.doctor-portal-qa'
Push-Location $releaseRoot
try {
    $releaseStatus = (& npx.cmd --no-install supabase status --workdir $releaseQa --output json 2>$null) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $releaseStatus.API_URL -ne 'http://127.0.0.1:56431') { throw 'Start the isolated doctor-portal-qa environment first. Production is never used by this script.' }
    $env:DOCTOR_PORTAL_QA_ANON_KEY = $releaseStatus.ANON_KEY
    $env:DOCTOR_PORTAL_QA_ACCESS_MODE = 'password'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    & npm.cmd run lint
    if ($LASTEXITCODE -ne 0) { throw 'Lint failed' }
    & npm.cmd run test:unit
    if ($LASTEXITCODE -ne 0) { throw 'Unit regressions failed' }
    $releaseTests = @(
        'doctor_password_registration', 'doctor_registration_contacts', 'doctor_portal_scope_and_intake',
        'doctor_region_codes_and_names', 'doctor_onboarding_and_destination',
        'security_definer_rpc_grants', 'rls_role_matrix', 'deactivated_users_lockout',
        'production_from_order_status', 'production_transitions', 'production_jobs', 'shipments_and_packaging'
    ) | ForEach-Object { Join-Path $releaseRoot "supabase/tests/database/$_.test.sql" }
    & npx.cmd --no-install supabase test db @releaseTests --local --workdir $releaseQa
    if ($LASTEXITCODE -ne 0) { throw 'Database regressions failed' }
    & npx.cmd playwright test --config playwright.doctor-portal.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'Desktop/mobile portal regressions failed' }
    Write-Output 'Local portal release checks passed. Production deployment and financial parity checks are separate.'
} finally { Pop-Location }
