import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doctorPortalService, type PortalMessage } from '../../services/doctorPortalService';
export default function DoctorSupport() {
    const [params] = useSearchParams(); const [messages, setMessages] = useState<PortalMessage[]>([]); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    useEffect(() => { doctorPortalService.messages().then(setMessages).catch(cause => setError(cause.message)); }, []);
    return <div className="space-y-5"><h1 className="text-2xl font-bold">تواصل مع المعمل</h1><p className="text-sm text-slate-500">اكتب استفسارك عن الحالة أو الحساب، ورد المعمل هيظهر هنا.</p>{error && <p role="alert" className="text-red-600">{error}</p>}
        <form className="space-y-3" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await doctorPortalService.send(body, params.get('case') || undefined); setBody(''); setMessages(await doctorPortalService.messages()); } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر الإرسال'); } finally { setBusy(false); } }}><label className="block">رسالتك للمعمل<textarea aria-label="رسالتك للمعمل" required maxLength={4000} className="block w-full p-3 border rounded-xl dark:bg-slate-800 mt-2" rows={4} value={body} onChange={event => setBody(event.target.value)} /></label><button disabled={busy} className="bg-blue-600 text-white px-5 py-3 rounded-xl">{busy ? 'جاري الإرسال…' : 'إرسال الرسالة'}</button></form>
        <button type="button" className="text-blue-600 p-3" onClick={() => doctorPortalService.messages().then(setMessages).catch(cause => setError(cause.message))}>تحديث الردود</button>
        {messages.map(message => <div key={message.id} className="bg-white dark:bg-slate-800 border rounded-xl p-4 space-y-3"><p className="text-xs text-slate-500">{message.case_id || 'استفسار عام'} — {new Date(message.created_at).toLocaleDateString('ar-EG')}</p><p className="whitespace-pre-wrap">{message.body}</p><p className="bg-blue-50 dark:bg-blue-950 p-3 rounded-xl whitespace-pre-wrap">{message.reply ? `رد المعمل: ${message.reply}` : 'رسالتك وصلت، وبانتظار رد المعمل.'}</p></div>)}
    </div>;
}
