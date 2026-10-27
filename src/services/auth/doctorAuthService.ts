import { supabase } from '../../lib/supabase';
import { doctorPasswordService } from './doctorPasswordService';
import type {
    OtpChannel,
    NewDoctorProfile,
    RequestOtpResponse,
    VerifyDoctorAuthResponse,
    ClaimDoctorCodeResponse,
    DoctorLinkRequestItem
} from './types';
// Custom OTP RPCs are a local-only scaffold until a server sender is deployed.
const activeChannel: OtpChannel = 'mock';
const localOtpEnabled = import.meta.env.DEV && import.meta.env.VITE_OTP_CHANNEL === 'mock';
let claimProof: { phone: string; token: string } | null = null;

export const doctorAuthService = {
    /**
     * Request OTP for a doctor's phone number.
     * Issues a local test challenge; production delivery requires a server endpoint.
     */
    async requestOtp(phone: string): Promise<RequestOtpResponse> {
        claimProof = null;
        if (!localOtpEnabled) {
            return { success: false, message: 'تسجيل الدخول بالهاتف غير متاح حالياً. يرجى التواصل مع المعمل.' };
        }
        try {
            const { data, error } = await supabase.rpc('request_doctor_phone_otp', {
                p_phone: phone.trim(),
                p_channel: activeChannel,
            });

            if (error) {
                console.error('Error requesting doctor phone OTP:', error);
                return {
                    success: false,
                    message: error.message || 'فشل في إرسال كود التحقق. يرجى التأكد من الرقم.'
                };
            }

            const response = data as RequestOtpResponse;

            if (response.success && !response.otp_code) {
                return { success: false, message: 'تعذر إصدار رمز الاختبار.' };
            }

            return response;
        } catch (err) {
            console.error('Network error during requestOtp:', err);
            return {
                success: false,
                message: 'حدث خطأ في الاتصال بالخادم. يرجى المحاولة لاحقاً.'
            };
        }
    },

    /**
     * Verify OTP and link doctor account.
     * If auto_linked, automatically performs Supabase Auth signInWithPassword
     * using the cryptographic session token returned by the RPC.
     */
    async verifyOtpAndLogin(phone: string, otpCode: string): Promise<VerifyDoctorAuthResponse> {
        claimProof = null;
        if (!localOtpEnabled) {
            return { success: false, status: 'invalid_phone', message: 'تسجيل الدخول بالهاتف غير متاح حالياً.' };
        }
        try {
            const { data, error } = await supabase.rpc('verify_and_link_doctor', {
                p_phone: phone.trim(),
                p_otp_code: otpCode.trim()
            });

            if (error) {
                console.error('Error verifying doctor OTP:', error);
                return {
                    success: false,
                    status: 'invalid_phone',
                    message: error.message || 'حدث خطأ أثناء التحقق من الرمز.'
                };
            }

            const response = data as VerifyDoctorAuthResponse;

            if (response.success && response.status === 'not_found' && response.claim_token) {
                claimProof = { phone: phone.trim(), token: response.claim_token };
            }
            if (response.success && response.status === 'auto_linked' && (!response.email || !response.session_token)) {
                return { success: false, status: 'invalid_phone', message: 'تعذر فتح جلسة المستخدم.' };
            }
            // Auto-sign in to Supabase Auth if auto_linked
            if (response.success && response.status === 'auto_linked' && response.email && response.session_token) {
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: response.email,
                    password: response.session_token
                });

                if (signInError) {
                    console.error('Supabase signInWithPassword failed after OTP verification:', signInError);
                    return {
                        success: false,
                        status: 'invalid_phone',
                        message: 'تم التحقق من الرمز ولكن تعذر فتح جلسة المستخدم. يرجى المحاولة مرة أخرى.'
                    };
                }
            }

            return response;
        } catch (err) {
            console.error('Network error during verifyOtpAndLogin:', err);
            return {
                success: false,
                status: 'invalid_phone',
                message: 'حدث خطأ في الاتصال بالخادم.'
            };
        }
    },

    /**
     * Safe doctor code claim (Zero Data Exposure).
     * Allows doctors with unlisted phones to request linking via their doctor code.
     */
    async claimDoctorCode(phone: string, doctorCode: string): Promise<ClaimDoctorCodeResponse> {
        if (!claimProof || claimProof.phone !== phone.trim()) {
            return { success: false, message: 'يرجى التحقق من رقم الهاتف أولاً.' };
        }
        try {
            const { data, error } = await supabase.rpc('claim_doctor_code', {
                p_phone: phone.trim(),
                p_doctor_code: doctorCode.trim(),
                p_claim_token: claimProof.token
            });

            if (error) {
                console.error('Error claiming doctor code:', error);
                return {
                    success: false,
                    message: error.message || 'فشل في تسجيل طلب الربط.'
                };
            }

            const response = data as ClaimDoctorCodeResponse;
            if (response.success) claimProof = null;
            return response;
        } catch (err) {
            console.error('Network error during claimDoctorCode:', err);
            return {
                success: false,
                message: 'حدث خطأ أثناء إرسال الطلب.'
            };
        }
    },

    async registerNewDoctor(phone: string, profile: NewDoctorProfile): Promise<VerifyDoctorAuthResponse> {
        if (!localOtpEnabled || !claimProof || claimProof.phone !== phone.trim()) {
            return { success: false, status: 'invalid_phone', message: 'يرجى التحقق من الهاتف أولاً.' };
        }
        try {
            const { data, error } = await supabase.rpc('register_verified_doctor', {
                p_phone: phone.trim(), p_claim_token: claimProof.token,
                p_profile: { name: profile.name.trim(), address: profile.address.trim(), is_center: profile.isCenter, code_region: profile.codeRegion,
                    branches: profile.branches, doctors: profile.isCenter ? profile.doctors : [] },
            });
            if (error) throw error;
            const response = data as VerifyDoctorAuthResponse;
            if (!response.success) return response;
            claimProof = null;
            if (!response.email || !response.session_token) throw new Error('تعذر فتح الحساب. أعد الدخول برمز جديد.');
            const { error: loginError } = await supabase.auth.signInWithPassword({ email: response.email, password: response.session_token });
            if (loginError) throw new Error('تم تسجيل بياناتك. أعد الدخول برمز تحقق جديد.');
            return response;
        } catch (error) {
            return { success: false, status: 'invalid_phone', message: error instanceof Error ? error.message : 'تعذر التسجيل. يرجى المحاولة مرة أخرى.' };
        }
    },

    /**
     * Coordinator / Admin: Fetch all pending doctor link requests.
     */
    async getPendingDoctorLinkRequests(): Promise<DoctorLinkRequestItem[]> {
        const { data, error } = await supabase.rpc('get_pending_doctor_link_requests');
        if (error) throw error;
        const passwordRegistrations = await doctorPasswordService.pending();
        return [...((data || []) as DoctorLinkRequestItem[]), ...passwordRegistrations];
    },

    /**
     * Coordinator / Admin: Approve a doctor link request.
     */
    async approveDoctorLinkRequest(requestId: string, doctorId: string): Promise<{ success: boolean; message: string }> {
        const { data, error } = await supabase.rpc('approve_doctor_link_request', {
            p_request_id: requestId,
            p_doctor_id: doctorId
        });
        if (error) throw error;
        return data as { success: boolean; message: string };
    },

    /**
     * Coordinator / Admin: Reject a doctor link request with notes.
     */
    async rejectDoctorLinkRequest(requestId: string, notes?: string): Promise<{ success: boolean; message: string }> {
        const { data, error } = await supabase.rpc('reject_doctor_link_request', {
            p_request_id: requestId,
            p_notes: notes?.trim() || null
        });
        if (error) throw error;
        return data as { success: boolean; message: string };
    }
};
