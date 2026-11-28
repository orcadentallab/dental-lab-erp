import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { doctorMessage, doctorPortal, formatDoctorText } from '../../translations/doctorPortal';
import { useEffect, useState, type FormEvent } from 'react';
import { doctorPasswordService, type DoctorInvitation } from '../../services/auth/doctorPasswordService';
import type { NewDoctorProfile } from '../../services/auth/types';
import NewDoctorRegistration from './NewDoctorRegistration';
import DoctorPasswordField from './DoctorPasswordField';

export default function DoctorPasswordAccess({ invitationToken }: { invitationToken: string | null }) {
    const { t } = useDoctorLanguage();
    const [screen, setScreen] = useState<'login' | 'register'>(invitationToken ? 'register' : 'login');
    const [identifier, setIdentifier] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [intent, setIntent] = useState<'new' | 'existing'>('new');
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
            else setError(doctorMessage(doctorPortal.ar, result.message, doctorPortal.ar.invalidInvitation));
        }).catch(() => { if (!disposed) setError(doctorPortal.ar.invitationLoadError); });
        return () => { disposed = true; };
    }, [invitationToken]);

    const signIn = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const result = await doctorPasswordService.login(identifier, password);
            if (!result.success) setError(doctorMessage(t, result.message, t.signInError));
        } catch { setError(t.connectionError); }
        finally { setBusy(false); }
    };
    const search = async () => {
        if (busy) return;
        setBusy(true); setError(''); setSearchedPhone('');
        try {
            const result = await doctorPasswordService.find(phone);
            if (!result.success) { setError(doctorMessage(t, result.message, t.lookupError)); return; }
            setSearchedPhone(phone);
        } catch { setError(t.retryLookup); }
        finally { setBusy(false); }
    };
    const next = (event: FormEvent) => {
        event.preventDefault(); setError(''); setMessage('');
        if (busy) return;
        if (password.length < 8 || new TextEncoder().encode(password).length > 72) { setError(t.passwordLimits); return; }
        if (password !== confirmation) { setError(t.passwordMismatch); return; }
        if (invitationToken && !invitation?.success) { setError(t.invitationUnavailable); return; }
        if (!invitationToken && intent === 'existing' && searchedPhone !== phone) { setError(t.phoneConfirmationRequired); return; }
        setShowProfile(true);
    };
    const register = async (profile: NewDoctorProfile) => {
        const result = await doctorPasswordService.register(phone, email, password, profile,
            invitationToken ? 'invited' : intent, undefined, invitationToken || undefined);
        if (result.success) {
            setShowProfile(false); setPassword(''); setConfirmation(''); setIdentifier(email); setScreen('login');
            setMessage(result.status === 'pending' ? t.registrationPending
                : doctorMessage(t, result.message, formatDoctorText(t.accountActivated, result.doctor_code ? formatDoctorText(t.accountCodeSuffix, result.doctor_code) : '')));
        }
        return result;
    };
    return <div className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-600">{doctorMessage(t, error, error)}</p>}
        {message && <p role="status" className="text-sm text-emerald-700">{doctorMessage(t, message, message)}</p>}
        {invitation?.success && <p className="text-sm font-bold text-blue-700">{t.inviteIntro} {invitation.doctor_name}{t.inviteHelp}</p>}
        {screen === 'login' ? <form onSubmit={signIn} className="space-y-4">
            <label className="block text-sm">{t.emailOrPhone}
                <input className={inputClass} aria-label={t.emailOrPhone} autoComplete="username" dir="ltr" required value={identifier} onChange={event => setIdentifier(event.target.value)} />
            </label>
            <DoctorPasswordField label={t.password} value={password} onChange={setPassword} />
            <button disabled={busy} className="w-full p-3 bg-blue-600 text-white rounded-xl disabled:opacity-50">{busy ? t.signingIn : t.doctorSignIn}</button>
            <button type="button" onClick={() => { setScreen('register'); setPassword(''); setError(''); }} className="w-full text-blue-600">{t.createDoctorAccount}</button>
            <p className="text-xs text-slate-500">{t.passwordResetHelp}</p>
        </form> : <form onSubmit={next} className="space-y-4">
            {!invitationToken && <fieldset className="space-y-2 text-sm">
                <legend className="font-bold mb-2">{t.workedWithLab}</legend>
                <label className="flex gap-2"><input type="radio" name="passwordIntent" checked={intent === 'new'} onChange={() => setIntent('new')} />{t.firstTimeDentist}</label>
                <label className="flex gap-2"><input type="radio" name="passwordIntent" checked={intent === 'existing'} onChange={() => setIntent('existing')} />{t.existingDentist}</label>
            </fieldset>}
            <label className="block text-sm">{t.mobileNumber}
                <input className={inputClass} aria-label={t.mobileNumber} type="tel" autoComplete="tel" dir="ltr" required value={phone} onChange={event => { setPhone(event.target.value); setSearchedPhone(''); }} />
            </label>
            {!invitationToken && intent === 'existing' && <section className="space-y-2">
                <button type="button" disabled={busy || !phone.trim()} onClick={search} className="text-blue-600 font-bold disabled:opacity-50">{t.confirmMobile}</button>
                {searchedPhone === phone && <p role="status" className="text-sm">{t.phoneReceived}</p>}
                <p className="text-xs text-slate-500">{t.linkReview}</p>
            </section>}
            <label className="block text-sm">{t.email}
                <input className={inputClass} aria-label={t.email} type="email" autoComplete="email" dir="ltr" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} />
            </label>
            <DoctorPasswordField label={t.newPassword} value={password} onChange={setPassword} isNew note={t.passwordMinimum} />
            <DoctorPasswordField label={t.confirmPassword} value={confirmation} onChange={setConfirmation} isNew note={t.repeatPassword} />
            <button disabled={busy} className="w-full p-3 bg-blue-600 text-white rounded-xl disabled:opacity-50">{t.continueClinic}</button>
            <button type="button" className="w-full text-blue-600" onClick={() => { setScreen('login'); setPassword(''); setConfirmation(''); setError(''); }}>{t.existingAccount}</button>
        </form>}
        {showProfile && <NewDoctorRegistration phone={phone} onClose={() => setShowProfile(false)} submitProfile={register}
            existingDoctor={!!invitationToken || intent === 'existing'}
            registeredBranches={invitation?.branches || []}
            initialProfile={{ name: invitation?.doctor_name || '',
                address: invitation?.address || '', codeRegion: invitation?.code_region || '', isCenter: invitation?.is_center || false }}
            description={t.clinicWelcome}
            submitLabel={invitationToken || intent === 'new' ? t.createAndSignIn : t.registerAndLink} />}
    </div>;
}
