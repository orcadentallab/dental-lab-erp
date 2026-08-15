import { describe, it, expect } from 'vitest';
import {
    gradeDoctor,
    gradeFromScore,
    TOTAL_POSSIBLE_SCORE,
    MIN_ORDERS_FOR_GRADE,
    MIN_DAYS_FOR_GRADE,
    type SegmentInput,
} from '../../src/constants/doctorSegmentation';

/** A well-behaved, fully-graded doctor. Tests override one field at a time. */
function baseInput(overrides: Partial<SegmentInput> = {}): SegmentInput {
    return {
        grossProfit: 50_000,
        revenue: 100_000,
        grossProfitPercentile: 0.9,
        marginPct: 50,
        orderCount: 40,
        ordersWithIssues: 0,
        daysSinceFirstRegistered: 400,
        receivableTotal: 10_000,
        aging0to30: 10_000,
        aging31to60: 0,
        aging61to90: 0,
        aging90Plus: 0,
        ...overrides,
    };
}

describe('weights', () => {
    it('the four scored dimensions sum to 100', () => {
        expect(TOTAL_POSSIBLE_SCORE).toBe(100);
    });

    it('a perfect doctor scores the full 100 and lands in A', () => {
        const result = gradeDoctor(baseInput());
        expect(result.score).toBe(100);
        expect(result.grade).toBe('A');
        expect(result.overrideReason).toBeNull();
    });

    it('maps score bands to grades at the documented boundaries', () => {
        expect(gradeFromScore(80)).toBe('A');
        expect(gradeFromScore(79)).toBe('B');
        expect(gradeFromScore(60)).toBe('B');
        expect(gradeFromScore(59)).toBe('C');
        expect(gradeFromScore(40)).toBe('C');
        expect(gradeFromScore(39)).toBe('D');
    });
});

describe('ungraded cases take precedence over any score', () => {
    it('labels a doctor newer than the tenure floor as "new", with no score', () => {
        const result = gradeDoctor(baseInput({ daysSinceFirstRegistered: MIN_DAYS_FOR_GRADE - 1 }));
        expect(result.grade).toBe('new');
        expect(result.score).toBeNull();
    });

    it('grades a doctor exactly at the tenure floor normally', () => {
        const result = gradeDoctor(baseInput({ daysSinceFirstRegistered: MIN_DAYS_FOR_GRADE }));
        expect(result.grade).toBe('A');
    });

    it('labels a thin order history as "small sample", with no score', () => {
        const result = gradeDoctor(baseInput({ orderCount: MIN_ORDERS_FOR_GRADE - 1 }));
        expect(result.grade).toBe('small_sample');
        expect(result.score).toBeNull();
    });

    it('does not let a perfect score rescue a small sample', () => {
        const result = gradeDoctor(baseInput({ orderCount: 2, ordersWithIssues: 0 }));
        expect(result.grade).toBe('small_sample');
    });
});

describe('override rules', () => {
    it('forces D on negative gross profit however good everything else is', () => {
        const result = gradeDoctor(baseInput({ grossProfit: -1, grossProfitPercentile: 1, marginPct: 60 }));
        expect(result.grade).toBe('D');
        expect(result.overrideReason).toContain('سالب');
    });

    it('forces D when more than half the balance is past 90 days', () => {
        const result = gradeDoctor(baseInput({
            receivableTotal: 10_000,
            aging0to30: 4_000,
            aging90Plus: 6_000,
        }));
        expect(result.grade).toBe('D');
        expect(result.overrideReason).toContain('90');
    });

    it('does not force D at exactly half the balance past 90 days', () => {
        const result = gradeDoctor(baseInput({
            receivableTotal: 10_000,
            aging0to30: 5_000,
            aging90Plus: 5_000,
        }));
        expect(result.overrideReason).toBeNull();
    });
});

describe('collection quality', () => {
    it('treats a zero balance as perfect collection, not missing data', () => {
        const result = gradeDoctor(baseInput({
            receivableTotal: 0, aging0to30: 0, aging31to60: 0, aging61to90: 0, aging90Plus: 0,
        }));
        expect(result.breakdown.collectionQuality).toBe(28);
        expect(result.over90Share).toBe(0);
    });

    it('zeroes the dimension when over 30% of the balance is past 90 days', () => {
        const result = gradeDoctor(baseInput({
            receivableTotal: 10_000, aging0to30: 6_000, aging90Plus: 4_000,
        }));
        expect(result.breakdown.collectionQuality).toBe(0);
    });

    it('scores on the dominant bucket when the 90+ share is negligible', () => {
        const result = gradeDoctor(baseInput({
            receivableTotal: 10_000, aging0to30: 1_000, aging31to60: 9_000, aging61to90: 0, aging90Plus: 0,
        }));
        expect(result.breakdown.collectionQuality).toBe(21);
    });
});

describe('remake rate', () => {
    it('counts orders, not issue rows, so the rate cannot exceed 100%', () => {
        const result = gradeDoctor(baseInput({ orderCount: 10, ordersWithIssues: 10 }));
        expect(result.remakeRate).toBe(100);
        expect(result.breakdown.remakeRate).toBe(0);
    });

    it('awards full points only for a clean record', () => {
        expect(gradeDoctor(baseInput({ orderCount: 100, ordersWithIssues: 0 })).breakdown.remakeRate).toBe(17);
        expect(gradeDoctor(baseInput({ orderCount: 100, ordersWithIssues: 1 })).breakdown.remakeRate).toBe(14);
        expect(gradeDoctor(baseInput({ orderCount: 100, ordersWithIssues: 5 })).breakdown.remakeRate).toBe(10);
        expect(gradeDoctor(baseInput({ orderCount: 100, ordersWithIssues: 10 })).breakdown.remakeRate).toBe(5);
        expect(gradeDoctor(baseInput({ orderCount: 100, ordersWithIssues: 20 })).breakdown.remakeRate).toBe(0);
    });
});

describe('margin', () => {
    it('scores an undefined margin as zero rather than inventing a band', () => {
        const result = gradeDoctor(baseInput({ marginPct: null, revenue: 0 }));
        expect(result.breakdown.grossMargin).toBe(0);
    });

    it('scores a negative margin as zero', () => {
        expect(gradeDoctor(baseInput({ marginPct: -5 })).breakdown.grossMargin).toBe(0);
    });
});

describe('gross profit percentile', () => {
    it('scores on rank within the set, not an absolute amount', () => {
        const top = gradeDoctor(baseInput({ grossProfit: 100, grossProfitPercentile: 0.95 }));
        const bottom = gradeDoctor(baseInput({ grossProfit: 1_000_000, grossProfitPercentile: 0.05 }));
        expect(top.breakdown.grossProfit).toBe(33);
        expect(bottom.breakdown.grossProfit).toBe(7);
    });
});
