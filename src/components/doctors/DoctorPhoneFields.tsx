import { PHONE_OWNER_ROLES, type DoctorContactPhone } from '../../lib/doctorContacts';

export default function DoctorPhoneFields({ label, value, onChange, readOnlyNumber = false }: {
    label: string; value: DoctorContactPhone; onChange: (value: DoctorContactPhone) => void; readOnlyNumber?: boolean;
}) {
    const inputClass = 'w-full p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 text-base focus:ring-2 focus:ring-blue-500';
    return <div className="space-y-3">
        <label className="block text-sm">{label}
            <input aria-label={label} type="tel" inputMode="tel" required readOnly={readOnlyNumber} dir="ltr" className={inputClass} value={value.phone} onChange={event => onChange({ ...value, phone: event.target.value })} />
        </label>
        <label className="block text-sm">صاحب الرقم
            <select aria-label={`صاحب ${label}`} className={inputClass} value={value.ownerRole} onChange={event => {
                const role = PHONE_OWNER_ROLES.find(item => item.value === event.target.value);
                if (role) onChange({ ...value, ownerRole: role.value, hasWhatsapp: role.value === 'whatsapp_only' ? true : value.hasWhatsapp });
            }}>
                {PHONE_OWNER_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
        </label>
        {(value.ownerRole === 'other_doctor' || value.ownerRole === 'secretary') && <label className="block text-sm">
            {value.ownerRole === 'other_doctor' ? 'اسم الطبيب الآخر' : 'اسم السكرتير / السكرتيرة (اختياري)'}
            <input aria-label={`اسم صاحب ${label}`} required={value.ownerRole === 'other_doctor'} maxLength={150} className={inputClass} value={value.ownerName} onChange={event => onChange({ ...value, ownerName: event.target.value })} />
        </label>}
        <label className="flex items-center gap-2 text-sm min-h-11 cursor-pointer">
            <input aria-label={`واتساب على ${label}`} type="checkbox" checked={value.hasWhatsapp} disabled={value.ownerRole === 'whatsapp_only'} onChange={event => onChange({ ...value, hasWhatsapp: event.target.checked })} />
            يوجد واتساب على هذا الرقم
        </label>
    </div>;
}
