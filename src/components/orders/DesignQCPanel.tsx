import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
import {db} from '../../services/db';
import {isolatedDesignHtml} from '../../lib/designPreview';
import {getDesignQcState,getDesignQcOptions,submitDesignRevision,decideDesignRevision,releaseDesignRevision,returnDesignRevision,reassignDesignRevision,getDesignAssetUrl,type DesignQcState,type DesignOption} from '../../services/supabase/designQc';
const actions:Record<string,string>={submitted:'تسليم ملفات',approved:'موافقة',rejected:'رفض',bypassed:'تجاوز للمراجعة لاحقًا',returned:'إعادة للتصميم',legacy_changed:'تغيير رابط أثناء الإيقاف'};
export default function DesignQCPanel({orderId,onChanged}:{orderId:string;onChanged?:()=>void}) {
 const {user}=useAuth();
 const [state,setState]=useState<DesignQcState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [url,setUrl]=useState(''),[execution,setExecution]=useState<File|null>(null),[html,setHtml]=useState<File|null>(null),[exception,setException]=useState(''),[note,setNote]=useState('');
 const [preview,setPreview]=useState(''),[options,setOptions]=useState<DesignOption[]>([]),[designer,setDesigner]=useState(''),[currentDesigner,setCurrentDesigner]=useState(''),[oldFee,setOldFee]=useState(''),[newFee,setNewFee]=useState('');
 const staff=user?.role==='admin'||user?.role==='coordinator';
 const load=useCallback(async()=>{
    setPreview('');
    const data=await getDesignQcState(orderId);setState(data);
    if(staff){const [opts,order]=await Promise.all([getDesignQcOptions(orderId),db.getOrder(orderId)]);setOptions(opts);setCurrentDesigner(order?.designerId||'');setDesigner(order?.designerId||'');}
 },[orderId,staff]);
 useEffect(()=>{let active=true;void load().catch(e=>{if(active)setError(String(e.message));});return()=>{active=false;};},[load]);
 async function run(task:()=>Promise<unknown>,refresh=true){setBusy(true);setError('');try{await task();if(refresh){await load();onChanged?.();}}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const current=state?.revisions.find(r=>r.id===state.currentRevisionId);
 return <section className="space-y-4 rounded-xl border p-4 bg-white" aria-label="ملفات التصميم وDesign QC">
  <h2 className="font-bold">ملفات التصميم وDesign QC</h2>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {!state?<p>جاري تحميل المراجعة…</p>:<>
   <p className="text-sm">{state.enabled?'المراجعة مفعّلة للتسليمات الجديدة':'المراجعة موقوفة حتى يعيد الأدمن تشغيلها'} · {state.required?'هذه النسخة تحتاج قرارًا قبل التنفيذ':'لا توجد مراجعة مفروضة بأثر رجعي على هذه النسخة'}</p>
   {state.events.some(e=>e.needs_followup)&&<p role="status" className="bg-amber-50 p-3">رفض بعد تجاوز: مطلوب متابعة المنسق. لم يتم إيقاف الإنتاج تلقائيًا.</p>}
   <form className="space-y-2" onSubmit={e=>{e.preventDefault();if(execution)void run(()=>submitDesignRevision(orderId,url,execution,html,exception));}}>
    <h3 className="font-semibold">تسليم نسخة جديدة</h3>
    <label className="block">رابط حزمة التنفيذ الكاملة<input className="block border p-2 w-full" type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label>
    <label className="block">نسخة ZIP ثابتة من ملفات التنفيذ<input className="block" type="file" accept=".zip" required onChange={e=>setExecution(e.target.files?.[0]||null)}/></label>
    <p className="text-xs text-gray-600">نسخة الملفات المحفوظة هي مرجع التنفيذ المعتمد؛ تغيير محتوى الرابط الخارجي لا يستبدلها.</p>
    <label className="block">معاينة HTML مستقلة<input className="block" type="file" accept=".html,.htm" onChange={e=>setHtml(e.target.files?.[0]||null)}/></label>
    {!html&&<label className="block">سبب التسليم بدون معاينة<input className="block border p-2 w-full" required value={exception} onChange={e=>setException(e.target.value)}/></label>}
    <button className="border rounded p-2 bg-blue-50" disabled={busy||!execution}>حفظ نسخة الملفات</button>
   </form>
   {current&&<>
    <h3 className="font-semibold">النسخة الحالية {current.revision_no} {current.preview_path?'':'— بدون معاينة'}</h3>
    <button className="border rounded p-2" disabled={busy} onClick={()=>void run(async()=>{window.open(await getDesignAssetUrl(current.execution_path),'_blank','noopener,noreferrer');})}>تحميل نسخة التنفيذ الثابتة</button>
    {current.preview_path&&<button className="border rounded p-2" disabled={busy} onClick={()=>void run(async()=>{const response=await fetch(await getDesignAssetUrl(current.preview_path!),{credentials:'omit',cache:'no-store'});if(!response.ok)throw new Error('تعذر قراءة المعاينة');setPreview(isolatedDesignHtml(await response.text()));},false)}>فتح المعاينة المعزولة</button>}
    {staff&&<div className="space-y-2 border-t pt-3">
     <label className="block">ملاحظات القرار أو سبب التجاوز<textarea className="block border p-2 w-full" value={note} onChange={e=>setNote(e.target.value)}/></label>
     {user?.role==='admin'&&<><button disabled={busy} className="border p-2" onClick={()=>void run(()=>decideDesignRevision(current.id,'approved',note))}>موافقة على النسخة</button><button disabled={busy||!note.trim()} className="border p-2" onClick={()=>void run(()=>decideDesignRevision(current.id,'rejected',note))}>رفض النسخة</button></>}
     <button disabled={busy||!note.trim()} className="border p-2" onClick={()=>void run(()=>decideDesignRevision(current.id,'bypassed',note))}>تجاوز موثّق</button>
     <button disabled={busy} className="border p-2" onClick={()=>void run(()=>releaseDesignRevision(orderId))}>إرسال للتنفيذ</button>
     <p className="text-xs">الرفض يظل مسجّلًا؛ اختر صراحةً العودة للمصمم الحالي أو إعادة التكليف. رفض نسخة سبق تجاوزها ينبه المنسق ولا يوقف الإنتاج تلقائيًا.</p>
     <button disabled={busy||!note.trim()} className="border p-2" onClick={()=>void run(()=>returnDesignRevision(orderId,currentDesigner,note))}>إعادة للمصمم الحالي</button>
     {user?.role==='admin'&&<fieldset className="border rounded p-3 space-y-2"><legend>إعادة التكليف وتسوية التصميم السابق</legend>
      <label className="block">المصمم البديل<select aria-label="المصمم البديل" className="block border p-2" value={designer} onChange={e=>{setDesigner(e.target.value);setNewFee('');}}>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="block">المستحق النهائي للمصمم السابق (ج.م)<input type="number" min="0" step="0.01" className="block border p-2" value={oldFee} onChange={e=>setOldFee(e.target.value)}/></label>
      <p>الأجر الافتراضي للبديل: {options.find(o=>o.id===designer)?.price??0} ج.م {options.find(o=>o.id===designer)?.salaried?'— راتب ثابت؛ لا ينشأ استحقاق للحالة':''}</p>
      <label className="block">تعديل أجر البديل (اختياري)<input type="number" min="0" step="0.01" className="block border p-2" value={newFee} onChange={e=>setNewFee(e.target.value)}/></label>
      <p className="text-xs">المدفوع الزائد يُحفظ كرصيد مقدم مرتبط بحساب المصمم السابق؛ لا تتغير حركة النقد الأصلية.</p>
      <button disabled={busy||!note.trim()||oldFee===''||!designer||designer===currentDesigner} className="border p-2" onClick={()=>void run(()=>reassignDesignRevision(orderId,designer,note,Number(oldFee),newFee===''?null:Number(newFee)))}>تأكيد التسوية وإعادة التكليف</button>
     </fieldset>}
    </div>}
   </>}
   <details><summary>سجل النسخ والقرارات ({state.revisions.length})</summary>{state.revisions.map(r=><div key={r.id} className="border-t py-2"><strong>نسخة {r.revision_no}</strong> · {new Date(r.submitted_at).toLocaleString('ar-EG')} {r.preview_path?'':'· بدون معاينة'}{r.without_preview_reason&&<p>{r.without_preview_reason}</p>}{state.events.filter(e=>e.revision_id===r.id).map(e=><p key={e.id}>{actions[e.action]||e.action} · {e.actor_name||e.actor_role} · {new Date(e.created_at).toLocaleString('ar-EG')} · {e.note}</p>)}</div>)}</details>
  </>}
  {preview&&<div className="fixed inset-0 z-50 bg-white p-4 flex flex-col"><button onClick={()=>setPreview('')}>إغلاق المعاينة</button><p className="text-xs">معاينة HTML تجريبية مستقلة؛ الاعتماد الفني على عينة exocad الفعلية مطلوب. الملفات التابعة الخارجية محجوبة.</p><iframe title="معاينة التصميم المعزولة" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview} className="flex-1 w-full border"/></div>}
 </section>;
}
