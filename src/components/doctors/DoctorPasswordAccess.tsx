import { useEffect, useState, type FormEvent } from 'react';
import { doctorPasswordService, type DoctorInvitation, type DoctorRegistrationMatch } from '../../services/auth/doctorPasswordService';
import type { NewDoctorProfile } from '../../services/auth/types';
import NewDoctorRegistration from './NewDoctorRegistration';
import DoctorPasswordField from './DoctorPasswordField';

export default function DoctorPasswordAccess({ invitationToken }: { invitationToken: string | null }) {
    const [screen, setScreen] = useState<'login' | 'register'>(invitationToken ? 'register' : 'login');
    const [identifier, setIdentifier] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [intent, setIntent] = useState<'new' | 'existing'>('new');
    const [matches, setMatches] = useState<DoctorRegistrationMatch[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [searchedPhone, setSearchedPhone] = useState('');
    const [invitation, setInvitation] = useState<DoctorInvitation | null>(null);
    const [showProfile, setShowProfile] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const inputClass = 'w-full p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700';

    useEffect(() => {
        if (!invitationToken) return;
        // Keep invitation authority in component memory, out of history/storage.
        const url = new URL(window.location.href);
        url.searchParams.delete('doctor_invite');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        let disposed = false;
        doctorPasswordService.inspectInvitation(invitationToken).then(result => {
            if (disposed) return;
            setInvitation(result);
            if (result.success) { setPhone(result.phone || ''); setIntent('existing'); }
            else setError(result.message || 'الدعوة غير صالحة');
        }).catch(() => { if (!disposed) setError('تعذر تحميل الدعوة؛ حاول فتح الرابط مرة أخرى.'); });
        return () => { disposed = true; };
    }, [invitationToken]);

    const signIn = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const result = await doctorPasswordService.login(identifier, password);
            if (!result.success) setError(result.message || 'تعذر الدخول');
        } catch { setError('تعذر الاتصال. حاول مرة أخرى.'); }
        finally { setBusy(false); }
    };
    const search = async () => {
        if (busy) return;
        setBusy(true); setError(''); setMatches([]); setSelectedId(''); setSearchedPhone('');
        try {
            const result = await doctorPasswordService.find(phone);
            if (!result.success) { setError(result.message || 'تعذر البحث'); return; }
            const found = result.matches || [];
            setMatches(found); setSearchedPhone(phone);
            if (found.length === 1) setSelectedId(found[0].id);
        } catch { setError('تعذر البحث؛ حاول مرة أخرى.'); }
        finally { setBusy(false); }
    };
    const next = (event: FormEvent) => {
        event.preventDefault(); setError(''); setMessage('');
        if (busy) return;
        if (password.length < 8 || new TextEncoder().encode(password).length > 72) { setError('اختر كلمة مرور من 8 أحرف على الأقل، وبحد أقصى 72 بايت'); return; }
        if (password !== confirmation) { setError('كلمتا المرور غير متطابقتين'); return; }
        if (invitationToken && !invitation?.success) { setError('الدعوة غير صالحة أو لم يكتمل تحميلها'); return; }
        if (!invitationToken && intent === 'existing' && searchedPhone !== phone) { setError('ابحث برقمك أولًا لاختيار السجل أو طلب الربط اليدوي'); return; }
        if (!invitationToken && intent === 'existing' && matches.length && !selectedId) { setError('اختر اسمك من السجلات المطابقة'); return; }
        setShowProfile(true);
    };
    const register = async (profile: NewDoctorProfile) => {
        const result = await doctorPasswordService.register(phone, email, password, profile,
            invitationToken ? 'invited' : intent, selectedId || undefined, invitationToken || undefined);
        if (result.success) {
            setShowProfile(false); setPassword(''); setConfirmation(''); setIdentifier(email); setScreen('login');
            setMessage(result.status === 'pending' ? 'تم إنشاء بيانات دخولك. طلب ربط السجل قيد مراجعة المعمل؛ بعد الاعتماد ادخل بنفس الإيميل أو الموبايل وكلمة المرور.'
                : result.message || `تم تفعيل الحساب${result.doctor_code ? ` — كود الطبيب ${result.doctor_code}` : ''}.`);
        }
        return result;
    };
    return <div className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        {invitation?.success && <p className="text-sm font-bold text-blue-700">دعوة من ORCA لتفعيل حساب {invitation.doctor_name}. التسجيل يربطك بسجلك مباشرة.</p>}
        {screen === 'login' ? <form onSubmit={signIn} className="space-y-4">
            <label className="block text-sm">الإيميل أو رقم الموبايل
                <input className={inputClass} aria-label="الإيميل أو رقم الموبايل" autoComplete="username" dir="ltr" required value={identifier} onChange={event => setIdentifier(event.target.value)} />
            </label>
            <DoctorPasswordField label="كلمة المرور" value={password} onChange={setPassword} />
            <button disabled={busy} className="w-full p-3 bg-blue-600 text-white rounded-xl disabled:opacity-50">{busy ? 'جاري الدخول…' : 'دخول الطبيب'}</button>
            <button type="button" onClick={() => { setScreen('register'); setPassword(''); setError(''); }} className="w-full text-blue-600">إنشاء حساب طبيب</button>
            <p className="text-xs text-slate-500">نسيت كلمة المرور؟ تواصل مع المعمل لإعادة تعيينها بعد التأكد من هويتك.</p>
        </form> : <form onSubmit={next} className="space-y-4">
            {!invitationToken && <fieldset className="space-y-2 text-sm">
                <legend className="font-bold mb-2">هل تعاملت مع ORCA قبل كده؟</legend>
                <label className="flex gap-2"><input type="radio" name="passwordIntent" checked={intent === 'new'} onChange={() => setIntent('new')} />لا، أول تعامل — طبيب جديد</label>
                <label className="flex gap-2"><input type="radio" name="passwordIntent" checked={intent === 'existing'} onChange={() => setIntent('existing')} />نعم، لدي سجل عند المعمل</label>
            </fieldset>}
            <label className="block text-sm">رقم الموبايل
                <input className={inputClass} aria-label="رقم الموبايل" type="tel" autoComplete="tel" dir="ltr" required value={phone} onChange={event => { setPhone(event.target.value); setMatches([]); setSelectedId(''); setSearchedPhone(''); }} />
            </label>
            {!invitationToken && intent === 'existing' && <section className="space-y-2">
                <button type="button" disabled={busy || !phone.trim()} onClick={search} className="text-blue-600 font-bold disabled:opacity-50">البحث عن سجلي</button>
                {searchedPhone === phone && (matches.length ? <label className="block text-sm">اختر اسمك
                    <select aria-label="اختر اسمك" className={inputClass} value={selectedId} onChange={event => setSelectedId(event.target.value)}>
                        <option value="">اختر السجل الصحيح</option>
                        {matches.map(match => <option key={match.id} value={match.id}>{match.name}</option>)}
                    </select>
                </label> : <p className="text-sm">لم نجد سجلًا مطابقًا. أكمل بياناتك وسيحدد المعمل السجل الصحيح عند المراجعة.</p>)}
                <p className="text-xs text-slate-500">سيتم تأكيد الربط بعد مراجعة المعمل</p>
            </section>}
            <label className="block text-sm">الإيميل
                <input className={inputClass} aria-label="الإيميل" type="email" autoComplete="email" dir="ltr" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} />
            </label>
            <DoctorPasswordField label="كلمة المرور الجديدة" value={password} onChange={setPassword} isNew note="8 أحرف على الأقل" />
            <DoctorPasswordField label="تأكيد كلمة المرور" value={confirmation} onChange={setConfirmation} isNew note="يرجى إعادة إدخال كلمة المرور" />
            <button disabled={busy} className="w-full p-3 bg-blue-600 text-white rounded-xl disabled:opacity-50">استكمال بيانات العيادة</button>
            <button type="button" className="w-full text-blue-600" onClick={() => { setScreen('login'); setPassword(''); setConfirmation(''); setError(''); }}>لدي حساب — تسجيل الدخول</button>
        </form>}
        {showProfile && <NewDoctorRegistration phone={phone} onClose={() => setShowProfile(false)} submitProfile={register}
            existingDoctor={!!invitationToken || intent === 'existing'}
            registeredBranches={invitation?.branches || matches.find(match => match.id === selectedId)?.branches || []}
            initialProfile={{ name: invitation?.doctor_name || matches.find(match => match.id === selectedId)?.name || '',
                address: invitation?.address || matches.find(match => match.id === selectedId)?.address || '', codeRegion: invitation?.code_region || matches.find(match => match.id === selectedId)?.code_region || '', isCenter: invitation?.is_center || matches.find(match => match.id === selectedId)?.is_center || false }}
            description="أهلًا بيك في ORCA. راجع بيانات العيادة وأضف أرقام التواصل والفروع اللي تحب نتواصل ونشحن عليها."
            submitLabel={invitationToken || intent === 'new' ? 'إنشاء الحساب والدخول' : 'تسجيل الحساب وإرسال طلب الربط'} />}
    </div>;
}
