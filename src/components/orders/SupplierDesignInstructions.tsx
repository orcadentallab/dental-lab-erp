import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
type Instruction={id?:string;version?:number;version_no?:number;status:string;paragraph:string;files:string[];source_reference?:string};
async function readInstruction(orderId:string,revisionId?:string):Promise<Instruction>{
 const {data,error}=await supabase.rpc('get_order_design_instruction',{p_order_id:orderId,p_revision_id:revisionId??null});if(error)throw new Error(error.message);return data;
}
async function openAttachment(path:string){const {data,error}=await supabase.storage.from('design-instructions').createSignedUrl(path,60);if(error)throw new Error(error.message);window.open(data.signedUrl,'_blank','noopener,noreferrer');}
const statuses:Record<string,string>={approved:'معتمد',experimental:'تجريبي',stopped:'متوقف',missing:'غير متاح'};
export function OrderDesignInstructions({orderId,revisionId}:{orderId:string;revisionId?:string}){
 const key=`${orderId}/${revisionId??'current'}`;
 const [loaded,setLoaded]=useState<{key:string;row:Instruction|null;error:string}|null>(null);
 const row=loaded?.key===key?loaded.row:null,error=loaded?.key===key?loaded.error:'';
 const setError=(message:string)=>setLoaded({key,row,error:message});
 useEffect(()=>{let active=true;const requestKey=`${orderId}/${revisionId??'current'}`;void readInstruction(orderId,revisionId).then(row=>{if(active)setLoaded({key:requestKey,row,error:''});}).catch(e=>{if(active)setLoaded({key:requestKey,row:null,error:e.message});});return()=>{active=false;};},[orderId,revisionId]);
 return <aside className="rounded-xl border border-cyan-100 bg-cyan-50/40 p-3 space-y-2" aria-label={revisionId?'التعليمات الفنية عند التسليم':'التعليمات الفنية الحالية'}><h3 className="font-semibold text-sm">{revisionId?'التعليمات الفنية عند التسليم':'التعليمات الفنية الحالية'}</h3>{error?<p role="alert" className="text-red-700">{error}</p>:!row?<p>جاري التحميل…</p>:<><p className="text-xs">{statuses[row.status]} {row.version?`· نسخة ${row.version}`:''}</p>{row.status==='missing'||row.status==='stopped'?<p className="text-sm">لا توجد تعليمات فنية سارية. لا يمنع ذلك تسليم الملفات؛ راجع المنسق عند الحاجة.</p>:<><p className="whitespace-pre-wrap text-sm">{row.paragraph}</p>{row.files.map((path,i)=><button type="button" key={path} className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={()=>void openAttachment(path).catch(e=>setError(e.message))}>مرفق فني {i+1}</button>)}</>}</>}</aside>;
}
export default function SupplierDesignInstructions({supplierId}:{supplierId:string}){
 const [rows,setRows]=useState<Instruction[]>([]),[paragraph,setParagraph]=useState(''),[source,setSource]=useState(''),[status,setStatus]=useState('experimental'),[files,setFiles]=useState<File[]>([]),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){const {data,error}=await supabase.rpc('get_supplier_design_instructions',{p_supplier_id:supplierId});if(error)throw new Error(error.message);setRows(data ?? []);}
 useEffect(()=>{void supabase.rpc('get_supplier_design_instructions',{p_supplier_id:supplierId}).then(({data,error})=>{if(error)setError(error.message);else setRows(data ?? []);});},[supplierId]);
 async function save(){setBusy(true);setError('');try{
  if(!reviewed)throw new Error('راجع النص والمرفقات للتأكد من إخفاء هوية المورد أولًا.');
  if(!paragraph.trim())throw new Error('اكتب الفقرة الفنية.');
  if(files.length>10)throw new Error('الحد الأقصى 10 مرفقات.');
  const version=crypto.randomUUID(),paths:string[]=[];
  for(const file of files){const ext:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'};if(!ext[file.type]||file.size<1||file.size>15*1024*1024)throw new Error('المرفق PDF أو PNG أو JPEG حتى 15 ميجا.');const path=`${supplierId}/${version}/${crypto.randomUUID()}.${ext[file.type]}`;const {error}=await supabase.storage.from('design-instructions').upload(path,new Blob([file],{type:file.type}),{contentType:file.type,upsert:false});if(error)throw new Error(error.message);paths.push(path);}
  const {error}=await supabase.rpc('save_supplier_design_instruction',{p_supplier_id:supplierId,p_version_id:version,p_paragraph:paragraph,p_source:source,p_status:status,p_files:paths,p_privacy_confirmed:reviewed});if(error)throw new Error(error.message);setReviewed(false);setFiles([]);await load();
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <section className="space-y-3 rounded-xl border border-cyan-200 bg-white p-4"><h3 className="font-bold">تعليمات التصميم الفنية — نسخ محفوظة</h3><p className="text-xs text-slate-600">فقرة واحدة للمورد. المصمم يرى النص والمرفقات الفنية فقط؛ المصدر وهوية المورد للأدمن. تعديل التعليمات لا يلغي موافقة ملفات التصميم.</p>{error&&<p role="alert" className="text-red-700">{error}</p>}
 <label className="block text-sm">الفقرة الفنية للمصمم<textarea aria-label="الفقرة الفنية للمصمم" className="mt-1 block w-full rounded border p-2" rows={4} value={paragraph} onChange={e=>setParagraph(e.target.value)}/></label>
 <label className="block text-sm">مرجع المصدر الخاص بالأدمن<input className="mt-1 block w-full rounded border p-2" value={source} onChange={e=>setSource(e.target.value)} placeholder="رابط المستند أو مرجعه"/></label>
 <label className="block text-sm">حالة التعليمات<select className="mx-2 rounded border p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="experimental">تجريبي</option><option value="approved">معتمد</option><option value="stopped">متوقف</option></select></label>
 <label className="block text-sm">مرفقات فنية منزوعة هوية المورد<input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm" onChange={e=>setFiles(Array.from(e.target.files??[]))}/></label>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>راجعت النص ومحتوى المرفقات: لا أسماء أو شعارات أو بيانات اتصال تكشف هوية المورد للمصمم.</label>
 <button type="button" className="rounded-lg bg-cyan-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy||!reviewed} onClick={()=>void save()}>{busy?'جاري الحفظ…':'حفظ نسخة فنية جديدة'}</button>
 <details><summary>سجل التعليمات ({rows.length})</summary>{rows.map(r=><div key={r.id} className="border-t py-2 text-sm"><strong>نسخة {r.version_no} · {statuses[r.status]}</strong><p className="whitespace-pre-wrap">{r.paragraph}</p><p className="text-xs text-slate-500">المصدر الخاص: {r.source_reference||'لم يسجل'}</p>{r.files.map((path,i)=><button type="button" key={path} className="m-1 rounded border p-2" onClick={()=>void openAttachment(path).catch(e=>setError(e.message))}>مرفق {i+1}</button>)}</div>)}</details></section>;
}
