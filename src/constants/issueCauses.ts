/**
 * Root-cause taxonomy for order issues.
 *
 * The keys MUST stay in sync with the CHECK constraints in
 * supabase/migrations/20260816000000_expand_order_issue_cause_codes.sql.
 * Adding a label here without adding it to the constraint will fail on insert.
 */

export const ISSUE_CAUSE = {
    prep: 'تحضير السن',
    scan_impression: 'مسح / طبعة',
    cad: 'تصميم CAD',
    fit: 'عدم انطباق',
    contact: 'نقطة تلامس',
    occlusion: 'إطباق',
    shade: 'لون',
    milling: 'فرز',
    material: 'خامة',
    finish: 'تشطيب',
    glaze: 'جلاز',
    doctor_side: 'من جهة الطبيب',
    logistics_damage: 'تلف أثناء النقل',
    unknown: 'غير محدد',
    // Added 20260820020000 — explicit cause/stage selection at the moment of
    // action. English labels intentionally: these are the terms the lab
    // actually uses day-to-day (see src/components/orders/IssueCauseFields.tsx).
    crack: 'Cracks',
    no_space: 'No Space',
    doctor_changed_mind: 'Doctor Change Mind',
    doctor_prior_issues: 'Prior Issues',
    financial_reason: 'Financial Reasons',
    duplicate_order: 'Duplicated',
} as const;

export const RESPONSIBLE_STAGE = {
    design: 'التصميم',
    milling: 'الفرز',
    finish: 'التشطيب',
    glaze: 'الجلاز',
    qc: 'مراجعة الجودة',
    doctor: 'الطبيب',
    logistics: 'الشحن',
    external_lab: 'معمل خارجي',
    unknown: 'غير محدد',
} as const;

export type IssueCause = keyof typeof ISSUE_CAUSE;
export type ResponsibleStage = keyof typeof RESPONSIBLE_STAGE;

export const ALL_ISSUE_CAUSES = Object.keys(ISSUE_CAUSE) as IssueCause[];
export const ALL_RESPONSIBLE_STAGES = Object.keys(RESPONSIBLE_STAGE) as ResponsibleStage[];

/**
 * Arabic label for a cause code.
 *
 * Falls back to «غير محدد» for anything unrecognised — including the
 * pre-2026-08-16 codes (lab / doctor / scan / design / communication / other)
 * if a row somehow escaped conversion. Never renders a raw code to the user.
 */
export function issueCauseLabel(code?: string | null): string {
    if (!code) return ISSUE_CAUSE.unknown;
    return ISSUE_CAUSE[code as IssueCause] ?? ISSUE_CAUSE.unknown;
}

/** Arabic label for a responsible stage. Historical rows have none. */
export function responsibleStageLabel(code?: string | null): string {
    if (!code) return '—';
    return RESPONSIBLE_STAGE[code as ResponsibleStage] ?? RESPONSIBLE_STAGE.unknown;
}

/**
 * Explicit cause selection, by action type (20260820020000).
 *
 * Three separate vocabularies, not one unified list: a lab-rejection cause
 * (before production starts) and a post-delivery defect cause describe
 * fundamentally different things, and a doctor cancelling an order isn't a
 * production problem at all. Mixing them back into one dropdown would
 * reproduce the same "meaningless guess" failure this feature exists to fix.
 *
 * These MUST stay in sync with the per-RPC CHECK inside
 * supabase/migrations/20260820020000_explicit_issue_cause_v2.sql — sending a
 * code outside the matching list is rejected there.
 */
export type IssueContext = 'lab_rejection' | 'cancellation' | 'post_delivery';

export interface IssueCauseOption {
    /** DB value stored in order_issues.cause_category */
    code: string;
    /** English label shown in the UI — the terms the lab uses day-to-day */
    label: string;
    /** Default order_issues.responsible_stage suggested for this cause */
    stage: ResponsibleStage;
}

/** Lab rejection (before production starts) — doctor-side input only. */
export const LAB_REJECTION_CAUSES: IssueCauseOption[] = [
    { code: 'scan_impression', label: 'Bad Scan or Impression', stage: 'doctor' },
    { code: 'prep', label: 'Bad Prep', stage: 'doctor' },
    { code: 'no_space', label: 'No Space', stage: 'doctor' },
    { code: 'unknown', label: 'Other', stage: 'doctor' },
];

/** Cancellation — the doctor's decision, not a production defect. */
export const CANCELLATION_CAUSES: IssueCauseOption[] = [
    { code: 'doctor_changed_mind', label: 'Doctor Change Mind', stage: 'doctor' },
    { code: 'doctor_prior_issues', label: 'Prior Issues', stage: 'doctor' },
    { code: 'financial_reason', label: 'Financial Reasons', stage: 'doctor' },
    { code: 'duplicate_order', label: 'Duplicated', stage: 'doctor' },
    { code: 'unknown', label: 'Other', stage: 'doctor' },
];

/**
 * Post-delivery defects — doctor rejection, return for adjustment, redo.
 * All production today happens at external labs, so the suggested stage is
 * external_lab for every cause except logistics damage.
 */
export const POST_DELIVERY_CAUSES: IssueCauseOption[] = [
    { code: 'contact', label: 'Contact', stage: 'external_lab' },
    { code: 'occlusion', label: 'Occlusion', stage: 'external_lab' },
    { code: 'fit', label: 'Fitting', stage: 'external_lab' },
    { code: 'shade', label: 'Shade', stage: 'external_lab' },
    { code: 'crack', label: 'Cracks', stage: 'external_lab' },
    { code: 'finish', label: 'Bad Finishing', stage: 'external_lab' },
    { code: 'logistics_damage', label: 'Logistics Damage', stage: 'logistics' },
    { code: 'unknown', label: 'Other', stage: 'external_lab' },
];

export function getIssueCauseOptions(context: IssueContext): IssueCauseOption[] {
    switch (context) {
        case 'lab_rejection': return LAB_REJECTION_CAUSES;
        case 'cancellation': return CANCELLATION_CAUSES;
        case 'post_delivery': return POST_DELIVERY_CAUSES;
        default: return [];
    }
}

/** Default responsible_stage suggested for a chosen cause code, by context. */
export function getStageForCause(context: IssueContext, code: string): ResponsibleStage {
    const option = getIssueCauseOptions(context).find((item) => item.code === code);
    return option?.stage ?? 'unknown';
}
