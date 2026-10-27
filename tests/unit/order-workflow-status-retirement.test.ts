import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serviceSource = readFileSync(
    resolve('src/services/supabase/orderWorkflow.ts'),
    'utf8',
);
const ordersSource = readFileSync(
    resolve('src/services/supabase/orders.ts'),
    'utf8',
);

function getFunctionSource(name: string, nextName: string): string {
    const start = serviceSource.indexOf(`export async function ${name}`);
    const end = serviceSource.indexOf(`export async function ${nextName}`, start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return serviceSource.slice(start, end);
}

function getOrdersFunctionSource(name: string, nextName: string): string {
    const start = ordersSource.indexOf(`export async function ${name}`);
    const end = ordersSource.indexOf(`export async function ${nextName}`, start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return ordersSource.slice(start, end);
}

describe('order workflow legacy status retirement', () => {
    it('changes production status without writing the legacy status column', () => {
        const functionSource = getFunctionSource(
            'changeProductionStatus',
            'changeIssueState',
        );

        expect(functionSource).toContain('productionStatus: newStatus');
        expect(functionSource).not.toContain('status: targetLegacyStatus');
        expect(functionSource).not.toContain('targetLegacyStatus');
        expect(functionSource).not.toContain('mapProductionStatusToLegacy');
    });

    it('changes issue state through V2 axes without writing legacy status', () => {
        const functionSource = getFunctionSource(
            'changeIssueState',
            'adminCorrectOrderIssueState',
        );

        expect(functionSource).toContain('issueState: newIssueState');
        expect(functionSource).toContain('productionStatus: targetProductionStatus');
        expect(functionSource).not.toContain('status: targetLegacyStatus');
        expect(functionSource).not.toContain('targetLegacyStatus');
    });

    it('routes non-terminal centralized status updates through V2 axes only', () => {
        const functionSource = getOrdersFunctionSource(
            'updateOrderStatus',
            'getPendingDesignerRejectionCause',
        );
        const updatePayloadSetup = functionSource.slice(
            functionSource.indexOf('// Build V2-axis updates'),
            functionSource.indexOf('// Explicitly set productionStatus'),
        );

        expect(functionSource).toContain('updates.productionStatus');
        expect(updatePayloadSetup).not.toContain('status: newStatus');
        expect(functionSource).not.toContain('currentOrder.status !== newStatus');
    });

    it('does not write legacy Under Design during design review fallbacks', () => {
        const reviewSource = getOrdersFunctionSource(
            'reviewDesignerRejection',
            'rejectOrderFromTechStatus',
        );

        expect(reviewSource).toContain("productionStatus: 'designing'");
        expect(reviewSource).not.toContain("status: 'Under Design'");
    });

    it('filters orders through V2 axes without reading the legacy status column', () => {
        const functionSource = getOrdersFunctionSource(
            'getOrders',
            'getDashboardActiveOrders',
        );

        expect(functionSource).toContain('getOrderStatusV2Filter(filters.status)');
        expect(functionSource).toContain("production_status.neq.final_delivered,issue_state.neq.none");
        expect(functionSource).not.toContain("query.eq('status'");
        expect(functionSource).not.toContain("query.neq('status'");
    });

    it('loads active dashboard orders from V2 terminal-state rules', () => {
        const functionSource = getOrdersFunctionSource(
            'getDashboardActiveOrders',
            'getRepresentativeMonthlySales',
        );

        expect(functionSource).toContain('issue_state.neq.cancelled');
        expect(functionSource).toContain('production_status.neq.final_delivered');
        expect(functionSource).toContain('issue_state.neq.none');
        expect(functionSource).not.toContain('status.not.in');
    });

    it('loads designer dashboard orders from V2 issue and production axes', () => {
        const functionSource = getOrdersFunctionSource(
            'getDesignerDashboardOrders',
            'getAllOrdersUnpaginated',
        );

        expect(functionSource).toContain(".not('issue_state', 'in', '(\"doctor_rejected\",\"lab_rejected\",\"cancelled\",\"redo\")')");
        expect(functionSource).toContain("production_status.neq.final_delivered,issue_state.neq.none");
        expect(functionSource).not.toContain(".not('status'");
    });

    it('calculates legacy doctor cost totals from V2 issue states', () => {
        const functionSource = getOrdersFunctionSource(
            'getDoctorTotalCost',
            'getOrderIssues',
        );

        expect(functionSource).toContain(".not('issue_state', 'in', '(\"doctor_rejected\",\"lab_rejected\",\"cancelled\",\"redo\")')");
        expect(functionSource).not.toContain(".neq('status'");
    });

    it('rejects generic legacy status writes and derives compatibility history from V2 axes', () => {
        const functionSource = getOrdersFunctionSource(
            'updateOrder',
            'updateOrderStatus',
        );

        expect(functionSource).toContain("if (updates.status !== undefined)");
        expect(functionSource).toContain('deriveOrderDisplayStatusV2(');
        expect(functionSource).toContain('dbUpdates.status_history = history');
        expect(functionSource).not.toContain('dbUpdates.status = updates.status');
        expect(functionSource).not.toContain('currentOrder.status !== updates.status');
        expect(functionSource).not.toContain('allowStatusChange');
    });

    it('does not send a legacy rejection target to the compatibility RPC', () => {
        const functionSource = getOrdersFunctionSource(
            'updateOrderStatus',
            'getPendingDesignerRejectionCause',
        );
        const rejectionCall = functionSource.slice(
            functionSource.indexOf("supabase.rpc('apply_order_rejection_atomic'"),
            functionSource.indexOf('if (error)', functionSource.indexOf("supabase.rpc('apply_order_rejection_atomic'")),
        );

        expect(rejectionCall).not.toContain('p_target_status');
        expect(rejectionCall).toContain('p_issue_state');
    });

    it('uses the explicit intake axis for Pending Review business decisions', () => {
        const dashboardSource = readFileSync(resolve('src/pages/DashboardNew.tsx'), 'utf8');
        const cardSource = readFileSync(resolve('src/components/orders/OrderCard.tsx'), 'utf8');
        const transitionsSource = readFileSync(resolve('src/constants/workflowTransitions.ts'), 'utf8');

        expect(dashboardSource).toContain("o.intakeState === 'pending_review'");
        expect(dashboardSource).not.toContain("o.status === 'Pending Review'");
        expect(cardSource).toContain("order.intakeState === 'pending_review'");
        expect(cardSource).not.toContain("order.status === 'Pending Review'");
        expect(transitionsSource).toContain("orderContext.intakeState === 'pending_review'");
        expect(transitionsSource).not.toContain("orderContext.status === 'Pending Review'");
    });

    it('uses production_status only when hiding delivered orders from active production stages', () => {
        const productionSource = readFileSync(resolve('src/services/supabase/production.ts'), 'utf8');
        const activeStagesStart = productionSource.indexOf('export async function getActiveStagesForOrders');
        const activeStagesSource = productionSource.slice(activeStagesStart);

        expect(activeStagesStart).toBeGreaterThanOrEqual(0);
        expect(activeStagesSource).toContain("order?.production_status === 'final_delivered'");
        expect(activeStagesSource).not.toContain("orders ( status, production_status, is_deleted )");
        expect(activeStagesSource).not.toContain("order?.status === 'Delivered'");
        expect(activeStagesSource).not.toContain("order?.status === 'Completed'");
    });

    it('loads ready-to-pack orders from V2 production states only', () => {
        const shippingSource = readFileSync(resolve('src/services/supabase/shippingService.ts'), 'utf8');
        const readyStart = shippingSource.indexOf('async getReadyToPackOrders');
        const readyEnd = shippingSource.indexOf('async getShipments', readyStart);
        const readySource = shippingSource.slice(readyStart, readyEnd);

        expect(readyStart).toBeGreaterThanOrEqual(0);
        expect(readyEnd).toBeGreaterThan(readyStart);
        expect(readySource).toContain(".in('production_status', ['final_ready', 'try_in_ready'])");
        expect(readySource).not.toContain('status.eq.Ready');
    });

    it.each([
        'src/pages/Orders.tsx',
        'src/components/orders/WorkflowActionBar.tsx',
        'src/components/orders/RepEditModal.tsx',
        'src/components/orders/OrderList.tsx',
        'src/components/orders/OrderBoard.tsx',
    ])('keeps %s workflow decisions free of direct legacy order status reads', (path) => {
        const source = readFileSync(resolve(path), 'utf8');

        expect(source).not.toMatch(/\b(?:order|fullEditingOrder)\.status\b/);
    });

    it('does not serialize the legacy status column from the TypeScript order writer', () => {
        const orderToDbStart = ordersSource.indexOf('function orderToDb');
        const orderToDbEnd = ordersSource.indexOf('// Filter options for getOrders', orderToDbStart);
        const orderToDbSource = ordersSource.slice(orderToDbStart, orderToDbEnd);

        expect(orderToDbStart).toBeGreaterThanOrEqual(0);
        expect(orderToDbEnd).toBeGreaterThan(orderToDbStart);
        expect(orderToDbSource).not.toContain('status: order.status');
    });

    it('does not hydrate finance or runtime decisions from the legacy status column', () => {
        expect(ordersSource).not.toContain('status: dbOrder.status');
        expect(ordersSource).not.toContain('status: row.status as Order');
        expect(ordersSource).not.toContain('status: (d.status || undefined) as Order');
        expect(ordersSource).not.toContain(".select('id, case_id, status, original_order_id')");
    });

    it('keeps workflow transitions and open production queues independent of legacy order status', () => {
        const transitionsSource = readFileSync(resolve('src/constants/workflowTransitions.ts'), 'utf8');
        const productionSource = readFileSync(resolve('src/services/supabase/production.ts'), 'utf8');

        expect(transitionsSource).not.toContain('legacyStatus');
        expect(productionSource).not.toMatch(/\border\.status\b/);
    });

    it.each([
        'src/constants/financialObligations.ts',
        'src/services/supabase/orderWorkflow.ts',
        'src/services/supabase/financialReconciliationPreview.ts',
        'src/services/supabase/historicalObligationsPreview.ts',
    ])('keeps %s business logic free of direct legacy order status reads', (path) => {
        const source = readFileSync(resolve(path), 'utf8');

        expect(source).not.toMatch(/\border\.status\b/);
    });

    it('queries historical obligation candidates through V2 axes', () => {
        const source = readFileSync(resolve('src/services/supabase/historicalObligationsPreview.ts'), 'utf8');

        expect(source).toContain('production_status, issue_state, intake_state');
        expect(source).toContain(".or('issue_state.neq.none,production_status.in.(final_ready,try_in_ready,final_delivered)')");
        expect(source).not.toContain(".in('status'");
    });
});
