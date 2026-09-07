import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { addDays, addMonths } from 'date-fns';
import {
    ARABIC_MONTHS,
    ARABIC_WEEKDAY_INITIALS,
    WEEK_COLUMN_ORDER,
    dateToIso,
    isoToday,
} from '../../utils/smartDate';

/**
 * The month grid behind DateField / DateRangeField.
 *
 * Written by hand rather than pulled from a library for two reasons: the week
 * has to start on Saturday with Arabic labels, and the whole thing has to live
 * inside an RTL document without a vendor stylesheet fighting the app's tokens.
 * It is presentational only — it never owns the value, so the same grid renders
 * a single date and both ends of a range.
 */

export interface CalendarProps {
    /** The visible month. Only the year/month are read. */
    month: Date;
    onMonthChange?: (next: Date) => void;
    /** Single-date mode. */
    selected?: string | null;
    /** Range mode — both may be set, or just the start while picking. */
    rangeStart?: string | null;
    rangeEnd?: string | null;
    /** The cell under the cursor, used to preview the band before the 2nd click. */
    preview?: string | null;
    onPreview?: (iso: string | null) => void;
    onSelect: (iso: string) => void;
    min?: string;
    max?: string;
    /**
     * Which month arrows this grid shows. A two-month popover splits them —
     * `prev` on the right-hand (earlier) month, `next` on the left-hand one —
     * so the arrows sit on the outer edges instead of colliding in the middle.
     */
    nav?: 'both' | 'prev' | 'next' | 'none';
    today?: Date;
}

const CELL = 'relative h-11 w-11 sm:h-9 sm:w-9 text-[13px] font-medium transition-colors';

export default function Calendar({
    month,
    onMonthChange,
    selected,
    rangeStart,
    rangeEnd,
    preview,
    onPreview,
    onSelect,
    min,
    max,
    nav = 'both',
    today = new Date(),
}: CalendarProps) {
    const [view, setView] = useState<'days' | 'months'>('days');
    const [yearDraft, setYearDraft] = useState(month.getFullYear());

    // Reopening the picker should start from whatever month is on screen now.
    useEffect(() => { setYearDraft(month.getFullYear()); }, [month, view]);

    const todayIso = isoToday(today);

    const cells = useMemo(() => {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const lead = WEEK_COLUMN_ORDER.indexOf(first.getDay());
        const gridStart = addDays(first, -lead);
        return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    }, [month]);

    // Range ends are read in sorted order so a half-picked range still paints
    // correctly while the cursor is on the wrong side of the start.
    const [bandFrom, bandTo] = useMemo(() => {
        const end = rangeEnd || preview || null;
        if (!rangeStart || !end) return [rangeStart || null, rangeEnd || null] as const;
        return rangeStart <= end ? [rangeStart, end] as const : [end, rangeStart] as const;
    }, [rangeStart, rangeEnd, preview]);

    const isDisabled = (iso: string) => Boolean((min && iso < min) || (max && iso > max));

    if (view === 'months') {
        return (
            <div className="w-[min(20rem,80vw)] select-none p-1">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => setYearDraft(y => y - 1)}
                        className="rounded-lg p-2 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800"
                        aria-label="السنة اللي قبلها"
                    >
                        <ChevronRight size={18} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('days')}
                        className="rounded-lg px-3 py-1.5 text-sm font-bold text-surface-800 transition-colors hover:bg-surface-100"
                    >
                        {yearDraft}
                    </button>
                    <button
                        type="button"
                        onClick={() => setYearDraft(y => y + 1)}
                        className="rounded-lg p-2 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800"
                        aria-label="السنة اللي بعدها"
                    >
                        <ChevronLeft size={18} />
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    {ARABIC_MONTHS.map((name, index) => {
                        const isCurrent = month.getFullYear() === yearDraft && month.getMonth() === index;
                        return (
                            <button
                                key={name}
                                type="button"
                                onClick={() => {
                                    onMonthChange?.(new Date(yearDraft, index, 1));
                                    setView('days');
                                }}
                                className={clsx(
                                    'rounded-xl py-2.5 text-[13px] font-semibold transition-colors',
                                    isCurrent
                                        ? 'bg-primary-600 text-white'
                                        : 'text-surface-700 hover:bg-primary-50 hover:text-primary-700'
                                )}
                            >
                                {name}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="select-none p-1" onMouseLeave={() => onPreview?.(null)}>
            <div className="mb-2 flex items-center justify-between gap-1">
                {/* First child lands on the right in RTL, which is where "back" belongs. */}
                {nav === 'both' || nav === 'prev' ? (
                    <button
                        type="button"
                        onClick={() => onMonthChange?.(addMonths(month, -1))}
                        className="rounded-lg p-2 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800"
                        aria-label="الشهر اللي قبله"
                    >
                        <ChevronRight size={18} />
                    </button>
                ) : <span className="w-9" />}

                <button
                    type="button"
                    onClick={() => setView('months')}
                    className="rounded-lg px-3 py-1.5 text-sm font-bold text-surface-800 transition-colors hover:bg-surface-100"
                >
                    {ARABIC_MONTHS[month.getMonth()]} {month.getFullYear()}
                </button>

                {nav === 'both' || nav === 'next' ? (
                    <button
                        type="button"
                        onClick={() => onMonthChange?.(addMonths(month, 1))}
                        className="rounded-lg p-2 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800"
                        aria-label="الشهر اللي بعده"
                    >
                        <ChevronLeft size={18} />
                    </button>
                ) : <span className="w-9" />}
            </div>

            <div className="grid grid-cols-7">
                {WEEK_COLUMN_ORDER.map(day => (
                    <div key={day} className="flex h-7 items-center justify-center text-[11px] font-bold text-surface-400">
                        {ARABIC_WEEKDAY_INITIALS[day]}
                    </div>
                ))}

                {cells.map(date => {
                    const iso = dateToIso(date);
                    const outside = date.getMonth() !== month.getMonth();
                    const disabled = isDisabled(iso);
                    const isSelected = selected === iso || rangeStart === iso || rangeEnd === iso;
                    const inBand = Boolean(bandFrom && bandTo && iso > bandFrom && iso < bandTo);
                    const isBandStart = Boolean(bandFrom && bandTo && bandFrom !== bandTo && iso === bandFrom);
                    const isBandEnd = Boolean(bandFrom && bandTo && bandFrom !== bandTo && iso === bandTo);

                    return (
                        <div
                            key={iso}
                            className={clsx(
                                'flex justify-center',
                                (inBand || isBandStart || isBandEnd) && 'bg-primary-50',
                                // In RTL the earlier date sits on the start (right) side.
                                isBandStart && 'rounded-s-full',
                                isBandEnd && 'rounded-e-full'
                            )}
                        >
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onSelect(iso)}
                                onMouseEnter={() => onPreview?.(iso)}
                                aria-current={iso === todayIso ? 'date' : undefined}
                                className={clsx(
                                    CELL,
                                    'rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                                    disabled && 'cursor-not-allowed text-surface-300',
                                    !disabled && isSelected && 'bg-primary-600 text-white shadow-sm shadow-primary-600/30',
                                    !disabled && !isSelected && inBand && 'text-primary-800 hover:bg-primary-100',
                                    !disabled && !isSelected && !inBand && (outside ? 'text-surface-300 hover:bg-surface-100' : 'text-surface-700 hover:bg-surface-100'),
                                    !isSelected && iso === todayIso && 'font-bold ring-1 ring-inset ring-primary-400'
                                )}
                            >
                                {date.getDate()}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
