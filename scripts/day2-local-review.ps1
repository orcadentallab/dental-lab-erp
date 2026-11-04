[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$reviewWorkspace=Join-Path (Get-Location) '.design-qc-qa'
$reviewMarker=Join-Path $reviewWorkspace '.codex-owned-qc-test-workspace'
if(!(Test-Path -LiteralPath $reviewMarker) -or (Get-Content -Raw -LiteralPath $reviewMarker).Trim() -ne 'design-qc-disposable-local-only'){throw 'Owned disposable QA marker required'}
$reviewStatus=(& .\node_modules\supabase\bin\supabase.exe status --workdir $reviewWorkspace --output json 2>$null)|ConvertFrom-Json
if($reviewStatus.API_URL -ne 'http://127.0.0.1:56501'){throw 'Only the isolated local QA API is allowed'}
$reviewSeed=@'
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
SELECT ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-'||n||'@local.test',extensions.crypt('Local-Review-2026!',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','' FROM generate_series(1,6)n ON CONFLICT(id) DO NOTHING;
INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
SELECT id::text,id,jsonb_build_object('sub',id::text,'email',email,'email_verified',true),'email',now(),now() FROM auth.users WHERE id::text LIKE 'fd000000-0000-4000-8000-%' ON CONFLICT(provider_id,provider) DO NOTHING;
INSERT INTO public.users(id,auth_id,username,role,name,is_active,email,designer_service_prices)
SELECT ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(ARRAY['review_admin','review_coordinator','review_designer_old','review_designer_new','review_accountant','review_employee'])[n],(ARRAY['admin','coordinator','designer','designer','accountant','representative'])[n],(ARRAY['أدمن المراجعة المحلية','منسق المراجعة','مصمم المراجعة الأول','مصمم المراجعة البديل','محاسب المراجعة','موظف المراجعة'])[n],true,'review-'||n||'@local.test','{"Review Crown":100}' FROM generate_series(1,6)n ON CONFLICT(id) DO NOTHING;
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name) VALUES('fd000000-0000-4000-8000-000000000010','طبيب تجريبي للمراجعة','01000000000','QA فقط','LOCAL-REVIEW','المراجعة') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.suppliers(id,name,phone,supplier_type) VALUES('fd000000-0000-4000-8000-000000000011','معمل تجريبي للمراجعة','01000000001','external_lab') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.cashboxes(id,name,type,opening_balance) VALUES('fd000000-0000-4000-8000-000000000020','خزنة المراجعة المحلية','cash',1000) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,workflow_type,designer_id,design_price,supplier_id)
SELECT ('fd000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'DAY2-REVIEW-'||n,'fd000000-0000-4000-8000-000000000010','حالة تصميم تجريبية '||n,'[]',900,400,'A1','designing',current_date+3,'split','fd000000-0000-4000-8000-000000000003',100,'fd000000-0000-4000-8000-000000000011' FROM generate_series(1,2)n ON CONFLICT(id) DO NOTHING;
INSERT INTO public.order_items(order_id,product_type,teeth_numbers,price,shade,count)
SELECT id,'Review Crown','["11"]',900,'A1',1 FROM public.orders o WHERE case_id IN('DAY2-REVIEW-1','DAY2-REVIEW-2') AND NOT EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=o.id);
SELECT set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
SELECT public.save_supplier_design_instruction('fd000000-0000-4000-8000-000000000011','fd000000-0000-4000-8000-000000000201','تعليمات تجريبية للمراجعة فقط: راجع حدود التحضير قبل إخراج ملفات التنفيذ.','مرجع خاص للأدمن — معمل تجريبي للمراجعة','experimental','[]',true);
COMMIT;
'@
$reviewSeed | & docker exec -i supabase_db_design-qc-qa psql -U postgres -d postgres -v ON_ERROR_STOP=1 *> .tmp/day2-review-seed.log
if($LASTEXITCODE -ne 0){throw 'Review fixtures failed; see private local seed log'}
$reviewPreviousKey=$env:DESIGN_QC_ANON_KEY
try{$env:DESIGN_QC_ANON_KEY=$reviewStatus.ANON_KEY;& node scripts/day2-local-review.mjs;if($LASTEXITCODE -ne 0){throw 'Local review asset preparation failed'}}finally{$env:DESIGN_QC_ANON_KEY=$reviewPreviousKey}
Write-Host 'Local review ready: http://127.0.0.1:5173/design-qc — review_admin / Local-Review-2026!'
