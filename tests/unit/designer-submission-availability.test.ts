import { describe, expect, it } from 'vitest';
import { getDesignSubmissionError } from '../../src/lib/designerOrderUtils';
import type { Order } from '../../src/services/db';

const order = (productionStatus: string, issueState = 'none') => ({
    productionStatus, issueState,
} as Order);

describe('designer submission availability', () => {
    it('allows an active design even when the legacy status is stale', () => {
        expect(getDesignSubmissionError({ ...order('designing'), status: 'Under Production' })).toBeNull();
    });
    it('requires acceptance before the first design submission', () => {
        expect(getDesignSubmissionError(order('not_started'))).toContain('قبول');
    });
    it.each(['in_production', 'try_in_ready', 'finalization', 'final_ready', 'final_delivered', 'waiting_doctor'])(
        'requires an explicit design revision for %s', status => {
            expect(getDesignSubmissionError(order(status))).toContain('تعديل');
        },
    );
    it.each(['returned', 'redo', 'doctor_rejected', 'lab_rejected', 'cancelled', 'designer_rejected_pending_admin'])(
        'blocks submission while issue %s is unresolved', issue => {
            expect(getDesignSubmissionError(order('designing', issue))).toContain('مشكلة');
        },
    );
    it('blocks a deleted case', () => {
        expect(getDesignSubmissionError({ ...order('designing'), isDeleted: true })).not.toBeNull();
    });
});
