/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Setup Mock Database State inside the hoisted mock factory
vi.mock('../../src/lib/supabase', () => {
    const mockDatabase: Record<string, any[]> = {
        orders: [],
        financial_obligations: [],
        order_events: [],
        users: [],
        entity_billing_settings: [],
    };

    let currentTable = '';
    let insertData: any = null;
    let updateData: any = null;
    const eqFilters: Record<string, any> = {};
    const neqFilters: Record<string, any> = {};
    const isNullFilters: Record<string, boolean> = {};
    const lastInserted: Record<string, any[]> = {};

    const executePendingMutation = () => {
        const table = currentTable;
        if (insertData) {
            const items = Array.isArray(insertData) ? insertData : [insertData];
            const inserted = items.map(item => ({
                id: item.id || 'f1f1f1f1-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                created_at: new Date().toISOString(),
                ...item,
            }));
            if (!mockDatabase[table]) {
                mockDatabase[table] = [];
            }
            mockDatabase[table].push(...inserted);
            if (!lastInserted[table]) {
                lastInserted[table] = [];
            }
            lastInserted[table].push(...inserted);
            insertData = null;
        }
        if (updateData) {
            if (!mockDatabase[table]) {
                mockDatabase[table] = [];
            }
            if (table === 'financial_obligations' && eqFilters.id === 'fail-void-id') {
                updateData = null;
                throw new Error('Simulated database error');
            }
            mockDatabase[table] = mockDatabase[table].map(item => {
                let matches = true;
                for (const [key, val] of Object.entries(eqFilters)) {
                    if (item[key] !== val) matches = false;
                }
                for (const [key, val] of Object.entries(neqFilters)) {
                    if (item[key] === val) matches = false;
                }
                if (matches) {
                    return { ...item, ...updateData };
                }
                return item;
            });
            const updated = mockDatabase[table].filter(item => {
                let matches = true;
                for (const [key, val] of Object.entries(eqFilters)) {
                    if (item[key] !== val) matches = false;
                }
                for (const [key, val] of Object.entries(neqFilters)) {
                    if (item[key] === val) matches = false;
                }
                return matches;
            });
            if (!lastInserted[table]) {
                lastInserted[table] = [];
            }
            lastInserted[table].push(...updated);
            updateData = null;
        }
    };

    const chain = {
        select: () => chain,
        insert: (data: any) => {
            insertData = data;
            return chain;
        },
        update: (data: any) => {
            updateData = data;
            return chain;
        },
        eq: (field: string, value: any) => {
            eqFilters[field] = value;
            return chain;
        },
        neq: (field: string, value: any) => {
            neqFilters[field] = value;
            return chain;
        },
        is: (field: string, value: any) => {
            if (value === null) {
                isNullFilters[field] = true;
            }
            return chain;
        },
        in: () => chain,
        limit: () => chain,
        single: async () => {
            executePendingMutation();
            const table = currentTable;
            if (lastInserted[table] && lastInserted[table].length > 0) {
                const res = lastInserted[table].shift();
                return { data: res, error: null };
            }
            const match = mockDatabase[table]?.find(item => {
                for (const [key, val] of Object.entries(eqFilters)) {
                    if (item[key] !== val) return false;
                }
                for (const [key, val] of Object.entries(neqFilters)) {
                    if (item[key] === val) return false;
                }
                for (const [key] of Object.entries(isNullFilters)) {
                    if (item[key] !== null && item[key] !== undefined) return false;
                }
                return true;
            });
            return { data: match || null, error: match ? null : new Error('Not found') };
        },
        maybeSingle: async () => {
            executePendingMutation();
            const table = currentTable;
            if (lastInserted[table] && lastInserted[table].length > 0) {
                const res = lastInserted[table].shift();
                return { data: res, error: null };
            }
            const match = mockDatabase[table]?.find(item => {
                for (const [key, val] of Object.entries(eqFilters)) {
                    if (item[key] !== val) return false;
                }
                for (const [key, val] of Object.entries(neqFilters)) {
                    if (item[key] === val) return false;
                }
                for (const [key] of Object.entries(isNullFilters)) {
                    if (item[key] !== null && item[key] !== undefined) return false;
                }
                return true;
            });
            return { data: match || null, error: null };
        },
        then: (onfulfilled: any) => {
            executePendingMutation();
            const table = currentTable;
            const matches = mockDatabase[table]?.filter(item => {
                for (const [key, val] of Object.entries(eqFilters)) {
                    if (item[key] !== val) return false;
                }
                for (const [key, val] of Object.entries(neqFilters)) {
                    if (item[key] === val) return false;
                }
                for (const [key] of Object.entries(isNullFilters)) {
                    if (item[key] !== null && item[key] !== undefined) return false;
                }
                return true;
            }) || [];
            return Promise.resolve({ data: matches, error: null }).then(onfulfilled);
        },
    };

    const mockSupabase = {
        from: (table: string) => {
            currentTable = table;
            insertData = null;
            updateData = null;
            if (!mockDatabase[table]) {
                mockDatabase[table] = [];
            }
            // Reset filters for new query
            for (const key of Object.keys(eqFilters)) delete eqFilters[key];
            for (const key of Object.keys(neqFilters)) delete neqFilters[key];
            for (const key of Object.keys(isNullFilters)) delete isNullFilters[key];
            return chain;
        },
        rpc: (name: string, args: any) => {
            if (name === 'update_order_atomic') {
                const id = args.p_order_id;
                const updates = args.p_updates;
                mockDatabase['orders'] = mockDatabase['orders'].map(order => {
                    if (order.id === id) {
                        return { ...order, ...updates };
                    }
                    return order;
                });
            } else if (name === 'apply_order_rejection_atomic') {
                const id = args.p_order_id;
                mockDatabase['orders'] = mockDatabase['orders'].map(order => {
                    if (order.id !== id) return order;
                    const doctorAmount = args.p_doctor_decision === 'zero'
                        ? 0
                        : args.p_doctor_decision === 'custom_amount'
                            ? args.p_custom_doctor_amount
                            : order.total_price;
                    return {
                        ...order,
                        status: args.p_target_status,
                        production_status: 'not_started',
                        issue_state: args.p_issue_state,
                        rejected_doctor_amount: doctorAmount,
                        rejection_doctor_decision: args.p_doctor_decision,
                        rejection_financial_review_status: args.p_doctor_decision === 'decide_later'
                            ? 'pending'
                            : 'resolved',
                        rejected_lab_cost: null,
                        rejected_designer_cost: null,
                    };
                });
            }
            return Promise.resolve({ data: null, error: null });
        },
    };

    return {
        supabase: mockSupabase,
        _mockDatabase: mockDatabase,
    };
});

// Import supabase from the mock to get access to _mockDatabase
import { _mockDatabase } from '../../src/lib/supabase';
import { updateOrderStatus, runFinancialCorrectionsAfterOrderUpdate, updateOrder, deleteOrder } from '../../src/services/supabase/orders';
import { OBLIGATION_DIRECTIONS } from '../../src/constants/financialObligations';
import { BILLING_ENTITY_TYPES } from '../../src/constants/billingSettings';

describe('Financial Obligations Integration Tests', () => {
    beforeEach(() => {
        // Reset mock database before each test
        const db = _mockDatabase as Record<string, any[]>;
        db.orders = [];
        db.financial_obligations = [];
        db.order_events = [];
        db.users = [];
        db.entity_billing_settings = [];
    });

    it('Scenario 4b: should create a doctor receivable obligation when status changes from Ready to Delivered', async () => {
        const db = _mockDatabase as Record<string, any[]>;

        // 1. Seed order in "Ready" status (with valid v4 UUIDs)
        const orderId = 'a1a1a1a1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd2d2d2d2-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        
        const initialOrder = {
            id: orderId,
            doctor_id: doctorId,
            status: 'Ready',
            total_price: 1500,
            delivery_type: 'final',
            workflow_type: 'full',
            is_archived: false,
        };
        
        db.orders.push(initialOrder);

        // 2. Transition order status from 'Ready' to 'Delivered'
        const updatedOrder = await updateOrderStatus(orderId, 'Delivered', {
            userId: 'u3u3u3u3-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            userName: 'Representative Test',
            actorRole: 'representative',
        });

        expect(updatedOrder).toBeDefined();
        expect(updatedOrder?.status).toBe('Delivered');

        // 3. Verify that a financial_obligation record was created
        const obligations = db.financial_obligations;
        expect(obligations).toHaveLength(1);
        
        const doctorObligation = obligations[0];
        expect(doctorObligation.order_id).toBe(orderId);
        expect(doctorObligation.entity_type).toBe(BILLING_ENTITY_TYPES.doctor);
        expect(doctorObligation.entity_id).toBe(doctorId);
        expect(doctorObligation.direction).toBe(OBLIGATION_DIRECTIONS.receivable);
        expect(doctorObligation.gross_amount).toBe(1500);
        expect(doctorObligation.status).toBe('unpaid');
        expect(doctorObligation.voided_at).toBeUndefined();
    });

    it('Scenario 4c: runFinancialCorrectionsAfterOrderUpdate should be idempotent', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = 'a1a1a1a1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd2d2d2d2-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        // 1. Seed initial order and its corresponding active obligation
        const previousOrder = {
            id: orderId,
            doctorId: doctorId,
            doctor_id: doctorId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            deliveryType: 'final',
            delivery_type: 'final',
            workflowType: 'full',
            workflow_type: 'full',
            isArchived: false,
            is_archived: false,
        };

        const activeObligation = {
            id: 'o9o9o9o9-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: BILLING_ENTITY_TYPES.doctor,
            entity_id: doctorId,
            direction: OBLIGATION_DIRECTIONS.receivable,
            gross_amount: 1500,
            status: 'unpaid',
            voided_at: null,
        };

        db.orders.push(previousOrder);
        db.financial_obligations.push(activeObligation);

        // 2. Prepare updated order with changed doctor amount (e.g. price correction to 1800)
        const updatedOrder = {
            ...previousOrder,
            totalPrice: 1800,
            total_price: 1800,
        };

        // 3. Run corrections first time
        await runFinancialCorrectionsAfterOrderUpdate(
            previousOrder as any,
            updatedOrder as any,
            'u3u3u3u3-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            'price_correction',
            'Corrected case price'
        );

        // We expect the original obligation to be updated or corrected
        const obligationsAfterFirstRun = [...db.financial_obligations];
        
        // 4. Run corrections a second time (idempotency check)
        await runFinancialCorrectionsAfterOrderUpdate(
            previousOrder as any,
            updatedOrder as any,
            'u3u3u3u3-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            'price_correction',
            'Corrected case price'
        );

        const obligationsAfterSecondRun = [...db.financial_obligations];

        // The state should be exactly the same after the second run
        expect(obligationsAfterSecondRun).toEqual(obligationsAfterFirstRun);
    });

    it('applies a representative custom doctor amount immediately when rejecting an order', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = 'abababab-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        db.orders.push({
            id: orderId,
            case_id: 'CASE-REJECT-1',
            doctor_id: 'd2d2d2d2-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            patient_name: 'Test',
            status: 'Delivered',
            total_price: 2_000,
            discount: 0,
            shade: '',
            delivery_date: '2026-07-24',
            cost: 800,
            priority: 'Normal',
            workflow_type: 'full',
            production_status: 'final_delivered',
            issue_state: 'none',
            is_archived: false,
            is_deleted: false,
            items: [],
            comments: [],
        });

        const updated = await updateOrderStatus(orderId, 'Doctor Rejected', {
            userId: 'u3u3u3u3-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            userName: 'Representative Test',
            actorRole: 'representative',
            rejectionDoctorDecision: 'custom_amount',
            rejectedDoctorAmount: 750,
            rejectionFinancialReviewStatus: 'resolved',
            rejectedLabCostStatus: 'pending',
            rejectedDesignerCostStatus: 'not_applicable',
        });

        expect(updated?.status).toBe('Doctor Rejected');
        expect(updated?.rejectionDoctorDecision).toBe('custom_amount');
        expect(updated?.rejectedDoctorAmount).toBe(750);
        expect(updated?.rejectionFinancialReviewStatus).toBe('resolved');
        expect(updated?.rejectedLabCost).toBeUndefined();
    });

    it('Scenario: should void all obligations (including multiple lab rejections) on order deletion, even if one fails', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = '11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const supplierId1 = 's1s1s1s1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const supplierId2 = 's2s2s2s2-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const designerId = 'e1e1e1e1-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        // 1. Seed order and active obligations
        const order = {
            id: orderId,
            doctorId,
            doctor_id: doctorId,
            supplierId: supplierId1,
            supplier_id: supplierId1,
            designerId,
            designer_id: designerId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            isDeleted: false,
            is_deleted: false,
            isArchived: false,
            is_archived: false,
        };

        const docObligation = {
            id: 'fa111111-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'doctor',
            entity_id: doctorId,
            direction: 'receivable',
            trigger_type: 'doctor_delivered',
            source: 'order',
            gross_amount: 1500,
            status: 'unpaid',
        };

        const supplierObligation = {
            id: 'fa222222-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'external_lab',
            entity_id: supplierId1,
            direction: 'payable',
            trigger_type: 'external_lab_ready',
            source: 'order',
            gross_amount: 800,
            status: 'unpaid',
        };

        // First rejection cost obligation (this one will be voided successfully)
        const rejectionObligation1 = {
            id: 'fa333333-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'external_lab',
            entity_id: supplierId1,
            direction: 'payable',
            trigger_type: 'external_lab_issue_settlement',
            source: 'order',
            gross_amount: 200,
            status: 'unpaid',
        };

        // Second rejection cost obligation (this one will fail to void)
        const rejectionObligation2 = {
            id: 'fail-void-id',
            order_id: orderId,
            entity_type: 'external_lab',
            entity_id: supplierId2,
            direction: 'payable',
            trigger_type: 'external_lab_issue_settlement',
            source: 'order',
            gross_amount: 200,
            status: 'unpaid',
        };

        const designerObligation = {
            id: 'fa444444-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'designer',
            entity_id: designerId,
            direction: 'payable',
            trigger_type: 'designer_approved',
            source: 'order',
            gross_amount: 100,
            status: 'unpaid',
        };

        db.orders.push(order);
        db.financial_obligations.push(
            docObligation,
            supplierObligation,
            rejectionObligation1,
            rejectionObligation2,
            designerObligation
        );

        // 2. Delete the order
        await deleteOrder(orderId);
        const updated = db.orders.find(o => o.id === orderId);
        expect(updated?.is_deleted).toBe(true);

        // 3. Verify obligations status
        const fetchObligation = (id: string) => db.financial_obligations.find(o => o.id === id);

        // Doctor, Supplier Ready, Designer, Rejection 1 should be voided
        expect(fetchObligation(docObligation.id)?.status).toBe('void');
        expect(fetchObligation(supplierObligation.id)?.status).toBe('void');
        expect(fetchObligation(rejectionObligation1.id)?.status).toBe('void');
        expect(fetchObligation(designerObligation.id)?.status).toBe('void');

        // Rejection 2 failed to void and should still be unpaid
        expect(fetchObligation(rejectionObligation2.id)?.status).toBe('unpaid');
    });

    it('Scenario: rejection obligation should remain active when status changes but order is NOT deleted', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = '22222222-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const supplierId = 's1s1s1s1-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        const order = {
            id: orderId,
            doctorId,
            doctor_id: doctorId,
            supplierId,
            supplier_id: supplierId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            isDeleted: false,
            is_deleted: false,
        };

        const rejectionObligation = {
            id: 'fa555555-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'external_lab',
            entity_id: supplierId,
            direction: 'payable',
            trigger_type: 'external_lab_issue_settlement',
            source: 'order',
            gross_amount: 200,
            status: 'unpaid',
        };

        db.orders.push(order);
        db.financial_obligations.push(rejectionObligation);

        // Update some fields (but NOT deleting it)
        const updated = await updateOrder(orderId, { totalPrice: 1600 });
        expect(updated?.totalPrice).toBe(1600);
        expect(updated?.isDeleted).toBe(false);

        // Rejection obligation should still be active (unpaid)
        const activeOb = db.financial_obligations.find(o => o.id === rejectionObligation.id);
        expect(activeOb?.status).toBe('unpaid');
    });

    it('Scenario: partially paid obligation reallocation on deletion does not drop payment', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = '33333333-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        const order = {
            id: orderId,
            doctorId,
            doctor_id: doctorId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            isDeleted: false,
            is_deleted: false,
        };

        const docObligation = {
            id: 'fa666666-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'doctor',
            entity_id: doctorId,
            direction: 'receivable',
            trigger_type: 'doctor_delivered',
            source: 'order',
            gross_amount: 1500,
            allocated_amount: 500,
            remaining_amount: 1000,
            status: 'partially_paid',
        };

        // Payment allocations mock
        db.payment_allocations = [
            {
                id: 'alloc-1',
                obligation_id: docObligation.id,
                amount: 500,
                status: 'active',
            }
        ];

        db.orders.push(order);
        db.financial_obligations.push(docObligation);

        // Delete order
        await deleteOrder(orderId);

        // Verify obligation is voided
        const ob = db.financial_obligations.find(o => o.id === docObligation.id);
        expect(ob?.status).toBe('void');

        // Verify payment allocations are reversed
        const alloc = db.payment_allocations.find(a => a.id === 'alloc-1');
        expect(alloc?.status).toBe('reversed');
    });

    it('Scenario: should NOT void obligations if order is archived', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = '44444444-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        const order = {
            id: orderId,
            doctorId,
            doctor_id: doctorId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            isArchived: false,
            is_archived: false,
            isDeleted: false,
            is_deleted: false,
        };

        const docObligation = {
            id: 'fa777777-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'doctor',
            entity_id: doctorId,
            direction: 'receivable',
            trigger_type: 'doctor_delivered',
            source: 'order',
            gross_amount: 1500,
            status: 'unpaid',
        };

        db.orders.push(order);
        db.financial_obligations.push(docObligation);

        // Archive the order
        await updateOrder(orderId, { isArchived: true });

        // Verify obligation is still unpaid/active
        const ob = db.financial_obligations.find(o => o.id === docObligation.id);
        expect(ob?.status).toBe('unpaid');
    });

    it('Scenario: restore-from-archive should NOT touch/affect obligations', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = '55555555-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        const order = {
            id: orderId,
            doctorId,
            doctor_id: doctorId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            isArchived: true,
            is_archived: true,
            isDeleted: false,
            is_deleted: false,
        };

        const docObligation = {
            id: 'fa888888-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'doctor',
            entity_id: doctorId,
            direction: 'receivable',
            trigger_type: 'doctor_delivered',
            source: 'order',
            gross_amount: 1500,
            status: 'unpaid',
        };

        db.orders.push(order);
        db.financial_obligations.push(docObligation);

        // Restore from archive
        await updateOrder(orderId, { isArchived: false });

        // Verify obligation remains unpaid/active
        const ob = db.financial_obligations.find(o => o.id === docObligation.id);
        expect(ob?.status).toBe('unpaid');
    });

    it('Scenario: restore-from-delete should NOT attempt obligation recreation (stays voided, gap documented)', async () => {
        const db = _mockDatabase as Record<string, any[]>;
        const orderId = '66666666-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        const doctorId = 'd1d1d1d1-bbbb-4ccc-8ddd-eeeeeeeeeeee';

        const order = {
            id: orderId,
            doctorId,
            doctor_id: doctorId,
            status: 'Delivered',
            totalPrice: 1500,
            total_price: 1500,
            isDeleted: true,
            is_deleted: true,
        };

        const docObligation = {
            id: 'fa999999-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            order_id: orderId,
            entity_type: 'doctor',
            entity_id: doctorId,
            direction: 'receivable',
            trigger_type: 'doctor_delivered',
            source: 'order',
            gross_amount: 1500,
            status: 'void',
        };

        db.orders.push(order);
        db.financial_obligations.push(docObligation);

        // Restore from delete (isDeleted -> false)
        await updateOrder(orderId, { isDeleted: false });

        // Verify obligation remains voided (as un-voiding/recreation is out of scope for TD-002)
        const ob = db.financial_obligations.find(o => o.id === docObligation.id);
        expect(ob?.status).toBe('void');
    });
});
