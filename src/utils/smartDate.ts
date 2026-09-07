import { addDays, addMonths, endOfMonth, format, startOfMonth } from 'date-fns';

/**
 * Forgiving date parsing — the brain behind DateField / DateRangeField.
 *
 * `<input type="date">` forces a rigid segmented spinner: typing "26" in the
 * year segment yields year 0026, nothing can be pasted, and the segment order
 * follows the *browser's* locale instead of ours. Everything here is pure so it
 * can be unit-tested without a DOM, and every function speaks the same value
 * contract the native input did — an ISO `yyyy-MM-dd` string, `''` for empty —
 * so swapping the component out never touches a single query or filter.
 */

export const ARABIC_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
] as const;

/** Indexed by Date#getDay() — 0 is Sunday. */
export const ARABIC_WEEKDAYS = [
    'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
] as const;

/** Indexed by Date#getDay(). */
export const ARABIC_WEEKDAY_INITIALS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] as const;

/** getDay() values in the order the calendar renders its columns (Saturday first). */
export const WEEK_COLUMN_ORDER: readonly number[] = [6, 0, 1, 2, 3, 4, 5];

export interface SmartDateSuccess {
    ok: true;
    iso: string;
    /** The year was not typed — it was taken from `today`. */
    assumedYear: boolean;
    /** The month was not typed — it was taken from `today`. */
    assumedMonth: boolean;
}

export interface SmartDateFailure {
    ok: false;
    reason: 'empty' | 'invalid';
}

export type SmartDateResult = SmartDateSuccess | SmartDateFailure;

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

const DIGIT_MAP: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((c, i) => { DIGIT_MAP[c] = String(i); });
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((c, i) => { DIGIT_MAP[c] = String(i); });

/** Arabic-Indic and Persian digits → Latin, so "٢٦" and "26" behave identically. */
export function normalizeDigits(value: string): string {
    return value.replace(/[٠-٩۰-۹]/g, c => DIGIT_MAP[c] ?? c);
}

/**
 * Folds the spelling variants Arabic typists actually produce (أ/إ/آ vs ا,
 * ى vs ي, ة vs ه, stray diacritics) so keyword matching does not depend on
 * which one they happened to type.
 */
function foldArabic(value: string): string {
    return value
        .replace(/[ً-ْٰ]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

type KeywordResolver = (today: Date) => Date;

const KEYWORDS: Record<string, KeywordResolver> = {
    'النهارده': today => today,
    'انهارده': today => today,
    'اليوم': today => today,
    'today': today => today,
    'امبارح': today => addDays(today, -1),
    'مبارح': today => addDays(today, -1),
    'امس': today => addDays(today, -1),
    'البارحه': today => addDays(today, -1),
    'yesterday': today => addDays(today, -1),
    'بكره': today => addDays(today, 1),
    'غدا': today => addDays(today, 1),
    'tomorrow': today => addDays(today, 1),
    'اول الشهر': today => startOfMonth(today),
    'بدايه الشهر': today => startOfMonth(today),
    'اخر الشهر': today => endOfMonth(today),
    'نهايه الشهر': today => endOfMonth(today),
    'اول السنه': today => new Date(today.getFullYear(), 0, 1),
    'بدايه السنه': today => new Date(today.getFullYear(), 0, 1),
    'اخر السنه': today => new Date(today.getFullYear(), 11, 31),
    'نهايه السنه': today => new Date(today.getFullYear(), 11, 31),
};

const MONTH_ALIASES: Record<string, number> = {};
ARABIC_MONTHS.forEach((name, index) => { MONTH_ALIASES[foldArabic(name)] = index + 1; });
Object.assign(MONTH_ALIASES, {
    'جانفي': 1, 'شباط': 2, 'اذار': 3, 'نيسان': 4, 'ايار': 5, 'حزيران': 6,
    'تموز': 7, 'اب': 8, 'ايلول': 9,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
});

/**
 * Two digits → the century that makes sense for this app.
 *
 * Every date field here is operational (order dates, payments, deliveries) —
 * there are no birth dates — so a 2-digit year belongs to the window around
 * today: 80 years back, 20 years forward. `26` → 2026, `99` → 1999.
 */
export function expandYear(raw: number, today: Date = new Date()): number {
    if (raw >= 100) return raw;
    const current = today.getFullYear();
    const candidate = 2000 + raw;
    if (candidate >= current - 80 && candidate <= current + 20) return candidate;
    return 1900 + raw;
}

function build(year: number, month: number, day: number, assumedYear: boolean, assumedMonth: boolean): SmartDateResult {
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, reason: 'invalid' };
    const date = new Date(year, month - 1, day);
    // Rejects 31 April and 30 February instead of silently rolling them forward.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { ok: false, reason: 'invalid' };
    }
    return { ok: true, iso: fmt(date), assumedYear, assumedMonth };
}

function parseNamedMonth(folded: string, today: Date): SmartDateResult | null {
    const tokens = folded.split(' ').filter(Boolean);
    let month = 0;
    const rest: string[] = [];

    for (let i = 0; i < tokens.length; i += 1) {
        if (!month && MONTH_ALIASES[tokens[i]]) {
            month = MONTH_ALIASES[tokens[i]];
            continue;
        }
        rest.push(tokens[i]);
    }

    if (!month) return null;
    if (rest.some(token => !/^\d+$/.test(token))) return { ok: false, reason: 'invalid' };

    const day = rest.length ? +rest[0] : 1;
    const year = rest.length > 1 ? expandYear(+rest[1], today) : today.getFullYear();
    return build(year, month, day, rest.length < 2, false);
}

/**
 * Turns whatever the user typed into an ISO date.
 *
 * Day/month order is always Egyptian (`1/9` is 1 September), never American,
 * regardless of the browser's locale — the one thing the native input would
 * not guarantee.
 */
export function parseSmartDate(raw: string, today: Date = new Date()): SmartDateResult {
    const text = normalizeDigits(String(raw ?? '')).trim();
    if (!text) return { ok: false, reason: 'empty' };

    const folded = foldArabic(text);
    const keyword = KEYWORDS[folded];
    if (keyword) return { ok: true, iso: fmt(keyword(today)), assumedYear: false, assumedMonth: false };

    // ISO / year-first, e.g. 2026-09-01 — the format we store and paste around.
    const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (isoMatch) return build(+isoMatch[1], +isoMatch[2], +isoMatch[3], false, false);

    // A written month name: "1 سبتمبر", "1 سبتمبر 26", "سبتمبر".
    const named = parseNamedMonth(folded, today);
    if (named) return named;

    if (!/^[\d\s./\\-]+$/.test(text)) return { ok: false, reason: 'invalid' };
    const numbers = text.split(/[^\d]+/).filter(Boolean);
    if (!numbers.length || numbers.length > 3) return { ok: false, reason: 'invalid' };

    if (numbers.length === 3) {
        return build(expandYear(+numbers[2], today), +numbers[1], +numbers[0], false, false);
    }

    if (numbers.length === 2) {
        return build(today.getFullYear(), +numbers[1], +numbers[0], true, false);
    }

    const compact = numbers[0];
    if (compact.length <= 2) {
        return build(today.getFullYear(), today.getMonth() + 1, +compact, true, true);
    }
    if (compact.length === 4) {
        return build(today.getFullYear(), +compact.slice(2), +compact.slice(0, 2), true, false);
    }
    if (compact.length === 6) {
        return build(expandYear(+compact.slice(4), today), +compact.slice(2, 4), +compact.slice(0, 2), false, false);
    }
    if (compact.length === 8) {
        return build(+compact.slice(4), +compact.slice(2, 4), +compact.slice(0, 2), false, false);
    }
    return { ok: false, reason: 'invalid' };
}

/** ISO → the `dd/MM/yyyy` text the field shows when it is not being edited. */
export function formatIsoForDisplay(iso: string | null | undefined): string {
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return '';
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** ISO → "الثلاثاء 1 سبتمبر 2026", the confirmation line under the field. */
export function describeIso(iso: string | null | undefined, today: Date = new Date()): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return '';
    const date = new Date(y, m - 1, d);
    const base = `${ARABIC_WEEKDAYS[date.getDay()]} ${d} ${ARABIC_MONTHS[m - 1]} ${y}`;
    const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((date.getTime() - midnightToday.getTime()) / 86_400_000);
    if (diff === 0) return `${base} · النهاردة`;
    if (diff === -1) return `${base} · امبارح`;
    if (diff === 1) return `${base} · بكرة`;
    return base;
}

export const isoToday = (today: Date = new Date()): string => fmt(today);

export function shiftIso(iso: string, { days = 0, months = 0 }: { days?: number; months?: number }): string {
    const [y, m, d] = iso.split('-').map(Number);
    let date = new Date(y, m - 1, d);
    if (months) date = addMonths(date, months);
    if (days) date = addDays(date, days);
    return fmt(date);
}

export function isoToDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export const dateToIso = fmt;

/** Both bounds are optional, matching the open ranges utils/dateRange.ts models. */
export function clampIso(iso: string, min?: string, max?: string): string {
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
}

export function isoOutOfBounds(iso: string, min?: string, max?: string): 'below' | 'above' | null {
    if (min && iso < min) return 'below';
    if (max && iso > max) return 'above';
    return null;
}
