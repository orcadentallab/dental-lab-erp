import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorManualAccessService, getSavedDoctorRequest } from '../../src/services/auth/doctorManualAccessService';
import { supabase } from '../../src/lib/supabase';

vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: vi.fn(), auth: { signInWithPassword: vi.fn() } } }));
const storage = new Map<string, string>();
beforeEach(() => {
    vi.clearAllMocks(); storage.clear();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null,
        setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
describe('manual review without phone OTP', () => {
    it('creates a random device capability and never signs in before approval', async () => {
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, request_id: 'request-1', status: 'pending' }, error: null } as never);
        await doctorManualAccessService.submit('01011112222', 'existing', '2003');
        const saved = getSavedDoctorRequest();
        expect(saved?.id).toBe('request-1');
        expect(saved?.token).toMatch(/^[a-f0-9]{64}$/);
        expect(supabase.rpc).toHaveBeenCalledWith('submit_doctor_manual_access', expect.objectContaining({ p_token: saved?.token, p_code: '2003' }));
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
    it('pending and rejected requests do not create a session', async () => {
        for (const status of ['pending', 'rejected']) {
            storage.set('orca.doctor.manual-access.v1', JSON.stringify({ id: 'request-1', token: 'a'.repeat(64) }));
            vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status }, error: null } as never);
            expect((await doctorManualAccessService.open()).status).toBe(status);
        }
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
    it('uses only approved credentials and removes them from its return value', async () => {
        storage.set('orca.doctor.manual-access.v1', JSON.stringify({ id: 'request-1', token: 'a'.repeat(64) }));
        vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { success: true, status: 'approved', email: 'device@local.test', session_token: 'secret' }, error: null } as never);
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
        expect(await doctorManualAccessService.open()).toEqual({ success: true, status: 'approved', message: undefined });
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'device@local.test', password: 'secret' });
    });
    it('a lost device secret cannot open a request by phone', async () => {
        expect((await doctorManualAccessService.open()).success).toBe(false);
        expect(supabase.rpc).not.toHaveBeenCalled();
    });
    it('does not submit if device storage is unavailable', async () => {
        vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Storage blocked'); } });
        await expect(doctorManualAccessService.submit('01011112222', 'existing')).rejects.toThrow('Storage blocked');
        expect(supabase.rpc).not.toHaveBeenCalled();
    });
});
