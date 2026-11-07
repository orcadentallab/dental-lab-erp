import {useEffect,useState} from 'react';
import {FileText,History,Save,ChevronDown,LoaderCircle} from 'lucide-react';
import {supabase} from '../../lib/supabase';

type Instruction={id?:string;version?:number;version_no?:number;paragraph:string;created_at?:string};
const card='rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900';
export function OrderDesignInstructions({orderId,revisionId}:{orderId:string;revisionId?:string}){
 const key=`${orderId}/${revisionId??'current'}`;
 const [loaded,setLoaded]=useState<{key:string;row:Instruction|null;error:string}|null>(null);
 const row=loaded?.key===key?loaded.row:null,error=loaded?.key===key?loaded.error:'';
 useEffect(()=>{let active=true;const requestKey=`${orderId}/${revisionId??'current'}`;void supabase.rpc('get_order_design_instruction',{p_order_id:orderId,p_revision_id:revisionId??null}).then(({data,error})=>{if(active)setLoaded({key:requestKey,row:data,error:error?.message??''});});return()=>{active=false;};},[orderId,revisionId]);
 return <aside className={`${card} p-4`} aria-label={revisionId?'التعليمات الفنية عند التسليم':'التعليمات الفنية الحالية'}>
  <div className="mb-3 flex items-center gap-2"><span className="rounded-lg bg-cyan-50 p-2 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200"><FileText size={17}/></span><h3 className="flex-1 text-sm font-bold text-slate-800 dark:text-slate-100">{revisionId?'التعليمات الفنية عند التسليم':'التعليمات الفنية الحالية'}</h3>{row?.version&&<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">نسخة {row.version}</span>}</div>
  {error?<p role="alert" className="text-sm text-red-700">{error}</p>:!row?<p className="text-sm text-slate-500">جاري تحميل التعليمات…</p>:<p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-200">{row.paragraph||'لا توجد تعليمات فنية مسجلة.'}</p>}
 </aside>;
}
export default function SupplierDesignInstructions({supplierId}:{supplierId:string}){
 const [rows,setRows]=useState<Instruction[]>([]),[paragraph,setParagraph]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[loadedSupplier,setLoadedSupplier]=useState<string|null>(null);
 useEffect(()=>{let active=true;void supabase.rpc('get_supplier_design_instructions',{p_supplier_id:supplierId}).then(({data,error})=>{if(!active)return;if(error)setError(error.message);else{setRows(data??[]);setParagraph(data?.[0]?.paragraph??'');setLoadedSupplier(supplierId);}});return()=>{active=false;};},[supplierId]);
 async function save(){setBusy(true);setError('');setSaved(false);try{
  const {error}=await supabase.rpc('save_supplier_design_text',{p_supplier_id:supplierId,p_version_id:crypto.randomUUID(),p_paragraph:paragraph});if(error)throw new Error(error.message);
  const result=await supabase.rpc('get_supplier_design_instructions',{p_supplier_id:supplierId});if(result.error)throw new Error(result.error.message);setRows(result.data??[]);setParagraph(result.data?.[0]?.paragraph??'');setSaved(true);
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 const ready=loadedSupplier===supplierId;
 const changed=paragraph.trim()!==(rows[0]?.paragraph??'').trim();
 return <section className={`${card} overflow-hidden`}>
  <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-800"><div className="flex items-center gap-2"><FileText size={19} className="text-cyan-700"/><h3 className="font-bold text-slate-900 dark:text-slate-100">التعليمات الفنية للمصمم</h3></div><p className="mt-2 text-xs leading-6 text-slate-600 dark:text-slate-300">التعديلات تُحفظ كنسخ جديدة؛ كل تصميم يحتفظ بالتعليمات التي سُلّم عليها.</p></div>
  <div className="space-y-3 p-4"><label className="block"><span className="sr-only">التعليمات الفنية للمصمم</span><textarea aria-label="التعليمات الفنية للمصمم" className="block w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-7 text-slate-800 outline-none transition-colors focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" rows={4} disabled={!ready||busy} value={paragraph} onChange={e=>{setParagraph(e.target.value);setSaved(false);}} placeholder="اكتب التعليمات الفنية التي يحتاجها المصمم…"/></label>
   {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-500">{!ready?'جاري تحميل التعليمات…':saved?'تم حفظ التعليمات':rows.length?`النسخة الحالية ${rows[0].version_no}`:'لم تُسجل تعليمات بعد'}</span><button type="button" className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-cyan-800 focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50" disabled={!ready||busy||!changed||!paragraph.trim()} onClick={()=>void save()}>{busy?<LoaderCircle size={16} className="animate-spin motion-reduce:animate-none"/>:<Save size={16}/>}حفظ التعليمات</button></div>
  </div>
  {rows.length>0&&<details className="border-t border-slate-100 px-4 py-3 dark:border-slate-800"><summary className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300"><History size={16}/>سجل التعليمات ({rows.length})<ChevronDown size={15} className="ms-auto"/></summary><div className="mt-2 space-y-3">{rows.map(r=><article key={r.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><div className="mb-2 flex justify-between gap-2 text-xs text-slate-500"><strong>نسخة {r.version_no}</strong>{r.created_at&&<time>{new Date(r.created_at).toLocaleDateString('ar-EG')}</time>}</div><p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-200">{r.paragraph}</p></article>)}</div></details>}
 </section>;
}
