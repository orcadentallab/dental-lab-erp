import { useState, type FormEvent } from 'react';
import { doctorManualAccessService, getSavedDoctorRequest } from '../../services/auth/doctorManualAccessService';
import NewDoctorRegistration from './NewDoctorRegistration';

export default function DoctorManualAccess() {
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [intent, setIntent] = useState<'existing' | 'new'>('existing');
    const [registration, setRegistration] = useState(false);
    const [saved, setSaved] = useState(() => !!getSavedDoctorRequest());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const submitted = () => {
        setRegistration(false);
        setSaved(true);
        setMessage('تم إرسال طلبك. المعمل سيراجع البيانات قبل تفعيل الحساب. ارجع من نفس الجهاز لمتابعة الطلب.');
    };
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setError(''); setMessage('');
        if (intent === 'new') { setRegistration(true); return; }
        setBusy(true);
        try {
            const result = await doctorManualAccessService.submit(phone, intent, code);
            if (result.success) submitted();
            else setError(result.message || 'تعذر إرسال الطلب');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر إرسال الطلب. تحقق من الاتصال.'); }
        finally { setBusy(false); }
    };
    const open = async () => {
        if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const result = await doctorManualAccessService.open();
            if (!result.success) setError(result.message || 'تعذر فتح الحساب');
            else setMessage(result.status === 'pending' ? 'طلبك قيد مراجعة المعمل.'
                : result.status === 'rejected' ? 'لم يتم اعتماد طلبك. تواصل مع المعمل لمراجعة البيانات.' : 'تم اعتماد حسابك. جاري الدخول…');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر متابعة الطلب.'); }
        finally { setBusy(false); }
    };
    return <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">التسجيل متاح حاليًا بدون كود واتساب. المعمل يراجع التسجيل والربط قبل فتح الحساب.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        {saved && <button type="button" disabled={busy} onClick={open} className="w-full p-3 rounded-xl bg-emerald-600 text-white disabled:opacity-50">متابعة طلبي / الدخول بعد الاعتماد</button>}
        <form onSubmit={submit} className="space-y-4">
            <fieldset className="space-y-2 text-sm">
                <legend className="font-bold mb-2">هل تعاملت مع معمل ORCA قبل كده؟</legend>
                <label className="flex gap-2"><input type="radio" name="manualIntent" checked={intent === 'existing'} onChange={() => setIntent('existing')} />نعم، أريد ربط حسابي الموجود</label>
                <label className="flex gap-2"><input type="radio" name="manualIntent" checked={intent === 'new'} onChange={() => setIntent('new')} />لا، أول تعامل — تسجيل طبيب جديد</label>
            </fieldset>
            <label className="block text-sm">رقم الموبايل
                <input aria-label="رقم الموبايل" type="tel" required dir="ltr" value={phone} onChange={event => setPhone(event.target.value)} placeholder="01012345678" className="w-full p-3 border rounded-xl dark:bg-slate-800" />
            </label>
            {intent === 'existing' && <label className="block text-sm">كود الطبيب لدى المعمل (اختياري)
                <input aria-label="كود الطبيب لدى المعمل" maxLength={50} value={code} onChange={event => setCode(event.target.value)} className="w-full p-3 border rounded-xl dark:bg-slate-800" />
            </label>}
            <button disabled={busy} className="w-full p-3 rounded-xl bg-blue-600 text-white disabled:opacity-50">{busy ? 'جاري الإرسال…' : intent === 'new' ? 'استكمال بيانات العيادة' : 'إرسال طلب ربط الحساب'}</button>
        </form>
        <p className="text-xs text-slate-500">احتفظ بهذا الجهاز لمتابعة طلبك. تغيير الجهاز أو حذف بيانات المتصفح يحتاج طلب مراجعة جديد حتى تفعيل تحقق واتساب.</p>
        {registration && <NewDoctorRegistration phone={phone} onClose={() => setRegistration(false)} manualAccess onSubmitted={submitted} />}
    </div>;
}
