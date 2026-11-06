import DesignFileDrop from './DesignFileDrop';
import {useState} from 'react';
import {Link2,Upload,LoaderCircle} from 'lucide-react';
import {submitDesignDelivery} from '../../services/supabase/designQc';

const field='mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
export default function DesignDeliveryForm({orderId,onSubmitted}:{orderId:string;onSubmitted?:()=>void|Promise<void>}){
 const [mode,setMode]=useState<'link'|'file'>('link'),[url,setUrl]=useState(''),[execution,setExecution]=useState<File|null>(null),[html,setHtml]=useState<File|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [skipHtml,setSkipHtml]=useState(false);
 async function submit(){setBusy(true);setError('');try{await submitDesignDelivery(orderId,{mode,url:mode==='link'?url:'',execution:mode==='file'?execution:null,html:skipHtml?null:html,reason:skipHtml?reason:''});await onSubmitted?.();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <form className="space-y-5" onSubmit={e=>{e.preventDefault();void submit();}} aria-label="تسليم التصميم">
  <div><h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">تسليم نسخة جديدة</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">اختر طريقة واحدة لإرسال ملفات التنفيذ.</p></div>
  <div role="tablist" aria-label="طريقة تسليم التصميم" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
   {([{value:'link',label:'رابط التصميم',Icon:Link2},{value:'file',label:'رفع ملف',Icon:Upload}] as const).map(({value,label,Icon})=><button type="button" role="tab" aria-selected={mode===value} key={value} disabled={busy} onClick={()=>{setMode(value);setError('');}} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${mode===value?'bg-white text-cyan-800 shadow-sm dark:bg-slate-700 dark:text-cyan-200':'text-slate-600 hover:text-slate-900 dark:text-slate-300'}`}><Icon size={17}/>{label}</button>)}
  </div>
  {mode==='link'?<label className="block text-sm font-medium text-slate-700 dark:text-slate-200">رابط ملفات التصميم<input aria-label="رابط ملفات التصميم" type="url" required dir="ltr" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://drive.google.com/…" className={field}/><span className="mt-2 block text-xs leading-5 text-slate-600 dark:text-slate-300">رابط Drive أو خدمة مشاركة الملفات. عند تعديل التصميم سلّم نسخة جديدة هنا؛ محتوى الرابط الخارجي لا يُحفظ داخل النظام.</span></label>:
   <DesignFileDrop label="ملف التنفيذ ZIP" file={execution} kind="zip" disabled={busy} onChange={setExecution} onError={setError}/>}

  <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">معاينة التصميم HTML</legend>
   {!skipHtml&&<DesignFileDrop label="ملف معاينة HTML" file={html} kind="html" disabled={busy} onChange={setHtml} onError={setError}/> }
   <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={skipHtml} onChange={e=>setSkipHtml(e.target.checked)} className="h-4 w-4 accent-cyan-700"/>تخطي رفع HTML مع كتابة السبب</label>
   {skipHtml&&<label className="block text-sm font-medium text-slate-700 dark:text-slate-200">سبب التسليم بدون معاينة<input required value={reason} onChange={e=>setReason(e.target.value)} placeholder="مثال: المعاينة غير متاحة من برنامج التصميم" className={field}/></label>}
  </fieldset>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
  <button disabled={busy} className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">{busy?<LoaderCircle size={18} className="animate-spin motion-reduce:animate-none"/>:<Upload size={18}/>} {busy?'جاري حفظ التصميم…':'حفظ نسخة التصميم'}</button>
 </form>;
}
