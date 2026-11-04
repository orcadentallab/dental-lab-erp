$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$qcRoot=(Get-Location).Path
$qcWorkspace=[IO.Path]::GetFullPath((Join-Path $qcRoot '.design-qc-qa'))
if($qcWorkspace-ne [IO.Path]::GetFullPath("$qcRoot\.design-qc-qa")){throw 'Unexpected QA workspace'}
$qcMarker=Join-Path $qcWorkspace '.codex-owned-qc-test-workspace'
if((Test-Path -LiteralPath $qcWorkspace)-and -not(Test-Path -LiteralPath $qcMarker)){throw 'Refusing to reuse an unowned QA workspace'}
New-Item -ItemType Directory -Path $qcWorkspace -Force | Out-Null
if(-not(Test-Path -LiteralPath $qcMarker)){
 Set-Content -LiteralPath $qcMarker -Value 'design-qc-disposable-local-only'
 & .\node_modules\supabase\bin\supabase.exe init --workdir $qcWorkspace *> .tmp/design-qc-qa-init.log
 if($LASTEXITCODE-ne 0){throw 'Could not initialize owned local QA workspace'}
}
if((Get-Content -Raw -LiteralPath $qcMarker).Trim()-ne 'design-qc-disposable-local-only'){throw 'QA ownership marker mismatch'}
$qcConfigPath=Join-Path $qcWorkspace 'supabase\config.toml'
$qcConfig=Get-Content -Raw -LiteralPath $qcConfigPath
$qcConfig=[regex]::Replace($qcConfig,'(?m)^project_id = .*$', 'project_id = "design-qc-qa"')
$qcConfig=$qcConfig.Replace('54321','56501').Replace('54322','56502').Replace('54320','56500').Replace('54323','56503').Replace('54324','56504').Replace('54329','56509').Replace('sql_paths = ["./seed.sql"]','sql_paths = []')
Set-Content -LiteralPath $qcConfigPath -Value $qcConfig
if($qcConfig-notmatch '(?m)^project_id = "design-qc-qa"'){throw 'QA project identity mismatch'}
foreach($qcDir in @('migrations','tests\database','.temp')){New-Item -ItemType Directory -Path (Join-Path $qcWorkspace "supabase\$qcDir") -Force|Out-Null}
Copy-Item -Path (Join-Path $qcRoot 'supabase\migrations\*.sql') -Destination (Join-Path $qcWorkspace 'supabase\migrations')
Copy-Item -Path (Join-Path $qcRoot 'supabase\tests\database\*.sql') -Destination (Join-Path $qcWorkspace 'supabase\tests\database')
foreach($qcVersion in @('postgres-version','gotrue-version','storage-version','rest-version')){if(Test-Path -LiteralPath "supabase/.temp/$qcVersion"){Copy-Item -LiteralPath "supabase/.temp/$qcVersion" -Destination (Join-Path $qcWorkspace "supabase\.temp\$qcVersion")}}
& .\node_modules\supabase\bin\supabase.exe start --workdir $qcWorkspace --exclude studio,imgproxy,realtime,logflare,vector,edge-runtime *> .tmp/design-qc-qa-start.log
if($LASTEXITCODE-ne 0){throw 'Local QA startup failed; private diagnostic log retained'}
# This reset targets ONLY the newly owned disposable namespace, never the main project.
& .\node_modules\supabase\bin\supabase.exe db reset --local --workdir $qcWorkspace *> .tmp/design-qc-qa-reset.log
if($LASTEXITCODE-ne 0){throw 'Disposable QA reset failed'}
& .\node_modules\supabase\bin\supabase.exe test db supabase/tests/database --local --workdir $qcWorkspace *> .tmp/design-qc-clean-db.log
if($LASTEXITCODE-ne 0){throw 'Full SQL suite failed in disposable QA; see .tmp/design-qc-clean-db.log'}
$qcStatus=(& .\node_modules\supabase\bin\supabase.exe status --workdir $qcWorkspace --output json 2>$null)|ConvertFrom-Json
if($qcStatus.API_URL -ne 'http://127.0.0.1:56501'){throw 'Refusing a non-local QA API'}
$qcEnabled=& docker exec supabase_db_design-qc-qa psql -U postgres -d postgres -At -c 'SELECT enabled FROM public.design_qc_control WHERE id;'
if($qcEnabled -ne 'f'){throw 'Local QC must already be paused before this QA run; no setting was changed'}
$qcOrderId=[guid]::NewGuid().ToString()
$qcSeed=@'
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
SELECT ('fc000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qc-browser-'||n||'@local.test',extensions.crypt('Local-QC-Only-2026!',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','' FROM generate_series(1,4)n ON CONFLICT(id) DO NOTHING;
INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
SELECT id::text,id,jsonb_build_object('sub',id::text,'email',email,'email_verified',true),'email',now(),now() FROM auth.users WHERE id::text LIKE 'fc000000-0000-0000-0000-%' ON CONFLICT(provider_id,provider) DO NOTHING;
INSERT INTO public.users(id,auth_id,username,role,name,is_active,email)
SELECT ('fc000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('fc000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'qc_browser_'||n,(ARRAY['admin','coordinator','designer','designer'])[n],(ARRAY['QC Browser Admin','QC Browser Coordinator','QC Browser Former Designer','QC Browser Replacement'])[n],true,'qc-browser-'||n||'@local.test' FROM generate_series(1,4)n ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email WHERE public.users.username=EXCLUDED.username AND public.users.auth_id=EXCLUDED.auth_id;
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name) VALUES('fc000000-0000-0000-0000-000000000010','Synthetic QC doctor','01000000000','Local QA','QC-BROWSER','Test') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.suppliers(id,name,phone) VALUES('fc000000-0000-4000-8000-000000000011','Synthetic QC supplier','01000000001') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,workflow_type,designer_id,design_price,supplier_id)
VALUES('__ORDER_ID__','QC-BROWSER-__ORDER_ID__','fc000000-0000-0000-0000-000000000010','Synthetic QC patient','[]',900,400,'A1','designing',current_date,'split','fc000000-0000-0000-0000-000000000003',100,'fc000000-0000-4000-8000-000000000011');
COMMIT;
'@
$qcSeed.Replace('__ORDER_ID__',$qcOrderId) | & docker exec -i supabase_db_design-qc-qa psql -U postgres -d postgres -v ON_ERROR_STOP=1 > $null
if($LASTEXITCODE-ne 0){throw 'Local QC fixture creation failed'}
$qcPreviousFlag=$env:DESIGN_QC_LOCAL_E2E; $qcPreviousAnon=$env:DESIGN_QC_ANON_KEY; $qcPreviousOrder=$env:DESIGN_QC_ORDER_ID
try{
 $env:DESIGN_QC_LOCAL_E2E='1';$env:DESIGN_QC_ANON_KEY=$qcStatus.ANON_KEY;$env:DESIGN_QC_ORDER_ID=$qcOrderId
 & node node_modules/@playwright/test/cli.js test --config playwright.design-qc.config.ts
 if($LASTEXITCODE-ne 0){throw 'Local QC browser tests failed'}
}finally{
 # Restore the initially paused local switch even if browser QA failed.
 @'
BEGIN;
SELECT set_config('request.jwt.claim.sub','fc000000-0000-0000-0000-000000000001',true);
SELECT public.set_design_qc_enabled(false,'Restore paused state after local browser QA');
COMMIT;
'@ | & docker exec -i supabase_db_design-qc-qa psql -U postgres -d postgres -v ON_ERROR_STOP=1 > $null
 $env:DESIGN_QC_LOCAL_E2E=$qcPreviousFlag;$env:DESIGN_QC_ANON_KEY=$qcPreviousAnon;$env:DESIGN_QC_ORDER_ID=$qcPreviousOrder
}
