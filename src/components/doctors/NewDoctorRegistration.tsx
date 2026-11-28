import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { doctorMessage, formatDoctorText } from '../../translations/doctorPortal';
import { useState, type FormEvent } from 'react';
import { doctorAuthService } from '../../services/auth/doctorAuthService';
import { doctorManualAccessService } from '../../services/auth/doctorManualAccessService';
import type { NewDoctorProfile } from '../../services/auth/types';
import { DOCTOR_CODE_REGIONS, normalizeDoctorName, isArabicDoctorName } from '../../lib/doctorIdentity';
import DoctorLanguageSwitch from './DoctorLanguageSwitch';
import DoctorPhoneFields from './DoctorPhoneFields';
import { newDoctorContact } from '../../lib/doctorContacts';
import type { DoctorBranch } from '../../services/db';

export default function NewDoctorRegistration({ phone, onClose, manualAccess = false, onSubmitted, submitProfile, initialProfile, description, submitLabel, existingDoctor = false, registeredBranches = [] }: { phone: string; onClose: () => void; manualAccess?: boolean; onSubmitted?: () => void; submitProfile?: (profile: NewDoctorProfile) => Promise<{ success: boolean; message?: string }>; initialProfile?: Partial<NewDoctorProfile>; description?: string; submitLabel?: string; existingDoctor?: boolean; registeredBranches?: DoctorBranch[] }) {
    const { t, setLanguage } = useDoctorLanguage();
    const [profile, setProfile] = useState<NewDoctorProfile>({ name: '', address: '', isCenter: false, codeRegion: '', branches: [], doctors: [], contactPhones: [newDoctorContact(phone)], ...initialProfile });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [phoneIntro, phoneHelp] = (manualAccess ? t.manualRegistrationHelp : t.verifiedRegistrationHelp).split('{#}');
    const inputClass = 'w-full p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 text-base';
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        if (!isArabicDoctorName(profile.name) || profile.doctors.some(doctor => !isArabicDoctorName(doctor.name)) || profile.contactPhones?.some(contact => contact.ownerRole === 'other_doctor' && !isArabicDoctorName(contact.ownerName))) {
            setError(t.invalidDoctorName);
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = submitProfile ? await submitProfile(profile) : manualAccess ? await doctorManualAccessService.submit(phone, 'new', '', profile) : await doctorAuthService.registerNewDoctor(phone, profile);
            if (!result.success) setError(doctorMessage(t, result.message, t.registrationError));
            else if (manualAccess) onSubmitted?.();
        } catch (cause) {
            setError(doctorMessage(t, cause, t.submitRegistrationError));
        } finally { setBusy(false); }
    };
    return (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
            <form onSubmit={submit} className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">{submitProfile ? t.clinicAndAccount : t.newDentistRegistration}</h2>{setLanguage && <DoctorLanguageSwitch />}</div>
                <p className="text-sm text-slate-500">{description || <>{phoneIntro}<bdi dir="ltr">{phone}</bdi>{phoneHelp}</>}</p>
                {error && <p role="alert" className="text-red-600">{doctorMessage(t, error, error)}</p>}
                <label className="block">{t.dentistOrCenterName}
                    <input aria-label={t.dentistOrCenterName} className={inputClass} required minLength={2} maxLength={150} onBlur={() => setProfile({ ...profile, name: normalizeDoctorName(profile.name) })} value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} />
                </label>
                <p className="text-xs text-slate-500">{t.doctorNameHelp}</p>
                <label className="block">{t.mainClinicRegion}
                    <select aria-label={t.mainClinicRegion} required={!existingDoctor} disabled={existingDoctor} className={inputClass} value={profile.codeRegion} onChange={event => {
                        const region = DOCTOR_CODE_REGIONS.find(item => item.value === event.target.value);
                        if (region) setProfile({ ...profile, codeRegion: region.value });
                    }}>
                        <option value="" disabled>{t.chooseRegion}</option>
                        {DOCTOR_CODE_REGIONS.map(region => <option key={region.value} value={region.value}>{t[region.value]}</option>)}
                    </select>
                </label>
                <label className="block">{t.mainClinicAddress}
                    <input aria-label={t.mainClinicAddress} className={inputClass} readOnly={existingDoctor} required={!existingDoctor} minLength={5} maxLength={500} placeholder={existingDoctor ? t.noAddress : t.addressExample} value={profile.address} onChange={e => setProfile({ ...profile, address: e.target.value })} />
                </label>
                {existingDoctor && <section className="space-y-2">
                    <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={profile.addressChangeRequested || false} onChange={e => setProfile({ ...profile, addressChangeRequested: e.target.checked })} />{t.requestAddressChange}</label>
                    {profile.addressChangeRequested && <label className="block text-sm">{t.requestedAddress}
                        <input aria-label={t.requestedAddress} required minLength={5} maxLength={500} className={inputClass} value={profile.requestedAddress || ''} onChange={e => setProfile({ ...profile, requestedAddress: e.target.value })} />
                        <span className="block text-xs text-slate-500 mt-1">{t.addressReview}</span>
                    </label>}
                </section>}
                <section className="space-y-3 border-t pt-4">
                    <h3 className="font-bold">{t.contactNumbers}</h3>
                    {(profile.contactPhones || []).map((contact, index) => <fieldset key={index} className="border rounded-xl p-3 space-y-2">
                        <DoctorPhoneFields label={index === 0 ? t.signInNumber : formatDoctorText(t.contactNumberIndex, index + 1)} value={contact} readOnlyNumber={index === 0} onChange={value => setProfile({ ...profile, contactPhones: profile.contactPhones?.map((item, i) => i === index ? value : item) })} />
                        {index > 0 && <button type="button" className="text-red-600 min-h-11" onClick={() => setProfile({ ...profile, contactPhones: profile.contactPhones?.filter((_, i) => i !== index) })}>{t.removeNumber} {index + 1}</button>}
                    </fieldset>)}
                    <button type="button" className="text-blue-600 font-bold min-h-11" disabled={(profile.contactPhones?.length || 0) >= 10} onClick={() => setProfile({ ...profile, contactPhones: [...(profile.contactPhones || []), newDoctorContact()] })}>{t.addContactNumber}</button>
                </section>
                <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={existingDoctor} checked={profile.isCenter} onChange={e => setProfile({ ...profile, isCenter: e.target.checked, doctors: e.target.checked ? profile.doctors : [] })} />
                    {t.multiDentistCenter}
                </label>
                {profile.isCenter && !existingDoctor && <section className="space-y-2">
                    <h3 className="font-bold">{t.centerDentists}</h3>
                    {profile.doctors.map((doctor, index) => <div key={index} className="flex flex-wrap gap-2">
                        <input aria-label={formatDoctorText(t.centerDentistIndex, index + 1)} placeholder={t.dentistName} required minLength={2} className={inputClass} value={doctor.name} onChange={e => setProfile({ ...profile, doctors: profile.doctors.map((d, i) => i === index ? { ...d, name: e.target.value } : d) })} />
                        <input aria-label={formatDoctorText(t.centerDentistPhoneIndex, index + 1)} type="tel" dir="ltr" placeholder={t.optionalDentistPhone} className={inputClass} value={doctor.phone} onChange={e => setProfile({ ...profile, doctors: profile.doctors.map((d, i) => i === index ? { ...d, phone: e.target.value } : d) })} />
                        {doctor.phone.trim() && <label className="flex gap-2 items-center text-sm min-h-11"><input aria-label={formatDoctorText(t.centerDentistWhatsAppIndex, index + 1)} type="checkbox" checked={doctor.phoneHasWhatsapp || false} onChange={e => setProfile({ ...profile, doctors: profile.doctors.map((d, i) => i === index ? { ...d, phoneHasWhatsapp: e.target.checked } : d) })} />{t.dentistHasWhatsApp}</label>}
                        <button type="button" aria-label={formatDoctorText(t.removeCenterDentistIndex, index + 1)} onClick={() => setProfile({ ...profile, doctors: profile.doctors.filter((_, i) => i !== index) })}>{t.remove}</button>
                    </div>)}
                    <button type="button" className="text-blue-600 font-bold" disabled={profile.doctors.length >= 50} onClick={() => setProfile({ ...profile, doctors: [...profile.doctors, { name: '', phone: '' }] })}>{t.addCenterDentist}</button>
                </section>}
                {registeredBranches.length > 0 && <section className="space-y-2"><h3 className="font-bold">{t.registeredBranches}</h3>{registeredBranches.map(branch => <div key={branch.id || branch.name} className="border rounded-xl p-3"><p className="font-bold">{branch.name}</p><p className="text-sm">{branch.address}</p><p dir="ltr" className="text-sm text-start">{branch.phone}</p></div>)}</section>}
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={profile.branches.length > 0} onChange={e => setProfile({ ...profile, branches: e.target.checked ? [{ name: '', address: '', phone: '' }] : [] })} />
                    {t.registerExtraBranches}
                </label>
                {profile.branches.map((branch, index) => <fieldset key={index} className="border rounded-xl p-3 space-y-2">
                    <legend>{t.branch} {index + 1}</legend>
                    <input aria-label={formatDoctorText(t.branchNameIndex, index + 1)} className={inputClass} required minLength={2} placeholder={t.branchName} value={branch.name} onChange={e => setProfile({ ...profile, branches: profile.branches.map((b, i) => i === index ? { ...b, name: e.target.value } : b) })} />
                    <input aria-label={formatDoctorText(t.branchAddressIndex, index + 1)} className={inputClass} required minLength={5} placeholder={t.fullAddress} value={branch.address} onChange={e => setProfile({ ...profile, branches: profile.branches.map((b, i) => i === index ? { ...b, address: e.target.value } : b) })} />
                    <DoctorPhoneFields label={formatDoctorText(t.branchPhoneIndex, index + 1)} value={{ phone: branch.phone, ownerRole: branch.phoneOwnerRole || 'doctor', ownerName: branch.phoneOwnerName || '', hasWhatsapp: branch.phoneHasWhatsapp || false }} onChange={value => setProfile({ ...profile, branches: profile.branches.map((b, i) => i === index ? { ...b, phone: value.phone, phoneOwnerRole: value.ownerRole, phoneOwnerName: value.ownerName, phoneHasWhatsapp: value.hasWhatsapp } : b) })} />
                    <button type="button" className="text-red-600" onClick={() => setProfile({ ...profile, branches: profile.branches.filter((_, i) => i !== index) })}>{t.removeBranch}</button>
                </fieldset>)}
                {profile.branches.length > 0 && <button type="button" className="text-blue-600 font-bold" disabled={profile.branches.length + registeredBranches.length >= 20} onClick={() => setProfile({ ...profile, branches: [...profile.branches, { name: '', address: '', phone: '' }] })}>{t.addBranch}</button>}
                <div className="flex gap-3">
                    <button disabled={busy} className="bg-blue-600 text-white rounded-xl px-5 py-3 disabled:opacity-50">{busy ? t.registering : submitLabel || (manualAccess ? t.submitForReview : t.registerAndSignIn)}</button>
                    <button type="button" disabled={busy} onClick={onClose}>{t.back}</button>
                </div>
            </form>
        </div>
    );
}
