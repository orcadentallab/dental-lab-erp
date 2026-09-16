/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getDesignerFeedbackDetails } from '../../src/services/supabase/orders';

const mockOrderEvents: any[] = [];
const mockOrderComments: any[] = [];

vi.mock('../../src/lib/supabase', () => {
    return {
        supabase: {
            from: (table: string) => {
                const filters: { field: string; op: string; value: any }[] = [];
                const chain: any = {
                    select: () => chain,
                    in: (field: string, values: any[]) => {
                        filters.push({ field, op: 'in', value: values });
                        return chain;
                    },
                    eq: (field: string, val: any) => {
                        filters.push({ field, op: 'eq', value: val });
                        return chain;
                    },
                    order: () => chain,
                    then: (onfulfilled: any) => {
                        const source = table === 'order_events' ? mockOrderEvents : mockOrderComments;
                        const data = source.filter(item => {
                            for (const f of filters) {
                                if (f.op === 'in' && !f.value.includes(item[f.field])) return false;
                                if (f.op === 'eq' && item[f.field] !== f.value) return false;
                            }
                            return true;
                        });
                        return Promise.resolve({ data, error: null }).then(onfulfilled);
                    },
                };
                return chain;
            },
        },
    };
});

describe('getDesignerFeedbackDetails', () => {
    beforeEach(() => {
        mockOrderEvents.length = 0;
        mockOrderComments.length = 0;
    });

    it('retrieves designer rejection reason and cause from pending order_events', async () => {
        const orderId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        mockOrderEvents.push({
            order_id: orderId,
            event_type: 'designer_rejection_requested',
            approval_status: 'pending',
            reason: 'Margin line is not visible',
            notes: 'Margin line is not visible',
            metadata: { causeCategory: 'prep', responsibleStage: 'design' },
            created_at: '2026-09-16T10:00:00Z',
        });

        const details = await getDesignerFeedbackDetails([orderId]);
        expect(details[orderId]).toBeDefined();
        expect(details[orderId].reason).toBe('Margin line is not visible');
        expect(details[orderId].causeCategory).toBe('prep');
        expect(details[orderId].responsibleStage).toBe('design');
    });

    it('falls back to order_comments for NeedDetails orders', async () => {
        const orderId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
        mockOrderComments.push({
            order_id: orderId,
            content: '[طلب تفاصيل]: يرجى تحديد خط الإنهاء بوضوح',
            created_at: '2026-09-16T10:30:00Z',
        });

        const details = await getDesignerFeedbackDetails([orderId]);
        expect(details[orderId]).toBeDefined();
        expect(details[orderId].reason).toBe('يرجى تحديد خط الإنهاء بوضوح');
    });

    it('handles empty order list gracefully', async () => {
        const details = await getDesignerFeedbackDetails([]);
        expect(details).toEqual({});
    });
});
