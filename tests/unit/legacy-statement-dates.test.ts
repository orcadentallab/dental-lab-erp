import { describe, expect, it } from 'vitest';
import { getOfficialStatementDate } from '../../src/constants/orderLifecycle';
import { isDateInOpenRange } from '../../src/utils/dateRange';

describe('legacy statement dates after administrative delivery backfills', () => {
    const legacy = {
        status: 'Delivered',
        deliveryDate: '2026-01-11',
        createdAt: '2026-01-10T10:00:00Z',
        firstDeliveredAt: '2026-07-30T18:33:28.161247+00:00',
    };

    it.each(['accounting_snapshot_inferred', 'manual_review', 'status_history', undefined] as const)(
        'keeps a delivered legacy case in January despite a %s backfill', source => {
            const date = getOfficialStatementDate({ ...legacy, firstDeliveredSource: source });
            expect(date).toBe('2026-01-11');
            expect(isDateInOpenRange(date, { start: '2026-01-01', end: '2026-01-31' })).toBe(true);
            expect(isDateInOpenRange(date, { start: '2026-07-01', end: '2026-07-31' })).toBe(false);
        },
    );

    it('preserves an explicit actual delivery date', () => {
        expect(getOfficialStatementDate({ ...legacy, actualDeliveryDate: '2026-02-02' })).toBe('2026-02-02');
    });

    it('falls back to creation when the imported date is missing', () => {
        expect(getOfficialStatementDate({ ...legacy, deliveryDate: undefined })).toBe('2026-01-10');
    });

    it.each(['accounting_snapshot_inferred', 'manual_review', undefined] as const)(
        'does not date a returned case using an unobserved %s delivery', source => {
            expect(getOfficialStatementDate({
                ...legacy, issueState: 'returned', firstDeliveredSource: source,
            })).toBe('2026-01-11');
        },
    );

    it.each(['direct_transition', 'order_event', 'status_history', 'actual_delivery_date'] as const)(
        'preserves the original observed %s delivery when a case is returned', source => {
            expect(getOfficialStatementDate({
                ...legacy, issueState: 'returned', firstDeliveredSource: source,
                firstDeliveredAt: '2026-02-02T12:00:00Z',
                actualDeliveryDate: '2026-03-03',
            })).toBe('2026-02-02');
        },
    );

    it('applies the same source check to raw database fields', () => {
        expect(getOfficialStatementDate({
            status: 'Returned for Adjustments', issue_state: 'returned',
            first_delivered_at: legacy.firstDeliveredAt,
            first_delivered_source: 'accounting_snapshot_inferred',
            delivery_date: legacy.deliveryDate,
        })).toBe('2026-01-11');
    });
});
