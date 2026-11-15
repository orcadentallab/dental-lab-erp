import { describe, expect, it, vi } from 'vitest';
import { productionStatusAfterDeliveryTypeChange } from '../../src/constants/deliveryTypeChange';
import { REP_AUDITED_ALLOW_LIST, REP_AUDITED_ALLOW_LIST_CAMEL, REP_FIELD_STATE_GUARDS, REP_FIELD_TO_DB, REP_HARD_DENY_LIST } from '../../src/lib/workflowPermissions';
import { repUpdateOrderWithAudit } from '../../src/services/supabase/orderWorkflow';
import { PRODUCTION_STATUSES } from '../../src/constants/workflow';

const mocks = vi.hoisted(() => ({ rpc: vi.fn().mockResolvedValue({ data: 'order', error: null }) }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../../src/services/supabase/orders', () => ({ getOrder: async () => ({ id: 'order' }) }));

describe('representative delivery type edits', () => {
    it('permits the audited type field without allowing arbitrary workflow writes', () => {
        expect(REP_AUDITED_ALLOW_LIST).toContain('delivery_type');
        expect(REP_AUDITED_ALLOW_LIST_CAMEL).toContain('deliveryType');
        expect(REP_FIELD_TO_DB).toHaveProperty('deliveryType', 'delivery_type');
        expect(REP_HARD_DENY_LIST).not.toContain('delivery_type');
        expect(REP_HARD_DENY_LIST).toContain('production_status');
    });

    it('sends only the requested type through the existing audited RPC', async () => {
        await repUpdateOrderWithAudit('order', { deliveryType: 'TryIn' }, 'doctor_requested');
        expect(mocks.rpc).toHaveBeenCalledWith('rep_update_order_fields_with_audit', {
            p_order_id: 'order', p_changes: { delivery_type: 'TryIn' },
            p_reason_code: 'doctor_requested', p_reason_note: null,
        });
    });

    it.each(['try_in_ready', 'waiting_doctor', 'finalization'] as const)(
        'returns %s to production when switching to Final without claiming final readiness', status => {
            expect(productionStatusAfterDeliveryTypeChange(status, 'TryIn', 'Final')).toBe('in_production');
        },
    );

    it('changes final-ready to try-in-ready when a trial is requested', () => {
        expect(productionStatusAfterDeliveryTypeChange('final_ready', 'Final', 'TryIn')).toBe('try_in_ready');
    });

    it.each(PRODUCTION_STATUSES)('preserves %s when delivery type has not changed', status => {
        expect(productionStatusAfterDeliveryTypeChange(status, 'TryIn', 'TryIn')).toBe(status);
    });

    it.each(['not_started', 'designing', 'in_production', 'final_delivered'] as const)(
        'does not invent or undo completed work at %s', status => {
            expect(productionStatusAfterDeliveryTypeChange(status, 'Final', 'TryIn')).toBe(status);
            expect(productionStatusAfterDeliveryTypeChange(status, 'TryIn', 'Final')).toBe(status);
        },
    );

    it('blocks type editing while an issue is active', () => {
        expect(REP_FIELD_STATE_GUARDS.delivery_type({ productionStatus: 'in_production', issueState: 'none' })).toBe(true);
        expect(REP_FIELD_STATE_GUARDS.delivery_type({ productionStatus: 'final_delivered', issueState: 'redo' })).toBe(false);
    });

    it('keeps delivery dates editable and rejects urgency/priority payloads', async () => {
        expect(REP_AUDITED_ALLOW_LIST).toContain('delivery_date');
        expect(REP_AUDITED_ALLOW_LIST).not.toContain('is_urgent');
        expect(REP_AUDITED_ALLOW_LIST).not.toContain('priority');
        await expect(repUpdateOrderWithAudit('order', { isUrgent: true }, 'doctor_requested')).rejects.toThrow('allow-list');
        await expect(repUpdateOrderWithAudit('order', { priority: 'Urgent' }, 'doctor_requested')).rejects.toThrow('allow-list');
    });
});
