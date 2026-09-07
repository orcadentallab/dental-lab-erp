import { describe, expect, it } from 'vitest';
import {
    clampIso,
    describeIso,
    expandYear,
    formatIsoForDisplay,
    isoOutOfBounds,
    parseSmartDate,
    shiftIso,
} from '../../src/utils/smartDate';

/**
 * `today` is pinned so the relative rules (2-digit years, assumed month/year,
 * keywords) are asserted against a fixed reference instead of the clock.
 */
const TODAY = new Date(2026, 8, 7); // 7 September 2026

const iso = (input: string) => {
    const result = parseSmartDate(input, TODAY);
    return result.ok ? result.iso : `INVALID:${result.reason}`;
};

describe('parseSmartDate — the two-digit year rule', () => {
    it('reads a 2-digit year as the century around today', () => {
        expect(iso('1/9/26')).toBe('2026-09-01');
        expect(iso('1/9/27')).toBe('2027-09-01');
        expect(iso('1/9/25')).toBe('2025-09-01');
    });

    it('falls back to the 1900s once 20xx would be more than 20 years ahead', () => {
        expect(expandYear(26, TODAY)).toBe(2026);
        expect(expandYear(46, TODAY)).toBe(2046);
        expect(expandYear(47, TODAY)).toBe(1947);
        expect(expandYear(99, TODAY)).toBe(1999);
    });

    it('leaves a fully typed year alone', () => {
        expect(expandYear(2026, TODAY)).toBe(2026);
        expect(iso('1/9/2026')).toBe('2026-09-01');
    });
});

describe('parseSmartDate — separators and orders', () => {
    it('always reads day/month, never month/day', () => {
        expect(iso('1/9/2026')).toBe('2026-09-01');
        expect(iso('9/1/2026')).toBe('2026-01-09');
    });

    it('accepts any separator people actually type', () => {
        expect(iso('1-9-2026')).toBe('2026-09-01');
        expect(iso('1.9.2026')).toBe('2026-09-01');
        expect(iso('1 9 2026')).toBe('2026-09-01');
        expect(iso('01/09/2026')).toBe('2026-09-01');
    });

    it('accepts a pasted ISO string unchanged', () => {
        expect(iso('2026-09-01')).toBe('2026-09-01');
    });

    it('accepts Arabic-Indic digits', () => {
        expect(iso('١/٩/٢٦')).toBe('2026-09-01');
    });
});

describe('parseSmartDate — partial input fills in from today', () => {
    it('treats a bare number as a day of the current month', () => {
        const result = parseSmartDate('26', TODAY);
        expect(result).toMatchObject({ ok: true, iso: '2026-09-26', assumedYear: true, assumedMonth: true });
    });

    it('treats day/month as the current year', () => {
        const result = parseSmartDate('1/12', TODAY);
        expect(result).toMatchObject({ ok: true, iso: '2026-12-01', assumedYear: true, assumedMonth: false });
    });
});

describe('parseSmartDate — compact digit runs', () => {
    it('reads ddmm, ddmmyy and ddmmyyyy', () => {
        expect(iso('0109')).toBe('2026-09-01');
        expect(iso('010926')).toBe('2026-09-01');
        expect(iso('01092026')).toBe('2026-09-01');
    });
});

describe('parseSmartDate — words', () => {
    it('understands the everyday Egyptian words', () => {
        expect(iso('النهاردة')).toBe('2026-09-07');
        expect(iso('اليوم')).toBe('2026-09-07');
        expect(iso('امبارح')).toBe('2026-09-06');
        expect(iso('أمس')).toBe('2026-09-06');
        expect(iso('بكرة')).toBe('2026-09-08');
        expect(iso('اول الشهر')).toBe('2026-09-01');
        expect(iso('آخر الشهر')).toBe('2026-09-30');
        expect(iso('اخر السنة')).toBe('2026-12-31');
    });

    it('understands a written month name', () => {
        expect(iso('1 سبتمبر')).toBe('2026-09-01');
        expect(iso('1 سبتمبر 25')).toBe('2025-09-01');
        expect(iso('سبتمبر')).toBe('2026-09-01');
    });
});

describe('parseSmartDate — rejection', () => {
    it('reports empty separately from invalid', () => {
        expect(parseSmartDate('', TODAY)).toEqual({ ok: false, reason: 'empty' });
        expect(parseSmartDate('   ', TODAY)).toEqual({ ok: false, reason: 'empty' });
    });

    it('rejects impossible dates instead of rolling them over', () => {
        expect(iso('30/2/2026')).toBe('INVALID:invalid');
        expect(iso('31/4/2026')).toBe('INVALID:invalid');
        expect(iso('1/13/2026')).toBe('INVALID:invalid');
        expect(iso('0/9/2026')).toBe('INVALID:invalid');
    });

    it('accepts 29 February only in a leap year', () => {
        expect(iso('29/2/2024')).toBe('2024-02-29');
        expect(iso('29/2/2026')).toBe('INVALID:invalid');
    });

    it('rejects nonsense', () => {
        expect(iso('hello')).toBe('INVALID:invalid');
        expect(iso('1/2/3/4')).toBe('INVALID:invalid');
    });
});

describe('display helpers', () => {
    it('formats ISO as dd/MM/yyyy and survives an empty value', () => {
        expect(formatIsoForDisplay('2026-09-01')).toBe('01/09/2026');
        expect(formatIsoForDisplay('')).toBe('');
        expect(formatIsoForDisplay(null)).toBe('');
    });

    it('describes a date in Arabic with a relative hint for the nearby days', () => {
        expect(describeIso('2026-09-07', TODAY)).toBe('الإثنين 7 سبتمبر 2026 · النهاردة');
        expect(describeIso('2026-09-06', TODAY)).toBe('الأحد 6 سبتمبر 2026 · امبارح');
        expect(describeIso('2026-09-08', TODAY)).toBe('الثلاثاء 8 سبتمبر 2026 · بكرة');
        expect(describeIso('2026-09-01', TODAY)).toBe('الثلاثاء 1 سبتمبر 2026');
    });
});

describe('bounds and shifting', () => {
    it('shifts by days and months across month ends', () => {
        expect(shiftIso('2026-09-30', { days: 1 })).toBe('2026-10-01');
        expect(shiftIso('2026-01-31', { months: 1 })).toBe('2026-02-28');
        expect(shiftIso('2026-09-01', { days: -1 })).toBe('2026-08-31');
    });

    it('clamps to whichever bound is present', () => {
        expect(clampIso('2026-09-01', '2026-09-05')).toBe('2026-09-05');
        expect(clampIso('2026-09-10', undefined, '2026-09-05')).toBe('2026-09-05');
        expect(clampIso('2026-09-03', '2026-09-01', '2026-09-05')).toBe('2026-09-03');
    });

    it('names which bound was crossed', () => {
        expect(isoOutOfBounds('2026-09-01', '2026-09-05')).toBe('below');
        expect(isoOutOfBounds('2026-09-10', undefined, '2026-09-05')).toBe('above');
        expect(isoOutOfBounds('2026-09-03', '2026-09-01', '2026-09-05')).toBeNull();
    });
});
