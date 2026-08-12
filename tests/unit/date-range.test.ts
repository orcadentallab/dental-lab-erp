import { describe, expect, it } from 'vitest';
import {
    formatOpenDateRangeLabel,
    isDateInOpenRange,
    isOpenDateRangeValid,
    OPEN_DATE_RANGE_END,
    OPEN_DATE_RANGE_START,
    resolveOpenDateRange,
} from '../../src/utils/dateRange';

describe('open-ended date ranges', () => {
    it('supports an end date without a start date', () => {
        const range = { end: '2025-12-31' };
        expect(isDateInOpenRange('2024-01-01', range)).toBe(true);
        expect(isDateInOpenRange('2025-12-31T23:59:59', range)).toBe(true);
        expect(isDateInOpenRange('2026-01-01', range)).toBe(false);
    });

    it('supports a start date without an end date', () => {
        const range = { start: '2025-07-01' };
        expect(isDateInOpenRange('2025-06-30', range)).toBe(false);
        expect(isDateInOpenRange('2025-07-01', range)).toBe(true);
        expect(isDateInOpenRange('2030-01-01', range)).toBe(true);
    });

    it('treats both missing boundaries as all time', () => {
        expect(isDateInOpenRange('2025-01-01', {})).toBe(true);
        expect(resolveOpenDateRange({})).toEqual({
            start: OPEN_DATE_RANGE_START,
            end: OPEN_DATE_RANGE_END,
        });
    });

    it('rejects only a reversed closed range', () => {
        expect(isOpenDateRangeValid({ start: '2026-01-01' })).toBe(true);
        expect(isOpenDateRangeValid({ end: '2025-12-31' })).toBe(true);
        expect(isOpenDateRangeValid({ start: '2026-01-01', end: '2025-12-31' })).toBe(false);
    });

    it('describes either open boundary clearly', () => {
        expect(formatOpenDateRangeLabel({ end: '2025-12-31' })).toBe('من أول السجلات حتى 2025-12-31');
        expect(formatOpenDateRangeLabel({ start: '2025-07-01' })).toBe('من 2025-07-01 حتى آخر السجلات');
    });
});
