import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarRange, X } from 'lucide-react';
import clsx from 'clsx';
import { addMonths } from 'date-fns';
import Calendar from './Calendar';
import { DateTextInput } from './DateField';
import { fieldShellClasses, type DateFieldTone, type DateHint } from './dateFieldStyles';
import { useAnchoredPopover, useDismissOnOutside } from './usePopover';
import { computeReportRange, type ReportDateRangePreset } from '../../hooks/useReportDateRange';
import { formatOpenDateRangeLabel } from '../../utils/dateRange';
import { ARABIC_MONTHS, formatIsoForDisplay, isoToDate } from '../../utils/smartDate';

/**
 * One control for a من/إلى pair, replacing two unrelated `<input type="date">`s.
 *
 * Two separate native inputs could never tell the user they had picked an end
 * before the start, or show the span they had selected. Here both ends live in
 * one popover: the same two-month grid paints the band between them, the ends
 * swap themselves when they arrive out of order, and the preset buttons come
 * from `computeReportRange` so "آخر 30 يوم" means exactly what it means on the
 * report pages.
 *
 * Either end may stay empty — an open range, the same convention
 * `utils/dateRange.ts` already models across the accounting pages.
 */

export interface DateRangeValue {
    start: string;
    end: string;
}

export interface DateRangeFieldProps {
    start: string;
    end: string;
    onChange: (value: DateRangeValue) => void;
    min?: string;
    max?: string;
    startLabel?: string;
    endLabel?: string;
    disabled?: boolean;
    /** Show the preset shortcuts inside the popover. */
    presets?: boolean;
    size?: 'sm' | 'md';
    tone?: DateFieldTone;
    className?: string;
    today?: Date;
}

const POPOVER_PRESETS: ReportDateRangePreset[] = [
    'today', 'week', 'month', 'current_month', 'prev_month', 'year', 'all',
];

function presetLabel(preset: ReportDateRangePreset, today: Date): string {
    switch (preset) {
        case 'today': return 'النهاردة';
        case 'week': return 'آخر 7 أيام';
        case 'month': return 'آخر 30 يوم';
        case 'current_month': return ARABIC_MONTHS[today.getMonth()];
        case 'prev_month': return ARABIC_MONTHS[addMonths(today, -1).getMonth()];
        case 'year': return 'السنة دي';
        case 'all': return 'الكل';
        default: return '';
    }
}

/** Keeps the pair in order no matter which end the user filled in first. */
function ordered(start: string, end: string): DateRangeValue {
    if (start && end && start > end) return { start: end, end: start };
    return { start, end };
}

export default function DateRangeField({
    start,
    end,
    onChange,
    min,
    max,
    startLabel = 'من',
    endLabel = 'إلى',
    disabled,
    presets = true,
    size = 'md',
    tone = 'light',
    className,
    today = new Date(),
}: DateRangeFieldProps) {
    const [open, setOpen] = useState(false);
    const [picking, setPicking] = useState<'start' | 'end'>('start');
    const [preview, setPreview] = useState<string | null>(null);
    const [hint, setHint] = useState<DateHint | null>(null);
    const [month, setMonth] = useState<Date>(() => (start ? isoToDate(start) : today));

    const shellRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const style = useAnchoredPopover(open, shellRef);
    const close = useCallback(() => { setOpen(false); setPreview(null); }, []);
    useDismissOnOutside(open, close, [shellRef, popoverRef]);

    const commit = (next: DateRangeValue) => {
        setHint(null);
        onChange(ordered(next.start, next.end));
    };

    const openCalendar = (from: 'start' | 'end') => {
        const anchor = (from === 'end' ? end : start) || start || end;
        setMonth(anchor ? isoToDate(anchor) : today);
        setPicking(from);
        setOpen(true);
    };

    const pickDay = (iso: string) => {
        if (picking === 'start') {
            // Picking a new start drops an end that now sits before it, so the
            // second click always lands on a fresh range rather than a broken one.
            const nextEnd = end && iso > end ? '' : end;
            onChange({ start: iso, end: nextEnd });
            setPicking('end');
            return;
        }
        commit({ start, end: iso });
        close();
    };

    const summary = formatOpenDateRangeLabel({ start, end }, formatIsoForDisplay);
    const hasValue = Boolean(start || end);

    return (
        <div className={clsx('relative', className)}>
            <div
                ref={shellRef}
                className={clsx(
                    'flex items-center gap-1 rounded-xl border transition-all focus-within:ring-2',
                    fieldShellClasses(tone, hint?.tone === 'warn'),
                    disabled && 'opacity-60',
                    size === 'sm' ? 'h-9 px-1.5 text-sm' : 'h-11 px-2 text-sm'
                )}
            >
                <button
                    type="button"
                    onClick={() => (open ? close() : openCalendar('start'))}
                    disabled={disabled}
                    aria-label="افتح التقويم"
                    aria-expanded={open}
                    aria-haspopup="dialog"
                    className={clsx(
                        'grid shrink-0 place-items-center rounded-lg transition-colors',
                        tone === 'dark' ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-surface-400 hover:bg-surface-200/60 hover:text-primary-600',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        open && 'bg-primary-50 text-primary-600',
                        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
                    )}
                >
                    <CalendarRange size={size === 'sm' ? 15 : 17} />
                </button>

                <span className={clsx('shrink-0 px-1 text-[11px] font-semibold', tone === 'dark' ? 'text-slate-400' : 'text-surface-400')}>{startLabel}</span>
                <DateTextInput
                    value={start}
                    onCommit={iso => commit({ start: iso, end })}
                    onHintChange={setHint}
                    onFocus={() => setPicking('start')}
                    min={min}
                    max={max}
                    ariaLabel={`${startLabel} تاريخ`}
                    disabled={disabled}
                    today={today}
                    tone={tone}
                    className={clsx(open && picking === 'start' && tone !== 'dark' && 'text-primary-700')}
                />

                <ArrowLeft size={13} className={clsx('shrink-0', tone === 'dark' ? 'text-slate-500' : 'text-surface-300')} aria-hidden />

                <span className={clsx('shrink-0 px-1 text-[11px] font-semibold', tone === 'dark' ? 'text-slate-400' : 'text-surface-400')}>{endLabel}</span>
                <DateTextInput
                    value={end}
                    onCommit={iso => commit({ start, end: iso })}
                    onHintChange={setHint}
                    onFocus={() => setPicking('end')}
                    min={min}
                    max={max}
                    ariaLabel={`${endLabel} تاريخ`}
                    disabled={disabled}
                    today={today}
                    tone={tone}
                    className={clsx(open && picking === 'end' && tone !== 'dark' && 'text-primary-700')}
                />

                {hasValue && !disabled && (
                    <button
                        type="button"
                        onClick={() => { onChange({ start: '', end: '' }); setHint(null); }}
                        aria-label="امسح المدى"
                        className={clsx(
                            'grid shrink-0 place-items-center rounded-lg transition-colors',
                            tone === 'dark' ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-surface-400 hover:bg-surface-200/60 hover:text-surface-700',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
                        )}
                    >
                        <X size={size === 'sm' ? 13 : 15} />
                    </button>
                )}
            </div>

            {hint && !open && (
                <div
                    aria-live="polite"
                    className={clsx(
                        'absolute start-0 z-50 mt-1 w-max max-w-[16rem] rounded-lg px-2.5 py-1.5 text-[11px] font-medium shadow-sm',
                        'animate-fadeInUp motion-reduce:animate-none',
                        hint.tone === 'ok'
                            ? 'bg-primary-600 text-white'
                            : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                    )}
                >
                    {hint.text}
                </div>
            )}

            {open && createPortal(
                <div
                    ref={popoverRef}
                    role="dialog"
                    aria-label="اختيار مدى التواريخ"
                    style={style}
                    className="animate-fadeInUp max-w-[95vw] rounded-2xl border border-surface-200 bg-white p-3 shadow-xl shadow-surface-900/10 motion-reduce:animate-none"
                >
                    <div className="mb-2 flex items-center gap-2 px-1">
                        <span className={clsx(
                            'shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold transition-colors',
                            picking === 'start' ? 'bg-primary-600 text-white' : 'bg-surface-100 text-surface-500'
                        )}>
                            {picking === 'start' ? 'اختار البداية' : 'اختار النهاية'}
                        </span>
                        <span className="truncate text-[11px] text-surface-500">{summary}</span>
                    </div>

                    <div className="flex flex-col gap-3 md:flex-row">
                        {presets && (
                            <div className="flex flex-wrap gap-1 md:w-28 md:flex-col md:border-l md:border-surface-100 md:pl-2">
                                {POPOVER_PRESETS.map(preset => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => {
                                            const range = computeReportRange(preset, today);
                                            commit({ start: range.startDate, end: range.endDate });
                                            close();
                                        }}
                                        className="rounded-lg px-2.5 py-1.5 text-right text-xs font-semibold text-surface-600 transition-colors hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    >
                                        {presetLabel(preset, today)}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <Calendar
                                month={month}
                                onMonthChange={setMonth}
                                rangeStart={start || null}
                                rangeEnd={end || null}
                                preview={picking === 'end' ? preview : null}
                                onPreview={setPreview}
                                onSelect={pickDay}
                                min={min}
                                max={max}
                                nav="prev"
                                today={today}
                            />
                            {/* The second month only earns its width on a real screen. */}
                            <div className="hidden md:block">
                                <Calendar
                                    month={addMonths(month, 1)}
                                    // It renders month+1, so its "next" has to step the shared month by one.
                                    onMonthChange={next => setMonth(addMonths(next, -1))}
                                    rangeStart={start || null}
                                    rangeEnd={end || null}
                                    preview={picking === 'end' ? preview : null}
                                    onPreview={setPreview}
                                    onSelect={pickDay}
                                    min={min}
                                    max={max}
                                    nav="next"
                                    today={today}
                                />
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
