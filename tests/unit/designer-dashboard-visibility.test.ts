import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/services/db';
import { isDesignerDashboardOrderVisible, isDesignSubmitted } from '../../src/lib/designerOrderUtils';
const order = (changes: Partial<Order> = {}) => ({ productionStatus: 'designing', issueState: 'none', designStatus: 'completed', designUrl: 'https://example.com/design', ...changes } as Order);
describe('designer dashboard case visibility', () => {
    it.each(['designing', 'waiting_doctor', 'in_production', 'try_in_ready', 'finalization', 'final_ready'] as const)('keeps designed cases during %s', productionStatus => {
        expect(isDesignerDashboardOrderVisible(order({ productionStatus }))).toBe(true);
    });
    it('keeps requests for details and approval visible after upload', () => {
        const waiting = order({ technicianStatus: 'NeedDetails', designStatus: 'waiting_approval', productionStatus: 'waiting_doctor' });
        expect(isDesignerDashboardOrderVisible(waiting)).toBe(true);
        expect(isDesignSubmitted(waiting)).toBe(true);
    });
    it('keeps a design revision visible in the pending queue', () => {
        const revision = order({ designStatus: 'in_progress', designUrl: undefined });
        expect(isDesignerDashboardOrderVisible(revision)).toBe(true);
        expect(isDesignSubmitted(revision)).toBe(false);
    });
    it.each(['cancelled', 'doctor_rejected', 'lab_rejected', 'redo'] as const)('hides %s cases', issueState => {
        expect(isDesignerDashboardOrderVisible(order({ issueState }))).toBe(false);
    });
    it.each([{ isArchived: true }, { isDeleted: true }, { productionStatus: 'final_delivered', issueState: 'returned' }, { technicianStatus: 'Rejected' }])('hides terminal cases: %j', changes => {
        expect(isDesignerDashboardOrderVisible(order(changes as Partial<Order>))).toBe(false);
    });
});
