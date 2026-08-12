export interface OpenDateRange {
    start?: string | null;
    end?: string | null;
}

export const OPEN_DATE_RANGE_START = '0001-01-01';
export const OPEN_DATE_RANGE_END = '9999-12-31';

export const toDateOnly = (value?: string | null): string => (value || '').split('T')[0];

/** Inclusive range check where either boundary may be omitted. */
export function isDateInOpenRange(value: string | null | undefined, range: OpenDateRange): boolean {
    const day = toDateOnly(value);
    if (!day) return false;
    if (range.start && day < range.start) return false;
    if (range.end && day > range.end) return false;
    return true;
}

export function isOpenDateRangeValid(range: OpenDateRange): boolean {
    return !range.start || !range.end || range.start <= range.end;
}

/** Converts an open UI range into a closed range for APIs that require both dates. */
export function resolveOpenDateRange(range: OpenDateRange): { start: string; end: string } {
    return {
        start: range.start || OPEN_DATE_RANGE_START,
        end: range.end || OPEN_DATE_RANGE_END,
    };
}

export function formatOpenDateRangeLabel(
    range: OpenDateRange,
    formatDate: (value: string) => string = value => value
): string {
    if (range.start && range.end) return `من ${formatDate(range.start)} إلى ${formatDate(range.end)}`;
    if (range.start) return `من ${formatDate(range.start)} حتى آخر السجلات`;
    if (range.end) return `من أول السجلات حتى ${formatDate(range.end)}`;
    return 'كل الأوقات';
}
