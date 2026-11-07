import {useCallback,useEffect,useRef,useState} from 'react';
import {FileCheck2,Download,Eye,Check,RotateCcw,History,ChevronDown,AlertTriangle,UserRoundCog} from 'lucide-react';
import {OrderDesignInstructions} from './SupplierDesignInstructions';
import {useAuth} from '../../context/AuthContext';
import {db,type Order} from '../../services/db';
import {isolatedDesignHtml} from '../../lib/designPreview';
import {getDesignQcState,getDesignQcOptions,approveAndReleaseDesignRevision,resolveDesignQcReview,getDesignAssetUrl,designExecutionUrl,type DesignQcState,type DesignOption} from '../../services/supabase/designQc';
const actions:Record<string,string>={submitted:'تسليم تصميم',approved:'موافقة',rejected:'رفض',bypassed:'تجاوز للمراجعة لاحقًا',returned:'إعادة للتصميم',legacy_changed:'تغيير رابط أثناء الإيقاف'};
const box='rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900';
const button='inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 disabled:cursor-default disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const field='mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
export default function DesignQCPanel({orderId,onChanged,revisionId}:{orderId:string;onChanged?:()=>void;revisionId?:string|null}){
 const {user}=useAuth();
 const [reviewAction,setReviewAction]=useState<'changes'|'reject'|null>(null);
 const [state,setState]=useState<DesignQcState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 const [preview,setPreview]=useState(''),[options,setOptions]=useState<DesignOption[]>([]),[designer,setDesigner]=useState(''),[currentDesigner,setCurrentDesigner]=useState(''),[oldFee,setOldFee]=useState(''),[newFee,setNewFee]=useState('');
 const [productionStatus,setProductionStatus]=useState<Order['productionStatus']>();
 const staff=user?.role==='admin';
 const loadedRevision=useRef<string|null>(null),loadSequence=useRef(0);
 const load=useCallback(async()=>{
  const sequence=++loadSequence.current;
  const data=await getDesignQcState(orderId);
  const extras=staff?await Promise.all([getDesignQcOptions(orderId),db.getOrder(orderId)]):null;
  if(sequence!==loadSequence.current)return;
  setPreview('');
  if(loadedRevision.current!==data.currentRevisionId){setNote('');setOldFee('');setNewFee('');setReviewAction(null);}
  loadedRevision.current=data.currentRevisionId;setState(data);
  if(extras){const [opts,order]=extras;setOptions(opts);setProductionStatus(order?.productionStatus);setCurrentDesigner(order?.designerId||'');setDesigner(order?.designerId||'');}
 },[orderId,staff]);
 useEffect(()=>{let active=true;void load().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[load,revisionId]);
 async function run(task:()=>Promise<unknown>,refresh=true){setBusy(true);setError('');try{await task();if(refresh){await load();setReviewAction(null);setNote('');onChanged?.();}}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const current=state?.revisions.find(r=>r.id===state.currentRevisionId);
 const selectedDesigner=options.find(option=>option.id===designer);
 const decision=state?.events.find(e=>e.revision_id===current?.id&&(['approved','rejected','bypassed'].includes(e.action)||(productionStatus==='designing'&&e.action==='returned')));
 return <section className="min-w-0 space-y-5" aria-label="ملفات التصميم وDesign QC">
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {!state?<p className="p-5 text-sm text-slate-500">جاري تحميل التصميم…</p>:<>
   <p className="text-xs leading-6 text-slate-600 dark:text-slate-300">{state.enabled?'المراجعة مفعّلة للتسليمات الجديدة':'المراجعة موقوفة حتى يعيد الأدمن تشغيلها'} · {decision?.action==='returned'?'بانتظار تسليم التصميم المعدّل':decision?.action==='approved'?'تمت مراجعة التصميم':state.required?'هذا التسليم خاضع للمراجعة':'هذا التسليم محفوظ دون مراجعة إلزامية'}</p>
   {decision?.needs_followup&&<p role="status" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle size={20} className="shrink-0"/>رفض بعد تجاوز: مطلوب متابعة المنسق. لم يتم إيقاف الإنتاج تلقائيًا.</p>}

   {current&&<article className={`${box} overflow-hidden`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800"><div className="flex items-center gap-3"><span className="rounded-xl bg-cyan-50 p-2.5 text-cyan-700 dark:bg-cyan-950"><FileCheck2 size={22}/></span><div><h3 className="font-bold text-slate-900 dark:text-slate-100">آخر تصميم مُسلَّم</h3><p className="mt-1 text-xs text-slate-500">التسليم رقم {current.revision_no} · {current.execution_path?'ملف ZIP':'رابط الملفات'} · رُفع في {new Date(current.submitted_at).toLocaleString('ar-EG')}</p></div></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${decision?.action==='approved'?'bg-emerald-50 text-emerald-800':decision?.action==='rejected'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-900'}`}>{decision?actions[decision.action]:state.required?'بانتظار المراجعة':'محفوظ دون مراجعة إلزامية'}</span></div>
    <div className="flex flex-wrap gap-2 p-5"><button type="button" className={button} disabled={busy} onClick={()=>void run(async()=>{window.open(await designExecutionUrl(orderId),'_blank','noopener,noreferrer');},false)}><Download size={17}/>{current.execution_path?'تحميل نسخة التنفيذ الثابتة':'فتح رابط التنفيذ'}</button>{current.preview_path?<button type="button" className={button} disabled={busy} onClick={()=>void run(async()=>{const response=await fetch(await getDesignAssetUrl(current.preview_path!),{credentials:'omit',cache:'no-store'});if(!response.ok)throw new Error('تعذر قراءة المعاينة');setPreview(isolatedDesignHtml(await response.text()));},false)}><Eye size={17}/>فتح المعاينة المعزولة</button>:<span className="self-center px-2 text-xs text-slate-500">بدون معاينة HTML · {current.without_preview_reason}</span>}</div>
    {staff&&decision?.action!=='returned'&&<div className="space-y-4 border-t border-slate-100 p-5 dark:border-slate-800">
     <div className="flex flex-wrap gap-2" aria-label="قرار المراجعة">
      {(decision?.action!=='approved'||productionStatus==='designing')&&<button type="button" disabled={busy} className={`${button} !border-emerald-200 !bg-emerald-50 !text-emerald-800`} onClick={()=>void run(()=>approveAndReleaseDesignRevision(current.id,''))}><Check size={17}/>موافقة</button>}
      <button type="button" aria-expanded={reviewAction==='changes'} disabled={busy} className={button} onClick={()=>{setReviewAction('changes');setNote('');}}><RotateCcw size={16}/>طلب تعديل</button>
      <button type="button" aria-expanded={reviewAction==='reject'} disabled={busy} className={`${button} !border-red-200 !text-red-700 dark:!text-red-300`} onClick={()=>{setReviewAction('reject');setNote('');}}>رفض</button>
     </div>
     {reviewAction&&<div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
       {reviewAction==='changes'?'التعديل المطلوب':'سبب الرفض'}
       <textarea className={field} rows={3} value={note} onChange={e=>setNote(e.target.value)}/>
      </label>
      <div className="flex flex-wrap gap-2">
       <button type="button" disabled={busy||!note.trim()} className={button} onClick={()=>void run(()=>resolveDesignQcReview(current.id,reviewAction,note,'current'))}>إعادة للمصمم الحالي</button>
       {reviewAction==='reject'&&<button type="button" disabled={busy||!note.trim()} className={button} onClick={()=>void run(()=>resolveDesignQcReview(current.id,reviewAction,note,'none'))}>تسجيل الرفض فقط</button>}
       <button type="button" disabled={busy} className={button} onClick={()=>{setReviewAction(null);setNote('');}}>إلغاء</button>
      </div>
      <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
       <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><UserRoundCog size={18}/>إعادة تكليف مصمم آخر<ChevronDown size={15} className="ms-auto"/></summary>
       <div className="mt-4 space-y-4">
        <label className="block text-sm">المصمم البديل<select className={field} value={designer} onChange={e=>{setDesigner(e.target.value);setNewFee('');}}><option value={currentDesigner}>اختر المصمم البديل</option>{options.filter(o=>o.id!==currentDesigner).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2">
         <label className="block text-sm">المستحق النهائي للمصمم السابق (ج.م)<input type="number" min="0" step="0.01" className={field} value={oldFee} onChange={e=>setOldFee(e.target.value)}/></label>
         <label className="block text-sm">تعديل أجر البديل (اختياري)<input type="number" min="0" step="0.01" className={field} value={newFee} onChange={e=>setNewFee(e.target.value)}/></label>
        </div>
        {selectedDesigner&&designer!==currentDesigner&&<p className="text-xs leading-6">الأجر الافتراضي للبديل: {selectedDesigner.price} ج.م {selectedDesigner.salaried?'· راتب ثابت':''}</p>}
        <button type="button" disabled={busy||!note.trim()||oldFee===''||Number(oldFee)<0||Number(newFee)<0||!designer||designer===currentDesigner} className={button} onClick={()=>void run(()=>resolveDesignQcReview(current.id,reviewAction,note,'replacement',{id:designer,oldAmount:Number(oldFee),newAmount:newFee===''?null:Number(newFee)}))}>تأكيد التسوية وإعادة التكليف</button>
       </div>
      </details>
     </div>}
    </div>}
   </article>}
   {!current&&<p className={`${box} p-4 text-sm text-slate-600`}>في انتظار أول تسليم من المصمم.</p>}
   <details className={`${box} px-4`}>
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">التعليمات الفنية<ChevronDown size={15} className="ms-auto"/></summary>
    <div className="grid gap-3 pb-4 xl:grid-cols-2"><OrderDesignInstructions orderId={orderId}/>{current&&<OrderDesignInstructions orderId={orderId} revisionId={current.id}/>}</div>
   </details>
   <details className={`${box} p-4`}><summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><History size={17}/>سجل النسخ والقرارات ({state.revisions.length})<ChevronDown size={15} className="ms-auto"/></summary><div className="mt-3 space-y-4">{state.revisions.map(r=><article key={r.id} className="border-t border-slate-100 pt-4 text-sm dark:border-slate-800"><div className="flex flex-wrap justify-between gap-2 text-slate-800 dark:text-slate-100"><strong>نسخة {r.revision_no}</strong><time className="text-xs text-slate-500">{new Date(r.submitted_at).toLocaleString('ar-EG')}</time></div>{r.without_preview_reason&&<p className="mt-2 text-xs text-slate-500">{r.without_preview_reason}</p>}{state.events.filter(e=>e.revision_id===r.id).map(e=><p key={e.id} className="mt-2 break-words rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{actions[e.action]||e.action} · {e.actor_name||e.actor_role} · {new Date(e.created_at).toLocaleString('ar-EG')}{e.note&&` · ${e.note}`}</p>)}</article>)}</div></details>
  </>}
  {preview&&<div role="dialog" aria-modal="true" aria-label="معاينة التصميم" className="fixed inset-0 z-50 flex flex-col bg-white p-4 dark:bg-slate-900"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600 dark:text-slate-300">معاينة التصميم · المحتوى الخارجي محجوب</p><button type="button" className={button} onClick={()=>setPreview('')}>إغلاق المعاينة</button></div><iframe title="معاينة التصميم المعزولة" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview} className="min-h-0 w-full flex-1 rounded-xl border"/></div>}
 </section>;
}
