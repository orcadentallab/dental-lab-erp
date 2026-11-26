import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorPasswordService, normalizeDoctorLoginPhone } from '../../src/services/auth/doctorPasswordService';
import { supabase } from '../../src/lib/supabase';
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(), auth: { signInWithPassword: vi.fn() } } }));
beforeEach(() => vi.clearAllMocks());
describe('doctor password accounts', () => {
    it('normalizes Egyptian, Excel-stripped, Arabic and international login numbers', () => {
        for (const value of ['01012345678', '1012345678', '+20 101 234 5678', '٠١٠١٢٣٤٥٦٧٨']) expect(normalizeDoctorLoginPhone(value)).toBe('201012345678');
        expect(normalizeDoctorLoginPhone('00966501234567')).toBe('966501234567');
        expect(normalizeDoctorLoginPhone('00000')).toBeNull();
        expect(normalizeDoctorLoginPhone('phone01012345678')).toBeNull();
    });
    it('resolves a phone alias only with the password then uses native password login', async () => {
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { user: null, session: null }, error: null });
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, email: 'doctor@example.com' }, error: null } as never);
        await doctorPasswordService.login('01012345678', 'password-value');
        expect(supabase.rpc).toHaveBeenCalledWith('resolve_doctor_password_login', { p_phone: '201012345678', p_password: 'password-value' });
        expect(supabase.auth.signInWithPassword).toHaveBeenLastCalledWith({ email: 'doctor@example.com', password: 'password-value' });
        vi.mocked(supabase.rpc).mockClear();
        await doctorPasswordService.login(' Doctor@Example.com ', 'password-value');
        expect(supabase.auth.signInWithPassword).toHaveBeenLastCalledWith({ email: 'doctor@example.com', password: 'password-value' });
        expect(supabase.rpc).not.toHaveBeenCalled();
    });
    it('wrong phone password never resolves email or attempts a session exchange', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: false }, error: null } as never);
        expect((await doctorPasswordService.login('01012345678','wrong-password')).success).toBe(false);
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
    it('pending registrations never sign in or keep passwords in their returned data', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'pending' }, error: null } as never);
        const result = await doctorPasswordService.register('01012345678','doctor@example.com','password-value',
            { name: 'أحمد علي', address: 'عنوان العيادة', isCenter: false, codeRegion: 'cairo', branches: [], doctors: [] }, 'existing', 'claimed-id');
        expect(result).toEqual({ success: true, status: 'pending' });
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
    it('a new approved registration signs in with the chosen password', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'approved', doctor_code: '1062' }, error: null } as never);
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
        await doctorPasswordService.register('01012345678','doctor@example.com','chosen-password',
            { name: 'أحمد علي', address: 'عنوان العيادة', isCenter: false, codeRegion: 'cairo', branches: [], doctors: [] }, 'new');
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'doctor@example.com', password: 'chosen-password' });
    });
    it('a banned pending account gets an approval message', async () => {
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'user_banned' } } as never);
        expect((await doctorPasswordService.login('doctor@example.com','wrong-password')).message).toContain('مراجعة المعمل');
    });
});
