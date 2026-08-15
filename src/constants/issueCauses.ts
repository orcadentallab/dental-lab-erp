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
