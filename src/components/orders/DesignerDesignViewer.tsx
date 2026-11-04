import {useEffect,useState} from 'react';
import {Download,Eye,X,FileCheck2} from 'lucide-react';
import {getDesignQcState,getDesignAssetUrl,openDesignExecution,type DesignQcState} from '../../services/supabase/designQc';
import {isolatedDesignHtml} from '../../lib/designPreview';
import {OrderDesignInstructions} from './SupplierDesignInstructions';

export default function DesignerDesignViewer({orderId,caseId,legacyUrl,onClose}:{orderId:string;caseId:string;legacyUrl?:string|null;onClose:()=>void}){
 const [state,setState]=useState<DesignQcState|null>(null),[error,setError]=useState(''),[preview,setPreview]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;void getDesignQcState(orderId).then(data=>{if(active)setState(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[orderId]);
 const revision=state?.revisions.find(r=>r.id===state.currentRevisionId)??state?.revisions[0];
 async function open(){setBusy(true);setError('');try{
  if(!revision){await openDesignExecution(orderId,legacyUrl);return;}
  const fresh=await getDesignQcState(orderId),saved=fresh.revisions.find(r=>r.id===revision.id);if(!saved)throw new Error('التصميم لم يعد متاحًا.');
  const url=saved.execution_path?await getDesignAssetUrl(saved.execution_path):saved.execution_url;if(!url||!/^https?:\/\//i.test(url))throw new Error('ملفات التنفيذ غير متاحة');window.open(url,'_blank','noopener,noreferrer');
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 async function showPreview(){if(!revision?.preview_path)return;setBusy(true);setError('');try{const response=await fetch(await getDesignAssetUrl(revision.preview_path),{credentials:'omit',cache:'no-store'});if(!response.ok)throw new Error('تعذر فتح المعاينة');setPreview(isolatedDesignHtml(await response.text()));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const button='inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-cyan-600 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
  <section role="dialog" aria-modal="true" aria-label="التصميم المحفوظ" className="max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900" dir="rtl">
   <header className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileCheck2 size={21} className="text-cyan-700"/><div><h2 className="font-bold text-slate-900 dark:text-slate-100">التصميم المحفوظ</h2><p className="mt-1 text-xs text-slate-500">{caseId}{revision?` · نسخة ${revision.revision_no}`:''}</p></div></div><button type="button" aria-label="إغلاق التصميم" className={button} onClick={onClose}><X size={18}/></button></header>
   {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   {!state&&!error?<p className="text-sm text-slate-500">جاري تحميل التصميم…</p>:state&&<>
    {revision&&<OrderDesignInstructions orderId={orderId} revisionId={revision.id}/>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={()=>void open()}><Download size={17}/>{revision?.execution_path?'تحميل ملفات التصميم':'فتح رابط الملفات'}</button>{revision?.preview_path&&<button type="button" className={button} disabled={busy} onClick={()=>void showPreview()}><Eye size={17}/>عرض معاينة HTML</button>}</div>
    {revision&&!revision.preview_path&&<p className="rounded-xl bg-slate-50 p-3 text-sm leading-7 text-slate-600 dark:bg-slate-800 dark:text-slate-300">لم تُرفق معاينة HTML. السبب: {revision.without_preview_reason}</p>}
    {preview&&<iframe title="معاينة التصميم المحفوظة" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview} className="h-96 w-full rounded-xl border border-slate-200 bg-white"/>}
   </>}
  </section>
 </div>;
}
