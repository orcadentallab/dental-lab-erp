import { supabase } from '../../lib/supabase';
import { validateDesignFiles } from '../../lib/designPreview';
import { ensureAbsoluteUrl } from '../../lib/urlUtils';
export interface DesignRevision { id:string; order_id:string; revision_no:number; execution_path:string|null; preview_path:string|null; execution_url:string|null; without_preview_reason:string|null; submitted_at:string; requires_qc:boolean }
export interface DesignReviewEvent { id:string; revision_id:string|null; action:string; note:string; actor_role:string; actor_id:string; actor_name?:string; needs_followup:boolean; created_at:string }
export interface DesignQcState { enabled:boolean; currentRevisionId:string|null; required:boolean; revisions:DesignRevision[]; events:DesignReviewEvent[] }
export interface DesignQueueItem { id:string; caseId:string; revisionId:string|null; required:boolean; state:string }
export interface DesignOption {id:string;name:string;price:number;salaried:boolean}
export interface QcCompensation {id:string;orderId:string;caseId:string;designerId:string;amount:number;date:string}
async function rpc<T>(name:string, args:Record<string,unknown>={}):Promise<T> {
    const {data,error}=await supabase.rpc(name,args);
    const messages:Record<string,string>={
        'Rejected execution files cannot be bypassed':'لا يمكن تجاوز ملفات سبق رفضها؛ ارفع ملفات تنفيذ معدّلة.',
        'Design QC approval or permitted bypass required':'التنفيذ يحتاج موافقة على النسخة الحالية أو تجاوزًا مسموحًا ومسببًا.',
        'Design access denied':'لم يعد لديك صلاحية لهذه الحالة.',
        'Admin role required':'هذا الإجراء للأدمن فقط.',
        'Reason required':'اكتب الملاحظات أو سبب الإجراء.',
        'Review the current revision':'النسخة تغيّرت؛ حدّث البيانات وراجع النسخة الحالية.',
        'Fixed-salary designer has no per-case settlement':'المصمم براتب ثابت؛ لا تُنشأ له تسوية أجر للحالة.',
        'Valid fees and reason required':'اكتب مبالغ صحيحة غير سالبة وسبب إعادة التكليف.'
    };
    if(error) throw new Error(messages[error.message]||error.message);
    return data as T;
}
export const getDesignQcState=(orderId:string)=>rpc<DesignQcState>('get_design_qc_state',{p_order_id:orderId});
export const getDesignQcQueue=()=>rpc<DesignQueueItem[]>('get_design_qc_queue');
export const getDesignQcOptions=(orderId:string)=>rpc<DesignOption[]>('get_design_qc_designer_options',{p_order_id:orderId});
export const setDesignQcEnabled=(enabled:boolean,reason:string)=>rpc<{enabled:boolean}>('set_design_qc_enabled',{p_enabled:enabled,p_reason:reason});
export async function getDesignQcEnabled():Promise<boolean> {
    const {data,error}=await supabase.from('design_qc_control').select('enabled').single();
    if(error) throw new Error(error.message);
    return data.enabled as boolean;
}
export async function submitDesignRevision(orderId:string,executionUrl:string,execution:File,html:File|null,reason:string):Promise<string> {
    validateDesignFiles(execution,html);
    if(!html&&!reason.trim()) throw new Error('اكتب سبب التسليم بدون معاينة');
    const id=crypto.randomUUID();
    const bucket=supabase.storage.from('design-qc-files');
    const {error}=await bucket.upload(`${orderId}/${id}/execution.zip`,execution,{upsert:false,contentType:'application/zip'});
    if(error) throw new Error(error.message);
    if(html) {
        const {error:htmlError}=await bucket.upload(`${orderId}/${id}/preview.html`,html,{upsert:false,contentType:'text/html'});
        if(htmlError) throw new Error(htmlError.message);
    }
    // Failed finalization leaves private, immutable unreferenced files; no lossy cleanup.
    return rpc<string>('submit_design_revision',{p_order_id:orderId,p_revision_id:id,p_execution_url:executionUrl,p_without_preview_reason:html?'':reason});
}
export interface DesignDeliveryInput {mode:'link'|'file';url:string;execution:File|null;html:File|null;reason:string}
export async function submitDesignDelivery(orderId:string,input:DesignDeliveryInput):Promise<string>{
    const url=input.url.trim();
    if(input.mode==='link'){
        if(input.execution)throw new Error('اختر رابطًا أو ملفًا واحدًا للتنفيذ');
        try{const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error();}catch{throw new Error('اكتب رابط HTTPS صالحًا للتصميم');}
    }else{
        if(url||!input.execution)throw new Error('اختر ملف التنفيذ دون رابط إضافي');
        validateDesignFiles(input.execution,input.html);
    }
    if(input.html&&(!/\.html?$/i.test(input.html.name)||input.html.size<1||input.html.size>10*1024*1024))throw new Error('اختر HTML مستقلًا لا يتجاوز 10 ميجا');
    if(!input.html&&!input.reason.trim())throw new Error('اكتب سبب التسليم بدون معاينة');
    const id=crypto.randomUUID(),bucket=supabase.storage.from('design-qc-files');
    for(const [file,name,type] of [[input.execution,'execution.zip','application/zip'],[input.html,'preview.html','text/html']] as const){
        if(!file)continue;
        const {error}=await bucket.upload(`${orderId}/${id}/${name}`,file,{upsert:false,contentType:type});if(error)throw new Error(error.message);
    }
    return rpc<string>('submit_design_delivery',{p_order_id:orderId,p_revision_id:id,p_mode:input.mode,p_execution_url:input.mode==='link'?url:null,p_without_preview_reason:input.html?'':input.reason.trim()});
}
export const decideDesignRevision=(revisionId:string,action:'approved'|'rejected'|'bypassed',note:string)=>rpc<string>('decide_design_revision',{p_revision_id:revisionId,p_event_id:crypto.randomUUID(),p_action:action,p_note:note});
export const releaseDesignRevision=(orderId:string)=>rpc<void>('release_design_revision',{p_order_id:orderId});
export const returnDesignRevision=(orderId:string,designerId:string,note:string)=>rpc<void>('return_design_revision',{p_order_id:orderId,p_designer_id:designerId,p_note:note});
export const reassignDesignRevision=(orderId:string,designerId:string,note:string,oldAmount:number,newAmount:number|null)=>rpc<void>('reassign_design_revision',{p_order_id:orderId,p_designer_id:designerId,p_note:note,p_old_amount:oldAmount,p_new_amount:newAmount,p_command_id:crypto.randomUUID()});
export async function getDesignAssetUrl(path:string):Promise<string> {
    const {data,error}=await supabase.storage.from('design-qc-files').createSignedUrl(path,60);
    if(error) throw new Error(error.message);
    return data.signedUrl;
}
export async function designExecutionUrl(orderId:string,legacyUrl?:string|null,stageId?:string):Promise<string> {
    const asset=await rpc<{path:string|null;url:string|null}|null>('get_design_delivery_asset',{p_order_id:orderId,p_stage_id:stageId??null});
    if(asset?.path)return getDesignAssetUrl(asset.path);
    if(asset){if(!asset.url||!/^https:\/\//i.test(asset.url))throw new Error('رابط التنفيذ غير متاح');return asset.url;}
    return ensureAbsoluteUrl(legacyUrl);
}
export async function openDesignExecution(orderId:string,legacyUrl?:string|null,stageId?:string):Promise<void> {
    const url=await designExecutionUrl(orderId,legacyUrl,stageId);
    if(!/^https?:\/\//i.test(url)) throw new Error('رابط التنفيذ غير متاح');
    window.open(url,'_blank','noopener,noreferrer');
}
export async function getQcCompensations():Promise<QcCompensation[]> {
    const {data,error}=await supabase.rpc('get_design_qc_compensations');
    if(error?.code==='PGRST202') return []; // additive reader before schema deployment
    if(error) throw new Error(error.message);
    return (data||[]) as QcCompensation[];
}
