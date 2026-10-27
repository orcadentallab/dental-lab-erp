import { useState, type FormEvent } from 'react';
import { doctorAuthService } from '../../services/auth/doctorAuthService';
import { doctorManualAccessService } from '../../services/auth/doctorManualAccessService';
import type { NewDoctorProfile } from '../../services/auth/types';
import { DOCTOR_CODE_REGIONS, normalizeDoctorName, isArabicDoctorName } from '../../lib/doctorIdentity';
import DoctorPhoneFields from './DoctorPhoneFields';
import { newDoctorContact } from '../../lib/doctorContacts';
import type { DoctorBranch } from '../../services/db';

export default function NewDoctorRegistration({ phone, onClose, manualAccess = false, onSubmitted, submitProfile, initialProfile, description, submitLabel, existingDoctor = false, registeredBranches = [] }: { phone: string; onClose: () => void; manualAccess?: boolean; onSubmitted?: () => void; submitProfile?: (profile: NewDoctorProfile) => Promise<{ success: boolean; message?: string }>; initialProfile?: Partial<NewDoctorProfile>; description?: string; submitLabel?: string; existingDoctor?: boolean; registeredBranches?: DoctorBranch[] }) {
    const [profile, setProfile] = useState<NewDoctorProfile>({ name: '', address: '', isCenter: false, codeRegion: '', branches: [], doctors: [], contactPhones: [newDoctorContact(phone)], ...initialProfile });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const inputClass = 'w-full p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 text-base';
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        if (!isArabicDoctorName(profile.name) || profile.doctors.some(doctor => !isArabicDoctorName(doctor.name)) || profile.contactPhones?.some(contact => contact.ownerRole === 'other_doctor' && !isArabicDoctorName(contact.ownerName))) {
            setError('اسم الطبيب يجب أن يكون عربيًا وثنائيًا على الأقل');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = submitProfile ? await submitProfile(profile) : manualAccess ? await doctorManualAccessService.submit(phone, 'new', '', profile) : await doctorAuthService.registerNewDoctor(phone, profile);
            if (!result.success) setError(result.message || 'تعذر التسجيل');
            else if (manualAccess) onSubmitted?.();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'تعذر إرسال التسجيل. تحقق من الاتصال.');
        } finally { setBusy(false); }
    };
    return (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4" dir="rtl">
            <form onSubmit={submit} className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto space-y-4">
                <h2 className="text-xl font-bold">{submitProfile ? 'بيانات العيادة والحساب' : 'تسجيل طبيب جديد'}</h2>
                <p className="text-sm text-slate-500">{description || (manualAccess ? `رقم التواصل ${phone}. التسجيل يحتاج مراجعة المعمل؛ كود الحساب يتولد عند الاعتماد حسب منطقة العيادة الرئيسية.` : `تم التحقق من هاتفك ${phone}. كود الحساب يتولد حسب منطقة العيادة الرئيسية.`)}</p>
                {error && <p role="alert" className="text-red-600">{error}</p>}
                <label className="block">اسم الطبيب أو المركز
                    <input aria-label="اسم الطبيب أو المركز" className={inputClass} required minLength={2} maxLength={150} onBlur={() => setProfile({ ...profile, name: normalizeDoctorName(profile.name) })} value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} />
                </label>
                <p className="text-xs text-slate-500">اسم عربي وثنائي على الأقل. نحذف «دكتور» أو «د.» تلقائيًا من بداية الاسم.</p>
                <label className="block">منطقة العيادة الرئيسية
                    <select aria-label="منطقة العيادة الرئيسية" required={!existingDoctor} disabled={existingDoctor} className={inputClass} value={profile.codeRegion} onChange={event => {
                        const region = DOCTOR_CODE_REGIONS.find(item => item.value === event.target.value);
                        if (region) setProfile({ ...profile, codeRegion: region.value });
                    }}>
                        <option value="" disabled>اختر المنطقة</option>
                        {DOCTOR_CODE_REGIONS.map(region => <option key={region.value} value={region.value}>{region.label}</option>)}
                    </select>
                </label>
                <label className="block">عنوان العيادة الرئيسي
                    <input aria-label="عنوان العيادة الرئيسي" className={inputClass} readOnly={existingDoctor} required={!existingDoctor} minLength={5} maxLength={500} placeholder={existingDoctor ? 'لم يُسجل عنوان بعد' : 'الشارع، رقم المبنى، الدور'} value={profile.address} onChange={e => setProfile({ ...profile, address: e.target.value })} />
                </label>
                {existingDoctor && <section className="space-y-2">
                    <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={profile.addressChangeRequested || false} onChange={e => setProfile({ ...profile, addressChangeRequested: e.target.checked })} />طلب تعديل عنوان العيادة الرئيسي</label>
                    {profile.addressChangeRequested && <label className="block text-sm">العنوان المطلوب
                        <input aria-label="العنوان المطلوب" required minLength={5} maxLength={500} className={inputClass} value={profile.requestedAddress || ''} onChange={e => setProfile({ ...profile, requestedAddress: e.target.value })} />
                        <span className="block text-xs text-slate-500 mt-1">سيتم تحديث العنوان بعد مراجعة المعمل</span>
                    </label>}
                </section>}
                <section className="space-y-3 border-t pt-4">
                    <h3 className="font-bold">أرقام التواصل</h3>
                    {(profile.contactPhones || []).map((contact, index) => <fieldset key={index} className="border rounded-xl p-3 space-y-2">
                        <DoctorPhoneFields label={index === 0 ? 'رقم الدخول' : `رقم التواصل ${index + 1}`} value={contact} readOnlyNumber={index === 0} onChange={value => setProfile({ ...profile, contactPhones: profile.contactPhones?.map((item, i) => i === index ? value : item) })} />
                        {index > 0 && <button type="button" className="text-red-600 min-h-11" onClick={() => setProfile({ ...profile, contactPhones: profile.contactPhones?.filter((_, i) => i !== index) })}>حذف الرقم {index + 1}</button>}
                    </fieldset>)}
                    <button type="button" className="text-blue-600 font-bold min-h-11" disabled={(profile.contactPhones?.length || 0) >= 10} onClick={() => setProfile({ ...profile, contactPhones: [...(profile.contactPhones || []), newDoctorContact()] })}>إضافة رقم تواصل</button>
                </section>
                <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={existingDoctor} checked={profile.isCenter} onChange={e => setProfile({ ...profile, isCenter: e.target.checked, doctors: e.target.checked ? profile.doctors : [] })} />
                    أنا مركز طبي يعمل به أكثر من طبيب
                </label>
                {profile.isCenter && !existingDoctor && <section className="space-y-2">
                    <h3 className="font-bold">الأطباء التابعون للمركز</h3>
                    {profile.doctors.map((doctor, index) => <div key={index} className="flex flex-wrap gap-2">
                        <input aria-label={`اسم طبيب المركز ${index + 1}`} placeholder="اسم الطبيب" required minLength={2} className={inputClass} value={doctor.name} onChange={e => setProfile({ ...profile, doctors: profile.doctors.map((d, i) => i === index ? { ...d, name: e.target.value } : d) })} />
                        <input aria-label={`هاتف طبيب المركز ${index + 1}`} type="tel" placeholder="هاتف الطبيب (اختياري)" className={inputClass} value={doctor.phone} onChange={e => setProfile({ ...profile, doctors: profile.doctors.map((d, i) => i === index ? { ...d, phone: e.target.value } : d) })} />
                        {doctor.phone.trim() && <label className="flex gap-2 items-center text-sm min-h-11"><input aria-label={`واتساب على هاتف طبيب المركز ${index + 1}`} type="checkbox" checked={doctor.phoneHasWhatsapp || false} onChange={e => setProfile({ ...profile, doctors: profile.doctors.map((d, i) => i === index ? { ...d, phoneHasWhatsapp: e.target.checked } : d) })} />يوجد واتساب على رقم هذا الطبيب</label>}
                        <button type="button" aria-label={`حذف طبيب المركز ${index + 1}`} onClick={() => setProfile({ ...profile, doctors: profile.doctors.filter((_, i) => i !== index) })}>حذف</button>
                    </div>)}
                    <button type="button" className="text-blue-600 font-bold" disabled={profile.doctors.length >= 50} onClick={() => setProfile({ ...profile, doctors: [...profile.doctors, { name: '', phone: '' }] })}>إضافة طبيب للمركز</button>
                </section>}
                {registeredBranches.length > 0 && <section className="space-y-2"><h3 className="font-bold">الفروع المسجلة</h3>{registeredBranches.map(branch => <div key={branch.id || branch.name} className="border rounded-xl p-3"><p className="font-bold">{branch.name}</p><p className="text-sm">{branch.address}</p><p dir="ltr" className="text-sm text-right">{branch.phone}</p></div>)}</section>}
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={profile.branches.length > 0} onChange={e => setProfile({ ...profile, branches: e.target.checked ? [{ name: '', address: '', phone: '' }] : [] })} />
                    لدي فروع إضافية أريد تسجيل عناوينها
                </label>
                {profile.branches.map((branch, index) => <fieldset key={index} className="border rounded-xl p-3 space-y-2">
                    <legend>الفرع {index + 1}</legend>
                    <input aria-label={`اسم الفرع ${index + 1}`} className={inputClass} required minLength={2} placeholder="اسم الفرع" value={branch.name} onChange={e => setProfile({ ...profile, branches: profile.branches.map((b, i) => i === index ? { ...b, name: e.target.value } : b) })} />
                    <input aria-label={`عنوان الفرع ${index + 1}`} className={inputClass} required minLength={5} placeholder="العنوان التفصيلي" value={branch.address} onChange={e => setProfile({ ...profile, branches: profile.branches.map((b, i) => i === index ? { ...b, address: e.target.value } : b) })} />
                    <DoctorPhoneFields label={`رقم تليفون الفرع ${index + 1}`} value={{ phone: branch.phone, ownerRole: branch.phoneOwnerRole || 'doctor', ownerName: branch.phoneOwnerName || '', hasWhatsapp: branch.phoneHasWhatsapp || false }} onChange={value => setProfile({ ...profile, branches: profile.branches.map((b, i) => i === index ? { ...b, phone: value.phone, phoneOwnerRole: value.ownerRole, phoneOwnerName: value.ownerName, phoneHasWhatsapp: value.hasWhatsapp } : b) })} />
                    <button type="button" className="text-red-600" onClick={() => setProfile({ ...profile, branches: profile.branches.filter((_, i) => i !== index) })}>حذف الفرع</button>
                </fieldset>)}
                {profile.branches.length > 0 && <button type="button" className="text-blue-600 font-bold" disabled={profile.branches.length + registeredBranches.length >= 20} onClick={() => setProfile({ ...profile, branches: [...profile.branches, { name: '', address: '', phone: '' }] })}>إضافة فرع آخر</button>}
                <div className="flex gap-3">
                    <button disabled={busy} className="bg-blue-600 text-white rounded-xl px-5 py-3 disabled:opacity-50">{busy ? 'جاري التسجيل...' : submitLabel || (manualAccess ? 'إرسال التسجيل للمراجعة' : 'تسجيل الحساب والدخول')}</button>
                    <button type="button" disabled={busy} onClick={onClose}>رجوع</button>
                </div>
            </form>
        </div>
    );
}
