/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { reviewDesignerRejection } from '../../src/services/supabase/orders';
import { ValidationError } from '../../src/lib/errorHandler';

let rpcCalls: any[] = [];
let updateCalls: any[] = [];
let mockOrderRecord: any = null;

vi.mock('../../src/lib/supabase', () => {
    return {
        supabase: {
            rpc: vi.fn(async (fnName: string, args: any) => {
                rpcCalls.push({ fnName, args });
                if (fnName === 'get_order_workflow_v2_capabilities') {
                    return { data: { write: true }, error: null };
                }
                if (fnName === 'review_designer_rejection_v2') {
                    // Simulate DB RPC returning alreadyApplied: true without updating order (stale migration bug)
                    return { data: { alreadyApplied: true }, error: null };
                }
                return { data: null, error: null };
            }),
            from: (table: string) => {
                let pendingUpdate: any = null;
                const chain: any = {
                    select: () => chain,
                    update: (updates: any) => {
                        pendingUpdate = updates;
                        updateCalls.push({ table, updates });
                        return chain;
                    },
                    eq: () => chain,
                    single: async () => {
                        if (pendingUpdate && mockOrderRecord) {
                            mockOrderRecord = { ...mockOrderRecord, ...pendingUpdate };
                        }
                        return { data: mockOrderRecord, error: mockOrderRecord ? null : { code: 'PGRST116' } };
                    },
                    maybeSingle: async () => {
                        return { data: mockOrderRecord, error: null };
                    },
                };
                return chain;
            },
        },
    };
});

describe('reviewDesignerRejection', () => {
    beforeEach(() => {
        rpcCalls = [];
        updateCalls = [];
        mockOrderRecord = null;
    });

    it('requires notes for reject or request_details action', async () => {
        const orderId = crypto.randomUUID();
        await expect(reviewDesignerRejection(orderId, 'reject', ''))
            .rejects.toThrow(ValidationError);
        await expect(reviewDesignerRejection(orderId, 'request_details', '   '))
            .rejects.toThrow(ValidationError);
    });

    it('heals order to Approved when DB RPC returns without updating technicianStatus', async () => {
        const orderId = crypto.randomUUID();
        mockOrderRecord = {
            id: orderId,
            case_id: 'C01',
            patient_name: 'Test Patient',
            status: 'Under Design',
            technician_status: 'Rejected',
            design_status: 'returned',
            production_status: 'designing',
            order_items: [],
            order_comments: [],
        };

        await reviewDesignerRejection(orderId, 'reject', 'تم رفض طلب الرفض وإرجاع الحالة للمصمم');

        expect(rpcCalls.some(c => c.fnName === 'review_designer_rejection_v2')).toBe(true);
        expect(rpcCalls.some(c => c.fnName === 'update_order_atomic' && c.args.p_updates.technician_status === 'Approved')).toBe(true);
    });

    it('does not trigger self-healing if order is already Approved', async () => {
        const orderId = crypto.randomUUID();
        mockOrderRecord = {
            id: orderId,
            case_id: 'C02',
            patient_name: 'Test Patient 2',
            status: 'Under Design',
            technician_status: 'Approved',
            design_status: 'in_progress',
            production_status: 'designing',
            order_items: [],
            order_comments: [],
        };

        await reviewDesignerRejection(orderId, 'reject', 'تم رفض طلب الرفض وإرجاع الحالة للمصمم');

        expect(rpcCalls.some(c => c.fnName === 'review_designer_rejection_v2')).toBe(true);
        expect(rpcCalls.some(c => c.fnName === 'update_order_atomic')).toBe(false);
    });
});
