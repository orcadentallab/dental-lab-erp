import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockOtpSender } from '../../src/services/auth/MockOtpSender';
vi.hoisted(() => { process.env.VITE_OTP_CHANNEL = 'mock'; });
import { doctorAuthService } from '../../src/services/auth/doctorAuthService';
import { supabase } from '../../src/lib/supabase';

vi.mock('../../src/lib/supabase', () => ({
    supabase: {
        rpc: vi.fn(),
        auth: {
            signInWithPassword: vi.fn(),
        },
    },
}));

describe('Sprint 1: Doctor Authentication & OTP Services', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('MockOtpSender returns success and simulated messageId', async () => {
        const sender = new MockOtpSender();
        const res = await sender.sendOtp('201012345678', '123456');
        expect(res.success).toBe(true);
        expect(res.channel).toBe('mock');
        expect(res.messageId).toMatch(/^mock_/);
    });

    it('doctorAuthService.requestOtp invokes request_doctor_phone_otp RPC', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({
            data: {
                success: true,
                normalized_phone: '201011112222',
                otp_code: '654321',
                channel: 'mock'
            },
            error: null
        } as any);

        const res = await doctorAuthService.requestOtp('01011112222');
        expect(supabase.rpc).toHaveBeenCalledWith('request_doctor_phone_otp', {
            p_phone: '01011112222',
            p_channel: 'mock'
        });
        expect(res.success).toBe(true);
        expect(res.normalized_phone).toBe('201011112222');
    });

    it('doctorAuthService.verifyOtpAndLogin performs auto-login upon auto_linked', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({
            data: {
                success: true,
                status: 'auto_linked',
                doctor_id: 'doc-uuid-1',
                doctor_name: 'د. سامح',
                doctor_code: 'DOC-101',
                email: 'doc_101@orcadentallab.internal',
                session_token: 'secret-token-hex'
            },
            error: null
        } as any);

        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
            data: { user: { id: 'auth-user-1' } as any, session: {} as any },
            error: null
        });

        const res = await doctorAuthService.verifyOtpAndLogin('01011112222', '654321');
        expect(supabase.rpc).toHaveBeenCalledWith('verify_and_link_doctor', {
            p_phone: '01011112222',
            p_otp_code: '654321'
        });
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
            email: 'doc_101@orcadentallab.internal',
            password: 'secret-token-hex'
        });
        expect(res.status).toBe('auto_linked');
    });

    it('doctorAuthService.claimDoctorCode submits claim without exposing data', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'not_found', claim_token: 'verified-proof' }, error: null } as any);
        await doctorAuthService.verifyOtpAndLogin('01099998888', '654321');
        vi.mocked(supabase.rpc).mockResolvedValueOnce({
            data: {
                success: true,
                status: 'pending_approval',
                message: 'تم استلام طلب الربط بنجاح'
            },
            error: null
        } as any);

        const res = await doctorAuthService.claimDoctorCode('01099998888', 'DOC-8888');
        expect(supabase.rpc).toHaveBeenCalledWith('claim_doctor_code', {
            p_phone: '01099998888',
            p_doctor_code: 'DOC-8888',
            p_claim_token: 'verified-proof'
        });
        expect(res.success).toBe(true);
        expect(res.status).toBe('pending_approval');
    });
    it('rejects a claim for another phone even after verification', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'not_found', claim_token: 'proof' }, error: null } as any);
        await doctorAuthService.verifyOtpAndLogin('01099998888', '654321');
        vi.mocked(supabase.rpc).mockClear();
        expect((await doctorAuthService.claimDoctorCode('01011112222', 'DOC-1')).success).toBe(false);
        expect(supabase.rpc).not.toHaveBeenCalled();
    });
    it('fails when linked credentials are missing', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'auto_linked' }, error: null } as any);
        expect((await doctorAuthService.verifyOtpAndLogin('01011112222', '654321')).success).toBe(false);
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
    it('reports a failed session sign-in', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'auto_linked', email: 'test@example.com', session_token: 'token' }, error: null } as any);
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'Failed' } } as any);
        expect((await doctorAuthService.verifyOtpAndLogin('01011112222', '654321')).success).toBe(false);
    });
    it('registers a verified new center and opens its session', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'not_found', claim_token: 'registration-proof' }, error: null } as any);
        await doctorAuthService.verifyOtpAndLogin('01099998888', '654321');
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'auto_linked', email: 'new@local.test', session_token: 'new-session' }, error: null } as any);
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({ data: { user: {} as any, session: {} as any }, error: null });
        const profile = { name: ' New Center ', address: ' Clinic address ', isCenter: true, codeRegion: 'cairo' as const, branches: [{ name: 'Branch', address: 'Branch address', phone: '' }], doctors: [{ name: 'Doctor', phone: '' }] };
        expect((await doctorAuthService.registerNewDoctor('01099998888', profile)).success).toBe(true);
        expect(supabase.rpc).toHaveBeenLastCalledWith('register_verified_doctor', {
            p_phone: '01099998888', p_claim_token: 'registration-proof',
            p_profile: { name: 'New Center', address: 'Clinic address', is_center: true, code_region: 'cairo', branches: profile.branches, doctors: profile.doctors },
        });
        expect(supabase.auth.signInWithPassword).toHaveBeenLastCalledWith({ email: 'new@local.test', password: 'new-session' });
    });

    it('does not register an unverified phone', async () => {
        const result = await doctorAuthService.registerNewDoctor('01000000000', { name: 'Doctor', address: 'Clinic address', isCenter: false, codeRegion: 'cairo', branches: [], doctors: [] });
        expect(result.success).toBe(false);
        expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('blocks mock OTP in a production build without calling the database', async () => {
        vi.resetModules();
        vi.stubEnv('DEV', false);
        try {
            const { doctorAuthService: productionService } = await import('../../src/services/auth/doctorAuthService');
            expect((await productionService.requestOtp('01011112222')).success).toBe(false);
            expect(supabase.rpc).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
