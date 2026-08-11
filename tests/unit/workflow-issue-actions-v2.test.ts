import { describe, expect, it } from 'vitest';
import { getIssueActions } from '../../src/constants/workflowTransitions';

const ids = (delivered: boolean, role = 'representative') =>
    getIssueActions('none', role, { firstDeliveredAt: delivered ? '2026-08-01T10:00:00Z' : null })
        .map(action => action.id);

describe('order issue actions V2', () => {
    it('offers only cancellation before first delivery', () => {
        expect(ids(false)).toEqual(['cancel']);
    });

    it('offers return and doctor rejection only after first delivery', () => {
        expect(ids(true)).toEqual(['return', 'reject']);
    });

    it('treats reviewed legacy delivery evidence as post-delivery without inventing a date', () => {
        expect(getIssueActions('none', 'representative', {
            firstDeliveredAt: null,
            legacyDeliveryConfirmed: true,
        }).map(action => action.id)).toEqual(['return', 'reject']);
    });

    it('never exposes lab rejection in the issue menu', () => {
        expect(ids(false)).not.toContain('lab_reject');
        expect(ids(true)).not.toContain('lab_reject');
    });

    it('allows only admin and representative issue actions', () => {
        expect(ids(true, 'designer')).toEqual([]);
        expect(ids(true, 'doctor')).toEqual([]);
    });
});
