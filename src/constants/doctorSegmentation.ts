/**
 * A/B/C/D profitability grading for doctors — owner-approved 2026-08-12.
 *
 * These weights and thresholds are business policy, not implementation
 * detail. They live here, in one exported table, so the UI can render them
 * for the owner to review and argue with. Do not inline any of these numbers
 * into a component or a SQL function.
 *
 * WHY POINTS AND NOT HARD RULES: strict rules break on mixed cases — a
 * doctor with high revenue but poor collection would pass a revenue rule and
 * fail the business. Points let one weak dimension pull a grade down without
 * a single rule deciding everything. The override rules below exist for the
 * cases where one dimension SHOULD decide everything.
 *
 * WHY REVENUE CARRIES ZERO WEIGHT: revenue is already inside gross profit.
 * Scoring it again would double-count size and let a high-volume, low-margin
 * doctor outrank a profitable one. It is displayed for context only.
 *
 * LOGISTICS DENSITY WAS REMOVED (owner decision, 2026-08-12): delivery goes
 * through an external courier billed as one monthly invoice, so there is no
 * real per-doctor delivery cost to score. Its 10 points were redistributed
 * proportionally across the four remaining dimensions.
 */

export const SEGMENT_WEIGHTS = {
    grossProfit: 33,
    collectionQuality: 28,
    grossMargin: 22,
    remakeRate: 17,
    revenue: 0,
} as const;

export const TOTAL_POSSIBLE_SCORE =
    SEGMENT_WEIGHTS.grossProfit +
    SEGMENT_WEIGHTS.collectionQuality +
    SEGMENT_WEIGHTS.grossMargin +
    SEGMENT_WEIGHTS.remakeRate;

/** Doctors below this many orders are labelled "small sample", not graded. */
export const MIN_ORDERS_FOR_GRADE = 5;

/** Doctors newer than this are labelled "new", not graded. */
export const MIN_DAYS_FOR_GRADE = 90;

/** A 90+ balance above this share of the doctor's total forces grade D. */
export const OVERRIDE_OVER90_SHARE = 0.5;

export interface ScoreBand {
    label: string;
    points: number;
}

/**
 * Gross profit is scored on the doctor's PERCENTILE among the doctors in the
 * current result set, not on an absolute figure — a good month for this lab
 * is not the same number as a good month for another one.
 */
export const GROSS_PROFIT_BANDS: ScoreBand[] = [
    { label: 'أعلى 20%', points: 33 },
    { label: '20% – 40%', points: 26 },
    { label: '40% – 60%', points: 20 },
    { label: '60% – 80%', points: 13 },
    { label: 'أقل 20%', points: 7 },
    { label: 'مجمل ربح سالب', points: 0 },
];

export const COLLECTION_BANDS: ScoreBand[] = [
    { label: 'كل الرصيد خلال 30 يوم', points: 28 },
    { label: 'أغلبه 31 – 60 يوم', points: 21 },
    { label: 'أغلبه 61 – 90 يوم', points: 14 },
    { label: 'رصيد +90 بين 10% و30%', points: 7 },
    { label: 'رصيد +90 أكثر من 30%', points: 0 },
];

export const MARGIN_BANDS: ScoreBand[] = [
    { label: '40% فأكثر', points: 22 },
    { label: '30% – 40%', points: 18 },
    { label: '20% – 30%', points: 13 },
    { label: '10% – 20%', points: 7 },
    { label: '0% – 10%', points: 3 },
    { label: 'هامش سالب', points: 0 },
];

export const REMAKE_BANDS: ScoreBand[] = [
    { label: 'صفر مشاكل', points: 17 },
    { label: 'أقل من 3%', points: 14 },
    { label: '3% – 7%', points: 10 },
    { label: '7% – 12%', points: 5 },
    { label: 'أكثر من 12%', points: 0 },
];

export type Grade = 'A' | 'B' | 'C' | 'D' | 'new' | 'small_sample';

export const GRADE_LABEL: Record<Grade, string> = {
    A: 'A — شريحة ممتازة',
    B: 'B — جيد',
    C: 'C — متوسط',
    D: 'D — يحتاج مراجعة',
    new: 'جديد',
    small_sample: 'عينة صغيرة',
};

export const GRADE_STYLE: Record<Grade, string> = {
    A: 'bg-emerald-100 text-emerald-800',
    B: 'bg-blue-100 text-blue-800',
    C: 'bg-amber-100 text-amber-800',
    D: 'bg-rose-100 text-rose-800',
    new: 'bg-slate-100 text-slate-600',
    small_sample: 'bg-slate-100 text-slate-600',
};

/** Score bands. A = 80-100, B = 60-79, C = 40-59, D = below 40. */
export function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
    if (score >= 80) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    return 'D';
}

export interface SegmentInput {
    grossProfit: number;
    revenue: number;
    /** 0-1, where 0 is the lowest gross profit in the set and 1 the highest. */
    grossProfitPercentile: number;
    /** null when there is no revenue — undefined, not zero. */
    marginPct: number | null;
    orderCount: number;
    ordersWithIssues: number;
    daysSinceFirstRegistered: number | null;
    receivableTotal: number;
    aging0to30: number;
    aging31to60: number;
    aging61to90: number;
    aging90Plus: number;
}

export interface SegmentResult {
    grade: Grade;
    /** null for ungraded doctors (new / small sample). */
    score: number | null;
    breakdown: {
        grossProfit: number;
        collectionQuality: number;
        grossMargin: number;
        remakeRate: number;
    };
    remakeRate: number;
    over90Share: number;
    /** Set when an override rule decided the grade instead of the score. */
    overrideReason: string | null;
}

function scoreGrossProfit(input: SegmentInput): number {
    if (input.grossProfit < 0) return 0;
    const p = input.grossProfitPercentile;
    if (p >= 0.8) return 33;
    if (p >= 0.6) return 26;
    if (p >= 0.4) return 20;
    if (p >= 0.2) return 13;
    return 7;
}

function scoreCollection(input: SegmentInput): { points: number; over90Share: number } {
    const total = input.receivableTotal;
    // No outstanding balance is perfect collection, not missing data.
    if (total <= 0) return { points: 28, over90Share: 0 };

    const over90Share = input.aging90Plus / total;
    if (over90Share > 0.3) return { points: 0, over90Share };
    if (over90Share >= 0.1) return { points: 7, over90Share };

    // "Mostly" = where the largest share of the balance sits.
    const buckets = [
        { points: 28, amount: input.aging0to30 },
        { points: 21, amount: input.aging31to60 },
        { points: 14, amount: input.aging61to90 },
    ];
    const dominant = buckets.reduce((a, b) => (b.amount > a.amount ? b : a));
    return { points: dominant.points, over90Share };
}

function scoreMargin(input: SegmentInput): number {
    // No revenue means no margin to judge. Award zero rather than inventing a
    // score, and let the small-sample / new rules catch these doctors.
    if (input.marginPct === null) return 0;
    if (input.marginPct < 0) return 0;
    if (input.marginPct >= 40) return 22;
    if (input.marginPct >= 30) return 18;
    if (input.marginPct >= 20) return 13;
    if (input.marginPct >= 10) return 7;
    return 3;
}

function scoreRemake(input: SegmentInput): { points: number; remakeRate: number } {
    if (input.orderCount <= 0) return { points: 0, remakeRate: 0 };
    const rate = (input.ordersWithIssues / input.orderCount) * 100;
    if (rate <= 0) return { points: 17, remakeRate: rate };
    if (rate < 3) return { points: 14, remakeRate: rate };
    if (rate <= 7) return { points: 10, remakeRate: rate };
    if (rate <= 12) return { points: 5, remakeRate: rate };
    return { points: 0, remakeRate: rate };
}

/**
 * Grades one doctor.
 *
 * Ungraded cases come first: grading a doctor on two orders reports noise as
 * signal, and a doctor who joined last month has not had time to show a
 * pattern. Override rules come next, because a negative gross profit or a
 * balance mostly past 90 days is decisive on its own regardless of how well
 * the other dimensions scored.
 */
export function gradeDoctor(input: SegmentInput): SegmentResult {
    const gp = scoreGrossProfit(input);
    const collection = scoreCollection(input);
    const margin = scoreMargin(input);
    const remake = scoreRemake(input);

    const breakdown = {
        grossProfit: gp,
        collectionQuality: collection.points,
        grossMargin: margin,
        remakeRate: remake.points,
    };
    const score = gp + collection.points + margin + remake.points;

    const base = {
        breakdown,
        remakeRate: remake.remakeRate,
        over90Share: collection.over90Share,
    };

    if (input.daysSinceFirstRegistered !== null && input.daysSinceFirstRegistered < MIN_DAYS_FOR_GRADE) {
        return { ...base, grade: 'new', score: null, overrideReason: `مسجّل من أقل من ${MIN_DAYS_FOR_GRADE} يوم` };
    }

    if (input.orderCount < MIN_ORDERS_FOR_GRADE) {
        return { ...base, grade: 'small_sample', score: null, overrideReason: `أقل من ${MIN_ORDERS_FOR_GRADE} طلبات` };
    }

    if (input.grossProfit < 0) {
        return { ...base, grade: 'D', score, overrideReason: 'مجمل الربح سالب' };
    }

    if (input.receivableTotal > 0 && collection.over90Share > OVERRIDE_OVER90_SHARE) {
        return {
            ...base,
            grade: 'D',
            score,
            overrideReason: `أكثر من ${OVERRIDE_OVER90_SHARE * 100}% من رصيده متأخر +90 يوم`,
        };
    }

    return { ...base, grade: gradeFromScore(score), score, overrideReason: null };
}
