import { supabase } from '../../lib/supabase';
import type { DoctorLinkRequestItem, NewDoctorProfile } from './types';

export const passwordDoctorAccessEnabled = import.meta.env.VITE_DOCTOR_ACCESS_MODE !== 'otp';
export type DoctorRegistrationMatch = { id: string; name: string; address?: string; code_region?: NewDoctorProfile['codeRegion']; is_center?: boolean; branches?: import('../db').DoctorBranch[] };
export type RegistrationResult = { success: boolean; status?: 'pending' | 'approved'; message?: string; doctor_code?: string };
export type DoctorInvitation = { success: boolean; message?: string; doctor_name?: string; phone?: string; address?: string; code_region?: NewDoctorProfile['codeRegion']; is_center?: boolean; branches?: import('../db').DoctorBranch[] };

export function normalizeDoctorLoginPhone(input: string): string | null {
    let digits = input.trim().replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632))
        .replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776)).replace(/[\s+()./-]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (/^01[0125]\d{8}$/.test(digits)) digits = `2${digits}`;
    else if (/^1[0125]\d{8}$/.test(digits)) digits = `20${digits}`;
    return /^[1-9]\d{8,14}$/.test(digits) ? digits : null;
}

export const doctorPasswordService = {
    async login(identifier: string, password: string): Promise<{ success: boolean; message?: string }> {
        let email = identifier.trim().toLowerCase();
        const phone = normalizeDoctorLoginPhone(identifier);
        if (!email.includes('@') && !phone) return { success: false, message: 'اكتب إيميلك أو رقم موبايل صحيح' };
        if (!email.includes('@')) {
            const { data, error } = await supabase.rpc('resolve_doctor_password_login', { p_phone: phone!, p_password: password });
            if (error || !data?.success || typeof data.email !== 'string') return { success: false, message: data?.message || 'بيانات الدخول غير صحيحة أو الحساب غير متاح' };
            email = data.email;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { success: false, message: error.code === 'user_banned' ? 'حسابك غير مفعل بعد. طلب الربط يحتاج مراجعة المعمل.' : 'بيانات الدخول غير صحيحة أو الحساب غير متاح. تواصل مع المعمل إذا كان طلب الربط قيد المراجعة.' };
        return { success: true };
    },
    async find(phone: string): Promise<{ success: boolean; message?: string; matches?: DoctorRegistrationMatch[] }> {
        const { data, error } = await supabase.rpc('find_doctor_registration_matches', { p_phone: phone });
        if (error) throw new Error('تعذر البحث؛ حاول مرة أخرى.');
        return data;
    },
    async inspectInvitation(token: string): Promise<DoctorInvitation> {
        const { data, error } = await supabase.rpc('inspect_doctor_portal_invitation', { p_token: token });
        if (error) throw new Error('تعذر فتح الدعوة.');
        return data;
    },
    async register(phone: string, email: string, password: string, profile: NewDoctorProfile,
        intent: 'new' | 'existing' | 'invited', claimedDoctorId?: string, invitationToken?: string): Promise<RegistrationResult> {
        const { data, error } = await supabase.rpc('register_doctor_password_account', {
            p_phone: phone.trim(), p_email: email.trim().toLowerCase(), p_password: password,
            p_profile: { name: profile.name, address: profile.address, code_region: profile.codeRegion,
                is_center: profile.isCenter, branches: profile.branches, doctors: profile.doctors,
                contact_phones: profile.contactPhones, address_change_requested: profile.addressChangeRequested || false, requested_address: profile.requestedAddress || '' },
            p_intent: intent, p_claimed_doctor_id: claimedDoctorId || null, p_invitation_token: invitationToken || null,
        });
        // Never log an RPC error object: it can contain request parameters/passwords.
        if (error) throw new Error(error.message || 'تعذر تسجيل الحساب.');
        const result = data as RegistrationResult;
        if (result.success && result.status === 'approved') {
            const signedIn = await this.login(email, password);
            if (!signedIn.success) return { ...result, message: 'تم إنشاء حسابك. سجّل الدخول بالإيميل وكلمة المرور.' };
        }
        return result;
    },
    async pending(): Promise<DoctorLinkRequestItem[]> {
        const { data, error } = await supabase.rpc('get_pending_doctor_password_registrations');
        if (error) throw error;
        return data || [];
    },
    async review(id: string, approve: boolean, doctorId?: string, approveAddress = false): Promise<{ success: boolean; message: string }> {
        const { data, error } = await supabase.rpc('review_doctor_password_registration', {
            p_request_id: id, p_approve: approve, p_doctor_id: doctorId || null, p_approve_address: approveAddress,
        });
        if (error) throw error;
        return data;
    },
    async reviewAddress(id: string, approve: boolean): Promise<{ success: boolean; message: string }> {
        const { data, error } = await supabase.rpc('review_doctor_address_update', { p_request_id: id, p_approve: approve });
        if (error) throw error;
        return data;
    },
    async createInvitation(doctorId: string): Promise<{ url: string; expiresAt: string }> {
        const { data, error } = await supabase.rpc('create_doctor_portal_invitation', { p_doctor_id: doctorId });
        if (error) throw error;
        if (!data?.success || typeof data.token !== 'string') throw new Error('تعذر إصدار الدعوة');
        const url = new URL('/login', window.location.origin);
        url.searchParams.set('doctor_invite', data.token);
        return { url: url.toString(), expiresAt: data.expires_at };
    },
};
