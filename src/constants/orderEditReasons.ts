// Reason codes for audit-gated order mutations (WF-1).
//
// Used today by `rep_update_order_fields_with_audit`. Designed to be reused by
// future workflow operations (production_status changes, issue_state changes,
// admin corrections) so the system has a single reason vocabulary.
//
// Source of truth for the matrix of which codes apply to which operation:
// docs/orders-field-permissions.md §5.3.

export const ORDER_EDIT_REASON_CODES = [
    'doctor_requested',
    'wrong_intake_data',
    'missing_info_completed',
    'scan_updated',
    'images_updated',
    'items_corrected',           // reserved for WF-1b
    'teeth_corrected',           // reserved for WF-1b
    'delivery_rescheduled_doctor',
    'delivery_rescheduled_lab',
    'urgent_doctor_requested',
    'external_lab_reassigned',
    'designer_reassigned',
    'internal_correction',
    'other',
] as const;

export type OrderEditReasonCode = typeof ORDER_EDIT_REASON_CODES[number];

export const ORDER_EDIT_REASON_LABELS_AR: Record<OrderEditReasonCode, string> = {
    doctor_requested: 'الطبيب طلب التعديل',
    wrong_intake_data: 'خطأ بيانات عند الاستلام',
    missing_info_completed: 'استكمال بيانات ناقصة',
    scan_updated: 'تحديث Scan/STL',
    images_updated: 'تحديث صور',
    items_corrected: 'تصحيح الأصناف',
    teeth_corrected: 'تصحيح أرقام الأسنان',
    delivery_rescheduled_doctor: 'إعادة جدولة بطلب الطبيب',
    delivery_rescheduled_lab: 'إعادة جدولة من المعمل',
    urgent_doctor_requested: 'طارئ بطلب الطبيب',
    external_lab_reassigned: 'إعادة تعيين معمل خارجي',
    designer_reassigned: 'إعادة تعيين مصمم',
    internal_correction: 'تصحيح داخلي',
    other: 'أخرى',
};

export function isOrderEditReasonCode(value: string): value is OrderEditReasonCode {
    return (ORDER_EDIT_REASON_CODES as readonly string[]).includes(value);
}

// Reason codes that REQUIRE a free-text note. The DB RPC also enforces this.
export const REASON_CODES_REQUIRING_NOTE: readonly OrderEditReasonCode[] = ['other'];

export function reasonRequiresNote(code: OrderEditReasonCode): boolean {
    return REASON_CODES_REQUIRING_NOTE.includes(code);
}
