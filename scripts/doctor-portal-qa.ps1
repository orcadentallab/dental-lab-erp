$ErrorActionPreference = 'Stop'
$qaRepoRoot = Split-Path -Parent $PSScriptRoot
$qaWorkspace = Join-Path $qaRepoRoot '.doctor-portal-qa'
$qaConfigPath = Join-Path $qaWorkspace 'supabase\config.toml'

# This script only starts the dedicated local project; it never resets or links a database.
Push-Location $qaRepoRoot
try {
    New-Item -ItemType Directory -Path $qaWorkspace -Force | Out-Null
    if (-not (Test-Path -LiteralPath $qaConfigPath)) {
        & npx.cmd --no-install supabase init --workdir $qaWorkspace
        if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the disposable local project.' }
    }
    $qaConfig = Get-Content -Raw -LiteralPath $qaConfigPath
    if ($qaConfig -notmatch 'project_id = "doctor-portal-qa"') {
        throw 'Unexpected project identity. Refusing to modify this environment.'
    }
    $qaConfig = $qaConfig.Replace('54321', '56431').Replace('54322', '56432').Replace('54320', '56430')
    $qaConfig = $qaConfig.Replace('54323', '56433').Replace('54324', '56434').Replace('54329', '56439')
    $qaConfig = $qaConfig.Replace('sql_paths = ["./seed.sql"]', 'sql_paths = []')
    # The dedicated registration RPC creates accounts atomically. Disable raw
    # Auth signup to prevent bypassing pending approval. Phone is a password-
    # protected alias; its resolver needs no SMS provider or phone OTP.
    $qaConfig = [regex]::Replace($qaConfig, '(\[auth\][\s\S]*?enable_signup = )true', '${1}false')
    $qaConfig = [regex]::Replace($qaConfig, '(\[auth.sms\][\s\S]*?enable_signup = )true', '${1}false')
    Set-Content -LiteralPath $qaConfigPath -Value $qaConfig
    $qaMigrations = Join-Path $qaWorkspace 'supabase\migrations'
    New-Item -ItemType Directory -Path $qaMigrations -Force | Out-Null
    Copy-Item -Path (Join-Path $qaRepoRoot 'supabase\migrations\*.sql') -Destination $qaMigrations

    & npx.cmd --no-install supabase start --workdir $qaWorkspace --exclude studio,imgproxy,realtime,logflare,vector,edge-runtime
    if ($LASTEXITCODE -ne 0) { throw 'Local Supabase failed to start.' }
    $qaStatus = (& npx.cmd --no-install supabase status --workdir $qaWorkspace --output json 2>$null) | ConvertFrom-Json
    if ($qaStatus.API_URL -ne 'http://127.0.0.1:56431') {
        throw 'Unexpected API URL. Refusing to seed or test it.'
    }
    & npx.cmd --no-install supabase migration up --local --include-all --workdir $qaWorkspace
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply pending migrations to the dedicated local project.' }

    @'
ALTER DATABASE postgres SET app.doctor_otp_mock_enabled = 'on';
ALTER DATABASE postgres SET app.doctor_otp_hmac_key = 'local-browser-test-only-key';
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,is_center)
VALUES
('81000000-0000-0000-0000-000000000061','Desktop QA Doctor','01066000001','Local test address','DOC-QA-61','QA',false),
('81000000-0000-0000-0000-000000000062','Mobile QA Doctor','01066000002','Local test address','DOC-QA-62','QA',false)
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.phone_verifications WHERE normalized_phone IN ('201066000001','201066000002');
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
VALUES('82000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000000','authenticated','authenticated','doctor-codes-qa@local.test',extensions.crypt('local-qa-codes-only',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','') ON CONFLICT(id) DO NOTHING;
INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
VALUES('82000000-0000-0000-0000-000000000081','82000000-0000-0000-0000-000000000081','{"sub":"82000000-0000-0000-0000-000000000081","email":"doctor-codes-qa@local.test","email_verified":true}','email',now(),now()) ON CONFLICT(provider_id,provider) DO NOTHING;
INSERT INTO public.users(id,auth_id,username,role,name,is_active)
VALUES('83000000-0000-0000-0000-000000000081','82000000-0000-0000-0000-000000000081','doctor-codes-qa','admin','مسؤول اختبار محلي',true) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.services(id,name,selling_price,cost_price)
VALUES ('91000000-0000-0000-0000-000000000061','زيركون — تجربة محلية',800,0),
('91000000-0000-0000-0000-000000000062','إيماكس — تجربة محلية',1200,0),
('91000000-0000-0000-0000-000000000063','بورسلين — تجربة محلية',500,0)
ON CONFLICT (id) DO NOTHING;
UPDATE public.doctors SET has_branches=true, branches='[{"id":"92000000-0000-0000-0000-000000000061","name":"فرع المعادي التجريبي","address":"القاهرة - المعادي - عنوان الفرع التجريبي","phone":"01066000001"},{"id":"92000000-0000-0000-0000-000000000062","name":"فرع التجمع التجريبي","address":"القاهرة - التجمع - عنوان الفرع التجريبي","phone":"01066000001"}]'::jsonb
WHERE id='81000000-0000-0000-0000-000000000061';


'@ | & docker exec -e PGPASSWORD=postgres -i supabase_db_doctor-portal-qa psql -U supabase_admin -v ON_ERROR_STOP=1 -d postgres
    if ($LASTEXITCODE -ne 0) { throw 'Could not seed the dedicated test database.' }
    & docker restart supabase_rest_doctor-portal-qa
    if ($LASTEXITCODE -ne 0) { throw 'Could not reload the local test API settings.' }

    $qaPriorAnonKey = $env:DOCTOR_PORTAL_QA_ANON_KEY
    try {
        $env:DOCTOR_PORTAL_QA_ANON_KEY = $qaStatus.ANON_KEY
        & npx.cmd --no-install playwright test --config playwright.doctor-portal.config.ts
        if ($LASTEXITCODE -ne 0) { throw 'Doctor portal browser verification failed.' }
    } finally {
        $env:DOCTOR_PORTAL_QA_ANON_KEY = $qaPriorAnonKey
    }
    Write-Output 'Local doctor portal QA passed. Stop the dedicated project with: npx supabase stop --workdir .doctor-portal-qa'
} finally {
    Pop-Location
}
