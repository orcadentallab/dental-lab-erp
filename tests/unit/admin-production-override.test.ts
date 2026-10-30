import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_STATUSES, PRODUCTION_STATUS_LABELS_EN } from '../../src/constants/workflow';

describe('admin production override', () => {
    it('uses the canonical production values and labels instead of legacy choices', () => {
        const source = readFileSync('src/components/orders/WorkflowActionBar.tsx', 'utf8');
        const menu = source.slice(source.indexOf('{/* Admin production override */}'), source.indexOf('<IssueStateCorrectionModal'));
        expect(menu).toContain("userRole === 'admin'");
        expect(menu).toContain('PRODUCTION_STATUSES.map');
        expect(menu).toContain('PRODUCTION_STATUS_LABELS_EN[status]');
        expect(menu).toContain('handleAdminProductionOverride');
        expect(menu).not.toContain('Pending Review');
        expect(PRODUCTION_STATUSES).toHaveLength(8);
        for (const status of PRODUCTION_STATUSES) expect(PRODUCTION_STATUS_LABELS_EN[status]).toMatch(/^[A-Za-z -]+$/);
    });

    it('verifies the authenticated admin and preserves final-delivery accounting', () => {
        const source = readFileSync('src/services/supabase/orderWorkflow.ts', 'utf8');
        const fn = source.slice(source.indexOf('export async function adminOverrideProductionStatus('));
        expect(fn).toContain('getCallerRoleAndId()');
        expect(fn).toContain("role !== 'admin'");
        expect(fn).toContain('isProductionStatus(newStatus)');
        expect(fn).toContain("newStatus === 'final_delivered'");
        expect(fn).toContain("updateOrderStatus(orderId, 'Delivered'");
        expect(fn).toContain('changeProductionStatus(');
    });
});
