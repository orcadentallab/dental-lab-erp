import { describe, expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn(() => { throw new Error('retired registration must not query'); }) }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from } }));
import { getOrdersForAccountingRegistration, getUnregisteredCasesCount } from '../../src/services/supabase/orders';

describe('retired partner registration queries', () => {
    it('returns empty work and zero badges without downloading historical orders', async () => {
        expect(await getOrdersForAccountingRegistration()).toEqual([]);
        expect(await getUnregisteredCasesCount()).toBe(0);
        expect(from).not.toHaveBeenCalled();
    });
});
