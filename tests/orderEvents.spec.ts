import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    ORDER_EVENT_TYPES,
    isSensitiveOrderEventType,
} from '../src/constants/orderEvents';
import {
    getStatusChangeEventType,
    getDeliveryDateChangeSeverity,
    orderEventToDb,
    sortOrderEventsAscending,
    validateOrderEventInput,
} from '../src/services/supabase/orderEvents';
import type { OrderEvent } from '../src/services/db';

const orderId = '11111111-1111-4111-8111-111111111111';

test.describe('order event service validation', () => {
    test('maps a normal lifecycle event to database fields', () => {
        const dbEvent = orderEventToDb({
            orderId,
            eventType: ORDER_EVENT_TYPES.orderReady,
            oldValue: 'Under Production',
            newValue: 'Ready',
            changedBy: '22222222-2222-4222-8222-222222222222',
            actorRole: 'representative',
        });

        expect(dbEvent.order_id).toBe(orderId);
        expect(dbEvent.event_type).toBe('order_ready');
        expect(dbEvent.old_value).toBe('Under Production');
        expect(dbEvent.new_value).toBe('Ready');
        expect(dbEvent.actor_role).toBe('representative');
        expect(dbEvent.severity).toBe('info');
        expect(dbEvent.approval_status).toBe('none');
    });

    test('does not send non-UUID actor placeholders to UUID columns', () => {
        const dbEvent = orderEventToDb({
            orderId,
            eventType: ORDER_EVENT_TYPES.orderCreated,
            changedBy: 'system',
            approvedBy: 'unknown',
        });

        expect(dbEvent.changed_by).toBeNull();
        expect(dbEvent.approved_by).toBeNull();
    });

    test('rejects invalid severity and approval status', () => {
        expect(() => validateOrderEventInput({
            orderId,
            eventType: ORDER_EVENT_TYPES.orderReady,
            severity: 'urgent' as never,
        })).toThrow();

        expect(() => validateOrderEventInput({
            orderId,
            eventType: ORDER_EVENT_TYPES.orderReady,
            approvalStatus: 'done' as never,
        })).toThrow();
    });

    test('rejects sensitive events for non-admin actors when actor role is available', () => {
        expect(isSensitiveOrderEventType(ORDER_EVENT_TYPES.manualAllocationOverride)).toBe(true);

        expect(() => validateOrderEventInput({
            orderId,
            eventType: ORDER_EVENT_TYPES.manualAllocationOverride,
            actorRole: 'accountant',
        })).toThrow();

        expect(() => validateOrderEventInput({
            orderId,
            eventType: ORDER_EVENT_TYPES.manualAllocationOverride,
            actorRole: 'admin',
        })).not.toThrow();
    });

    test('sorts timeline events by changed_at ascending', () => {
        const events = [
            { id: '2', changedAt: '2026-05-02T10:00:00.000Z' },
            { id: '1', changedAt: '2026-05-01T10:00:00.000Z' },
            { id: '3', changedAt: '2026-05-03T10:00:00.000Z' },
        ] as OrderEvent[];

        expect(sortOrderEventsAscending(events).map(event => event.id)).toEqual(['1', '2', '3']);
    });

    test('maps status changes to lifecycle event types', () => {
        expect(getStatusChangeEventType('Try In')).toBe(ORDER_EVENT_TYPES.tryInStarted);
        expect(getStatusChangeEventType('Try In Approved')).toBe(ORDER_EVENT_TYPES.tryInApproved);
        expect(getStatusChangeEventType('Ready')).toBe(ORDER_EVENT_TYPES.orderReady);
        expect(getStatusChangeEventType('Delivered')).toBe(ORDER_EVENT_TYPES.orderDelivered);
        expect(getStatusChangeEventType('Under Production')).toBe(ORDER_EVENT_TYPES.productionStatusChanged);
    });

    test('maps delivery reverted event with warning metadata', () => {
        const dbEvent = orderEventToDb({
            orderId,
            eventType: ORDER_EVENT_TYPES.deliveryReverted,
            oldValue: 'Delivered',
            newValue: 'Ready',
            severity: 'warning',
            metadata: {
                previousActualDeliveryDate: '2026-05-08',
                revertedToStatus: 'Ready',
                revertedAt: '2026-05-09T10:00:00.000Z',
                shadowMode: true,
                shadowObligationVoidNeeded: true,
            },
        });

        expect(dbEvent.event_type).toBe('delivery_reverted');
        expect(dbEvent.severity).toBe('warning');
        expect(dbEvent.metadata).toMatchObject({
            previousActualDeliveryDate: '2026-05-08',
            revertedToStatus: 'Ready',
            shadowMode: true,
            shadowObligationVoidNeeded: true,
        });
    });

    test('maps delivery date changed event with business metadata', () => {
        const dbEvent = orderEventToDb({
            orderId,
            eventType: ORDER_EVENT_TYPES.deliveryDateChanged,
            oldValue: '2026-05-10',
            newValue: '2026-05-13',
            changedBy: '22222222-2222-4222-8222-222222222222',
            actorRole: 'representative',
            reason: 'Waiting for new scan',
            responsibilityParty: 'doctor',
            metadata: {
                oldDeliveryDate: '2026-05-10',
                newDeliveryDate: '2026-05-13',
                reasonCode: 'new_scan_requested',
                responsibleParty: 'doctor',
                source: 'orders_page',
                shadowMode: false,
            },
        });

        expect(dbEvent.event_type).toBe('delivery_date_changed');
        expect(dbEvent.old_value).toBe('2026-05-10');
        expect(dbEvent.new_value).toBe('2026-05-13');
        expect(dbEvent.responsibility_party).toBe('doctor');
        expect(dbEvent.metadata).toMatchObject({
            oldDeliveryDate: '2026-05-10',
            newDeliveryDate: '2026-05-13',
            reasonCode: 'new_scan_requested',
            responsibleParty: 'doctor',
            source: 'orders_page',
            shadowMode: false,
        });
    });

    test('marks internal delayed delivery date changes as warning only', () => {
        expect(getDeliveryDateChangeSeverity('2026-05-10', '2026-05-13', 'internal')).toBe('warning');
        expect(getDeliveryDateChangeSeverity('2026-05-10', '2026-05-13', 'doctor')).toBe('info');
        expect(getDeliveryDateChangeSeverity('2026-05-13', '2026-05-10', 'internal')).toBe('info');
    });
});

test.describe('delivery date change wiring', () => {
    const dashboardSource = readFileSync(resolve('src/pages/DashboardNew.tsx'), 'utf8');
    const orderEventsSource = readFileSync(resolve('src/services/supabase/orderEvents.ts'), 'utf8');
    const ordersSource = readFileSync(resolve('src/services/supabase/orders.ts'), 'utf8');
    const dbSource = readFileSync(resolve('src/services/db.ts'), 'utf8');
    const ordersPageSource = readFileSync(resolve('src/pages/Orders.tsx'), 'utf8');
    const accountsSource = readFileSync(resolve('src/pages/Accounts.tsx'), 'utf8');

    test('defines delivery date and waiting-on-doctor event constants', () => {
        expect(ORDER_EVENT_TYPES.deliveryDateChanged).toBe('delivery_date_changed');
        expect(ORDER_EVENT_TYPES.waitingOnDoctorStarted).toBe('waiting_on_doctor_started');
        expect(ORDER_EVENT_TYPES.waitingOnDoctorEnded).toBe('waiting_on_doctor_ended');
        expect(ORDER_EVENT_TYPES.newScanRequested).toBe('new_scan_requested');
        expect(ORDER_EVENT_TYPES.newScanReceived).toBe('new_scan_received');
        expect(ORDER_EVENT_TYPES.tryInSent).toBe('try_in_sent');
        expect(ORDER_EVENT_TYPES.deliveryReverted).toBe('delivery_reverted');
    });

    test('delivery date helper creates structured event data', () => {
        expect(orderEventsSource).toContain('export async function logDeliveryDateChanged');
        expect(orderEventsSource).toContain('eventType: ORDER_EVENT_TYPES.deliveryDateChanged');
        expect(orderEventsSource).toContain('oldDeliveryDate: input.oldDeliveryDate');
        expect(orderEventsSource).toContain('newDeliveryDate: input.newDeliveryDate');
        expect(orderEventsSource).toContain("source: input.source || 'update_order'");
        expect(orderEventsSource).toContain('shadowMode: false');
    });

    test('updateOrder centrally logs structured delivery date changes after persisted update', () => {
        expect(ordersSource).toContain('deliveryDateChangeEvent');
        expect(ordersSource).toContain('if (updates.deliveryDate !== undefined && !context.skipDeliveryDateEvent)');
        expect(ordersSource).toContain('const currentOrder = await getCurrentOrderForUpdate();');
        expect(ordersSource).toContain('oldDeliveryDate !== newDeliveryDate');
        expect(ordersSource).toContain('await logDeliveryDateChanged({');
        expect(ordersSource).toContain("source: context.deliveryDateChangeSource || 'update_order'");
    });

    test('updateOrder does not log delivery date changes for actual delivery date or Delivered status only', () => {
        expect(ordersSource).toContain('if (updates.actualDeliveryDate !== undefined) dbUpdates.actual_delivery_date');
        expect(ordersSource).toContain("if (updates.status === 'Delivered') {");
        expect(ordersSource).toContain('dbUpdates.actual_delivery_date = deliveredDate;');
        expect(ordersSource).not.toContain('dbUpdates.delivery_date = deliveredDate;');
    });

    test('db facade accepts delivery date change context', () => {
        expect(dbSource).toContain('async updateOrder(id: string, updates: Partial<Order>, context?:');
        expect(dbSource).toContain('deliveryDateChangeSource?: string | null;');
        expect(dbSource).toContain('return updateOrder(id, updates, context);');
    });

    test('dashboard delivery date editor relies on centralized updateOrder logging', () => {
        expect(dashboardSource).toContain('DELIVERY_DATE_AUDIT_PREFIX');
        expect(dashboardSource).toContain('const currentDeliveryDate = normalizeDeliveryDate(editingDeliveryOrder.deliveryDate);');
        expect(dashboardSource).toContain('const updatedOrder = await db.updateOrder(editingDeliveryOrder.id');
        expect(dashboardSource).toContain("deliveryDateChangeSource: 'dashboard'");
        expect(dashboardSource).toContain("deliveryDateResponsibilityParty: 'unknown'");
        expect(dashboardSource).not.toContain('await logDeliveryDateChanged({');
    });

    test('orders and accounts edits pass delivery date change source context when available', () => {
        expect(ordersPageSource).toContain("deliveryDateChangeSource: 'orders_page'");
        expect(accountsSource).toContain("deliveryDateChangeSource: 'accounts_statement_edit'");
    });
});

test.describe('delivered implied ready and reversal wiring', () => {
    const ordersSource = readFileSync(resolve('src/services/supabase/orders.ts'), 'utf8');

    test('direct Delivered events include implied final ready metadata only when old status was not final ready', () => {
        expect(ordersSource).toContain('const autoMarkedReady = isNowDelivered && !wasDelivered && !isFinalReady(currentOrder);');
        expect(ordersSource).toContain('autoMarkedReady: true');
        expect(ordersSource).toContain('readyAt: deliveredAt');
        expect(ordersSource).toContain('impliedFinalReady: true');
    });

    test('Delivered reversals log delivery_reverted as warning with shadow obligation marker', () => {
        expect(ordersSource).toContain('const isDeliveredReversal = updatedOrder ? wasDelivered && !isNowDelivered : false;');
        expect(ordersSource).toContain('ORDER_EVENT_TYPES.deliveryReverted');
        expect(ordersSource).toContain("severity: isDeliveredReversal ? 'warning' : 'info'");
        expect(ordersSource).toContain('previousActualDeliveryDate: currentOrder.actualDeliveryDate || null');
        expect(ordersSource).toContain('revertedToStatus: newStatus');
        expect(ordersSource).toContain('shadowMode: true');
        expect(ordersSource).toContain('shadowObligationVoidNeeded: true');
    });
});

test.describe('order events migration', () => {
    const migration = readFileSync(resolve('supabase/migrations/080_order_events.sql'), 'utf8');

    test('creates order_events with validation checks and indexes', () => {
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS order_events');
        expect(migration).toContain("CHECK (severity IN ('info', 'warning', 'critical'))");
        expect(migration).toContain("CHECK (approval_status IN ('none', 'pending', 'approved', 'rejected'))");
        expect(migration).toContain('idx_order_events_order_id_changed_at');
        expect(migration).toContain('ON order_events(order_id, changed_at ASC)');
    });

    test('keeps order_events append-only for client policies', () => {
        expect(migration).toContain('FOR SELECT');
        expect(migration).toContain('FOR INSERT');
        expect(migration).not.toContain('FOR UPDATE');
        expect(migration).not.toContain('FOR DELETE');
    });

    test('restricts read access and admin-only sensitive inserts', () => {
        expect(migration).toContain("get_my_role() IN ('admin', 'accountant', 'representative')");
        expect(migration).toContain("get_my_role() = 'admin'");
        expect(migration).toContain("'manual_allocation_override'");
        expect(migration).toContain("'payment_allocated'");
        expect(migration).toContain("'order_reopened'");
    });
});
