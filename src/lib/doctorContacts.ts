export const PHONE_OWNER_ROLES = [
    { value: 'doctor', label: 'الطبيب شخصيًا' },
    { value: 'secretary', label: 'السكرتارية' },
    { value: 'whatsapp_only', label: 'رقم واتساب فقط' },
    { value: 'other_doctor', label: 'طبيب آخر في العيادة' },
] as const;
export type PhoneOwnerRole = typeof PHONE_OWNER_ROLES[number]['value'];
export interface DoctorContactPhone { phone: string; ownerRole: PhoneOwnerRole; ownerName: string; hasWhatsapp: boolean }
export const newDoctorContact = (phone = ''): DoctorContactPhone => ({ phone, ownerRole: 'doctor', ownerName: '', hasWhatsapp: false });
