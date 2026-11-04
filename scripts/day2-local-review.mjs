import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const api=createClient('http://127.0.0.1:56501',process.env.DESIGN_QC_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {error:authError}=await api.auth.signInWithPassword({email:'review-1@local.test',password:'Local-Review-2026!'});if(authError)throw authError;
const {data:control,error:controlError}=await api.from('design_qc_control').select('enabled').single();if(controlError)throw controlError;if(control.enabled)throw new Error('Review seeding requires the already paused QC switch; no switch was changed');
const folder='scratch/day2-review-fixtures';fs.mkdirSync(folder,{recursive:true});
const zip=Buffer.alloc(22);zip.writeUInt32LE(0x06054b50,0);
const html=Buffer.from('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><h1>معاينة اصطناعية للمراجعة</h1><p>هذه ليست عينة exocad فعلية ولا تثبت توافقه.</p></body></html>');
fs.writeFileSync(folder+'/execution.zip',zip);fs.writeFileSync(folder+'/preview.html',html);
const order='fd000000-0000-4000-8000-000000000102',revision='fd000000-0000-4000-8000-000000000301';
for(const [name,bytes,type] of [['execution.zip',zip,'application/zip'],['preview.html',html,'text/html']]){const {error}=await api.storage.from('design-qc-files').upload(`${order}/${revision}/${name}`,bytes,{contentType:type,upsert:false});if(error&&String(error.statusCode)!=='409')throw error;}
const {error:submitError}=await api.rpc('submit_design_revision',{p_order_id:order,p_revision_id:revision,p_execution_url:'https://example.test/local-review-reference-only',p_without_preview_reason:''});if(submitError)throw submitError;
const {error:versionError}=await api.rpc('save_supplier_design_instruction',{p_supplier_id:'fd000000-0000-4000-8000-000000000011',p_version_id:'fd000000-0000-4000-8000-000000000202',p_paragraph:'نسخة أحدث للمراجعة فقط: راجع نقاط التلامس قبل التسليم. النسخة السابقة تبقى مرتبطة بتسليمها.',p_source:'مرجع خاص جديد للأدمن',p_status:'experimental',p_files:[],p_privacy_confirmed:true});if(versionError)throw versionError;
await api.auth.signOut();console.log('Prepared synthetic local execution/preview files and a saved prior-version snapshot.');
