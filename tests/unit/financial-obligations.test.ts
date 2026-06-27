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
    const eqFilters: Record<string, any> = {};
    const neqFilters: Record<string, any> = {};
    const isNullFilters: Record<string, boolean> = {};
    const lastInserted: Record<string, any[]> = {};

    const chain = {
        select: () => chain,
        insert: (data: any) => {
            const table = currentTable;
            const items = Array.isArray(data) ? data : [data];
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
            return chain;
        },
        update: (data: any) => {
            const table = currentTable;
            if (!mockDatabase[table]) {
                mockDatabase[table] = [];
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
                    return { ...item, ...data };
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
    };

    const mockSupabase = {
        from: (table: string) => {
            currentTable = table;
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
import { updateOrderStatus, runFinancialCorrectionsAfterOrderUpdate } from '../../src/services/supabase/orders';
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
});
