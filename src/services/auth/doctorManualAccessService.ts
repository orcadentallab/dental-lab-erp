import { supabase } from '../../lib/supabase';
import type { DoctorLinkRequestItem, NewDoctorProfile } from './types';

const storageKey = 'orca.doctor.manual-access.v1';
type DeviceRequest = { id: string; token: string };
type AccessResult = { success: boolean; status?: 'pending' | 'approved' | 'rejected'; request_id?: string; message?: string; email?: string; session_token?: string };

export const manualDoctorAccessEnabled = import.meta.env.VITE_DOCTOR_ACCESS_MODE !== 'otp';

export function getSavedDoctorRequest(): DeviceRequest | null {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (value && typeof value === 'object' && 'id' in value && 'token' in value
            && typeof value.id === 'string' && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token)) {
            return { id: value.id, token: value.token };
        }
    } catch { /* Missing or invalid device storage requires a new reviewed request. */ }
    return null;
}

export const doctorManualAccessService = {
    async submit(phone: string, intent: 'existing' | 'new', code = '', profile?: NewDoctorProfile): Promise<AccessResult> {
        // Verify writable storage before creating a request whose secret would be lost.
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
        const probe = `${storageKey}.probe`;
        localStorage.setItem(probe, token);
        localStorage.removeItem(probe);
        const { data, error } = await supabase.rpc('submit_doctor_manual_access', {
            p_phone: phone.trim(), p_token: token, p_intent: intent, p_code: code.trim() || null,
            p_profile: profile ? { name: profile.name, address: profile.address, code_region: profile.codeRegion,
                is_center: profile.isCenter, branches: profile.branches, doctors: profile.doctors } : {},
        });
        if (error) throw error;
        const result = data as AccessResult;
        if (result.success && result.request_id) localStorage.setItem(storageKey, JSON.stringify({ id: result.request_id, token }));
        return result;
    },
    async open(): Promise<AccessResult> {
        const request = getSavedDoctorRequest();
        if (!request) return { success: false, message: 'قدّم طلب التسجيل من هذا الجهاز أولًا.' };
        const { data, error } = await supabase.rpc('open_doctor_manual_access', { p_request_id: request.id, p_token: request.token });
        if (error) throw error;
        const result = data as AccessResult;
        if (result.success && result.status === 'approved') {
            if (!result.email || !result.session_token) throw new Error('تعذر فتح الحساب؛ تواصل مع المعمل.');
            const { error: loginError } = await supabase.auth.signInWithPassword({ email: result.email, password: result.session_token });
            if (loginError) throw new Error('تعذر فتح الجلسة. حاول مرة أخرى.');
        }
        // Never expose internal session credentials to UI callers.
        return { success: result.success, status: result.status, message: result.message };
    },
    async pending(): Promise<DoctorLinkRequestItem[]> {
        const { data, error } = await supabase.rpc('get_pending_doctor_manual_access');
        if (error) throw error;
        return (data || []) as DoctorLinkRequestItem[];
    },
    async review(id: string, approve: boolean, doctorId?: string): Promise<{ success: boolean; message: string }> {
        const { data, error } = await supabase.rpc('review_doctor_manual_access', {
            p_request_id: id, p_approve: approve, p_doctor_id: doctorId || null,
        });
        if (error) throw error;
        return data as { success: boolean; message: string };
    },
};
