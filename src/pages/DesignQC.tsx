import {useCallback,useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import DesignQCPanel from '../components/orders/DesignQCPanel';
import {getDesignQcEnabled,getDesignQcQueue,setDesignQcEnabled,type DesignQueueItem} from '../services/supabase/designQc';
const labels:Record<string,string>={pending:'بانتظار المراجعة',approved:'معتمد',rejected:'مرفوض — متابعة مطلوبة',bypassed:'تجاوز ينتظر مراجعة الأدمن'};
export default function DesignQC(){
 const {user}=useAuth(); const [params,setParams]=useSearchParams();
 const [queue,setQueue]=useState<DesignQueueItem[]>([]),[enabled,setEnabled]=useState<boolean|null>(null),[error,setError]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const [filter,setFilter]=useState('all');
 const load=useCallback(async()=>{const [q,on]=await Promise.all([getDesignQcQueue(),getDesignQcEnabled()]);setQueue(q);setEnabled(on);},[]);
 useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
 async function toggle(){setBusy(true);setError('');try{await setDesignQcEnabled(!enabled,reason);setReason('');await load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <main className="max-w-5xl mx-auto space-y-4 p-4" dir="rtl"><h1 className="text-2xl font-bold">ملفات التصميم وDesign QC</h1>
 {error&&<p role="alert" className="text-red-700">{error}</p>}
 <section className="rounded-xl border bg-white p-4 space-y-2"><p role="status">{enabled===null?'جاري قراءة حالة المراجعة…':enabled?'Design QC مفعّل':'Design QC موقوف حتى يعيد الأدمن تشغيله'}</p>
 <p className="text-sm">تغيير الحالة لا يمحو المراجعات أو يعتمد تصميمًا تلقائيًا. يبدأ الإلزام مع أول تسليم ملفات جديد بعد التفعيل؛ النسخ التي سُلّمت أثناء الإيقاف لا تُراجع بأثر رجعي.</p>
 {user?.role==='admin'&&<><label className="block">سبب تشغيل أو إيقاف المراجعة<input className="block border p-2 w-full" value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="border rounded p-2 bg-blue-50" disabled={busy||enabled===null||!reason.trim()} onClick={()=>void toggle()}>{enabled?'إيقاف Design QC حتى تشغيله مرة أخرى':'تشغيل Design QC'}</button></>}
 </section>
 <button className="border p-2 rounded" onClick={()=>void load().catch(e=>setError(e.message))}>تحديث القائمة</button>
 <label>عرض<select className="border p-2 mx-2" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">كل الحالات المصرح بها</option><option value="pending">بانتظار المراجعة</option><option value="bypassed">التجاوزات — بما فيها تجاوزات الأدمن</option><option value="rejected">الرفض ومتابعة المنسق</option></select></label>
 <div className="flex gap-2 flex-wrap">{queue.filter(q=>filter==='all'||q.state===filter).map(q=><button className="border rounded p-2 bg-white" key={q.id} onClick={()=>setParams({order:q.id})}>{q.caseId} · {q.revisionId?labels[q.state]:'لا توجد نسخة جديدة'}</button>)}</div>
 {params.get('order')&&<DesignQCPanel key={params.get('order')} orderId={params.get('order')!} onChanged={()=>void load()}/>}
 </main>;
}
