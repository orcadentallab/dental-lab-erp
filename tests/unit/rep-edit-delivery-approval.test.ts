import { describe, expect, it } from 'vitest';
import { requiresAdminApprovalForOrderEdit } from '../../src/constants/orderLifecycle';

describe('representative edit approval uses the edited case delivery', () => {
    const replacement = {
        isRedo: true,
        originalOrderId: 'delivered-parent',
        productionStatus: 'not_started' as const,
        issueState: 'none' as const,
    };

    it('allows an undelivered replacement even when its legacy status says delivered', () => {
        expect(requiresAdminApprovalForOrderEdit({ ...replacement, status: 'Delivered' })).toBe(false);
    });

    it('requires approval once the replacement itself is delivered', () => {
        expect(requiresAdminApprovalForOrderEdit({ ...replacement, productionStatus: 'final_delivered' })).toBe(true);
    });

    it('keeps approval after a delivered replacement returns for adjustments', () => {
        expect(requiresAdminApprovalForOrderEdit({
            ...replacement, issueState: 'returned', firstDeliveredAt: '2026-10-01T10:00:00Z',
        })).toBe(true);
    });

    it('accepts delivery evidence on the edited row only, including historical cases', () => {
        expect(requiresAdminApprovalForOrderEdit({ ...replacement, actualDeliveryDate: '2026-10-01' })).toBe(true);
        expect(requiresAdminApprovalForOrderEdit({ ...replacement, legacyDeliveryConfirmed: true })).toBe(true);
        expect(requiresAdminApprovalForOrderEdit({ productionStatus: 'final_delivered' })).toBe(true);
        expect(requiresAdminApprovalForOrderEdit({ productionStatus: 'final_ready' })).toBe(false);
        expect(requiresAdminApprovalForOrderEdit(replacement)).toBe(false);
    });
});
