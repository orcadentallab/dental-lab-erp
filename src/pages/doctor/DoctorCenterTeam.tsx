import { useEffect, useState } from 'react';
import { doctorPortalService, type PortalContext } from '../../services/doctorPortalService';
import { doctorPasswordService } from '../../services/auth/doctorPasswordService';
export default function DoctorCenterTeam() {
    const [context, setContext] = useState<PortalContext | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [link, setLink] = useState('');
    useEffect(() => { doctorPortalService.context().then(setContext).catch(cause => setError(cause.message)); }, []);
    return <div className="space-y-4"><h1 className="text-2xl font-bold">أطباء المركز</h1><p className="text-sm text-slate-500">ابعت لكل طبيب دعوته لربط حسابه بسجله داخل المركز. الطبيب يشوف حالاته وحساب حالاته فقط.</p>{error && <p role="alert">{error}</p>}
        {link && <label className="block">رابط دعوة الطبيب<input aria-label="رابط دعوة الطبيب" readOnly dir="ltr" className="block border rounded-xl p-3 w-full" value={link} onFocus={event => event.target.select()} /><button type="button" className="text-blue-600 p-3" onClick={async () => { try { await navigator.clipboard.writeText(link); } catch { setError('حدد الرابط وانسخه لإرساله للطبيب'); } }}>نسخ الرابط</button></label>}
        {context && !context.is_center && <p>هذه الصفحة متاحة لحساب المركز.</p>}
        {context?.is_center && context.members.filter(member => member.id !== context.doctor_id).map(member => <div key={member.id} className="bg-white dark:bg-slate-800 border rounded-xl p-4 space-y-2"><p className="font-bold">{member.name}</p><p dir="ltr">{member.phone} — {member.doctor_code}</p>{member.has_account ? <p className="text-emerald-600">الحساب مرتبط</p> : <button type="button" disabled={!!busy} className="bg-blue-600 text-white px-4 py-3 rounded-xl" onClick={async () => { setBusy(member.id); setError(''); try { const result = await doctorPasswordService.createInvitation(member.id); setLink(result.url); } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر إصدار الدعوة'); } finally { setBusy(''); } }}>{busy === member.id ? 'جاري تجهيز الدعوة…' : 'دعوة الطبيب'}</button>}</div>)}
        <p className="text-sm text-slate-500">لإضافة طبيب له سجل قديم إلى المركز، ابعت بياناته للمعمل لربط السجل الصحيح.</p>
    </div>;
}
