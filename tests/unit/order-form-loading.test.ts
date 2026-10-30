import { describe, expect, it } from 'vitest';
import { getOrderFormDesigners, loadOrderFormList } from '../../src/lib/orderFormLoading';
import type { User } from '../../src/services/db';

describe('order form list loading', () => {
    it('preserves the assigned designer when their current role is no longer designer', () => {
        const users: User[] = [
            { id: 'legacy', name: 'Saved lab designer', username: 'legacy', role: 'lab' },
            { id: 'other-lab', name: 'Other lab', username: 'other', role: 'lab' },
            { id: 'designer', name: 'Designer', username: 'design', role: 'designer' },
        ];
        expect(getOrderFormDesigners(users, 'legacy').map(user => user.id)).toEqual(['legacy', 'designer']);
        expect(getOrderFormDesigners(users).map(user => user.id)).toEqual(['designer']);
    });
    it('keeps successful lists available when another request fails', async () => {
        const results = await Promise.all([
            loadOrderFormList(async () => [{ id: 'doctor-1' }]),
            loadOrderFormList(async () => { throw new Error('Unavailable'); }),
        ]);
        expect(results[0]).toEqual({ data: [{ id: 'doctor-1' }], failed: false });
        expect(results[1]).toEqual({ data: [], failed: true });
    });

    it('distinguishes an empty list from a failed request', async () => {
        expect(await loadOrderFormList(async () => [])).toEqual({ data: [], failed: false });
    });
});
