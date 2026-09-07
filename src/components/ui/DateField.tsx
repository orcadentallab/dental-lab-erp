import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, X } from 'lucide-react';
import clsx from 'clsx';
import Calendar from './Calendar';
import { useAnchoredPopover, useDismissOnOutside } from './usePopover';
import {
    clampIso,
    describeIso,
    formatIsoForDisplay,
    isoOutOfBounds,
    isoToDate,
    isoToday,
    parseSmartDate,
    shiftIso,
} from '../../utils/smartDate';
import { fieldShellClasses, type DateFieldTone, type DateHint } from './dateFieldStyles';

/**
 * The replacement for `<input type="date">`.
 *
 * Same value contract as the native input — an ISO `yyyy-MM-dd` string, `''`
 * when empty — so every call site keeps its existing state and query code. What
 * changes is everything around it: the user types freely ("1/9/26", "امبارح",
 * a pasted ISO string), sees the interpretation confirmed in Arabic before it
 * commits, and gets a calendar that matches the app instead of the browser's.
 *
 * The value commits on blur / Enter / calendar pick, never on every keystroke —
 * these fields drive report queries, and a query per keypress is not free.
 */

function boundsHint(iso: string, min?: string, max?: string): DateHint | null {
    const side = isoOutOfBounds(iso, min, max);
    if (side === 'below') return { tone: 'warn', text: `أقدم تاريخ مسموح بيه ${formatIsoForDisplay(min)}` };
    if (side === 'above') return { tone: 'warn', text: `أحدث تاريخ مسموح بيه ${formatIsoForDisplay(max)}` };
    return null;
}

export interface DateTextInputProps {
    value: string;
    onCommit: (iso: string) => void;
    onHintChange?: (hint: DateHint | null) => void;
    onFocus?: () => void;
    min?: string;
    max?: string;
    placeholder?: string;
    ariaLabel?: string;
    id?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    autoFocus?: boolean;
    today?: Date;
    tone?: DateFieldTone;
    className?: string;
}

/**
 * The typing half of a date field, with no calendar of its own — DateField and
 * DateRangeField both wrap it, which is what keeps their typing behaviour
 * identical instead of two copies that drift.
 */
export function DateTextInput({
    value,
    onCommit,
    onHintChange,
    onFocus,
    min,
    max,
    placeholder = 'يوم/شهر/سنة',
    ariaLabel,
    id,
    name,
    disabled,
    required,
    autoFocus,
    today = new Date(),
    tone = 'light',
    className,
}: DateTextInputProps) {
    // null means "not being edited" — the input mirrors the committed value.
    const [draft, setDraft] = useState<string | null>(null);
    const invalid = draft !== null && draft.trim() !== '' && !parseSmartDate(draft, today).ok;

    const describe = (text: string): DateHint | null => {
        const trimmed = text.trim();
        if (!trimmed) return null;
        const parsed = parseSmartDate(trimmed, today);
        if (!parsed.ok) return { tone: 'warn', text: `مش فاهم "${trimmed}" — جرّب 1/9/26 أو امبارح` };
        return boundsHint(parsed.iso, min, max) ?? { tone: 'ok', text: `→ ${describeIso(parsed.iso, today)}` };
    };

    const commit = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) {
            setDraft(null);
            onHintChange?.(null);
            onCommit('');
            return;
        }
        const parsed = parseSmartDate(trimmed, today);
        if (!parsed.ok) {
            // Keep the raw text and the warning rather than silently reverting —
            // a filter that quietly ignored what you typed is worse than a visible complaint.
            onHintChange?.(describe(text));
            return;
        }
        const clamped = clampIso(parsed.iso, min, max);
        setDraft(null);
        onHintChange?.(null);
        onCommit(clamped);
    };

    const nudge = (delta: { days?: number; months?: number }) => {
        const parsedDraft = draft !== null ? parseSmartDate(draft, today) : null;
        const from = parsedDraft?.ok ? parsedDraft.iso : value || isoToday(today);
        const next = clampIso(shiftIso(from, delta), min, max);
        setDraft(null);
        onHintChange?.(null);
        onCommit(next);
    };

    return (
        <input
            id={id}
            name={name}
            type="text"
            // LTR inside the field keeps 01/09/2026 in a stable order and the
            // caret where the user expects it, while the page stays RTL.
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            required={required}
            autoFocus={autoFocus}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            placeholder={placeholder}
            value={draft ?? formatIsoForDisplay(value)}
            onFocus={event => {
                onFocus?.();
                event.currentTarget.select();
            }}
            onChange={event => {
                setDraft(event.target.value);
                onHintChange?.(describe(event.target.value));
            }}
            onBlur={event => commit(event.target.value)}
            onKeyDown={event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commit(event.currentTarget.value);
                } else if (event.key === 'Escape') {
                    setDraft(null);
                    onHintChange?.(null);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    nudge({ days: 1 });
                } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    nudge({ days: -1 });
                } else if (event.key === 'PageUp') {
                    event.preventDefault();
                    nudge({ months: 1 });
                } else if (event.key === 'PageDown') {
                    event.preventDefault();
                    nudge({ months: -1 });
                }
            }}
            className={clsx(
                'w-full min-w-0 bg-transparent text-center tabular-nums outline-none disabled:cursor-not-allowed',
                tone === 'dark' ? 'placeholder:text-slate-500' : 'placeholder:text-surface-400',
                invalid
                    ? (tone === 'dark' ? 'text-amber-300' : 'text-amber-700')
                    : (tone === 'dark' ? 'text-white' : 'text-surface-900'),
                className
            )}
        />
    );
}

export interface DateFieldProps {
    /** ISO `yyyy-MM-dd`, or `''` for empty. */
    value: string;
    onChange: (value: string) => void;
    min?: string;
    max?: string;
    label?: string;
    ariaLabel?: string;
    placeholder?: string;
    id?: string;
    name?: string;
    disabled?: boolean;
    required?: boolean;
    clearable?: boolean;
    size?: 'sm' | 'md';
    tone?: DateFieldTone;
    className?: string;
    today?: Date;
}

export default function DateField({
    value,
    onChange,
    min,
    max,
    label,
    ariaLabel,
    placeholder,
    id,
    name,
    disabled,
    required,
    clearable = true,
    size = 'md',
    tone = 'light',
    className,
    today = new Date(),
}: DateFieldProps) {
    const [open, setOpen] = useState(false);
    const [hint, setHint] = useState<DateHint | null>(null);
    const [month, setMonth] = useState<Date>(() => (value ? isoToDate(value) : today));

    const shellRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const style = useAnchoredPopover(open, shellRef);
    const close = useCallback(() => setOpen(false), []);
    useDismissOnOutside(open, close, [shellRef, popoverRef]);

    const toggleCalendar = () => {
        setMonth(value ? isoToDate(value) : today);
        setOpen(current => !current);
    };

    return (
        <div className={clsx('relative', className)}>
            {label && (
                <label
                    htmlFor={id}
                    className={clsx('mb-1.5 block text-sm font-medium', tone === 'dark' ? 'text-slate-300' : 'text-surface-700')}
                >
                    {label}
                </label>
            )}

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
                    onClick={toggleCalendar}
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
                    <CalendarDays size={size === 'sm' ? 15 : 17} />
                </button>

                <DateTextInput
                    value={value}
                    onCommit={onChange}
                    onHintChange={setHint}
                    min={min}
                    max={max}
                    placeholder={placeholder}
                    ariaLabel={ariaLabel ?? label}
                    id={id}
                    name={name}
                    disabled={disabled}
                    required={required}
                    today={today}
                />

                {clearable && value && !disabled && (
                    <button
                        type="button"
                        onClick={() => { onChange(''); setHint(null); }}
                        aria-label="امسح التاريخ"
                        className={clsx(
                            'grid shrink-0 place-items-center rounded-lg text-surface-400 transition-colors',
                            'hover:bg-surface-200/60 hover:text-surface-700',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
                        )}
                    >
                        <X size={size === 'sm' ? 13 : 15} />
                    </button>
                )}
            </div>

            {/* Floating so a live hint never pushes the filter bar around (CLS). */}
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
                    aria-label="اختيار التاريخ"
                    style={style}
                    className="animate-fadeInUp rounded-2xl border border-surface-200 bg-white p-2 shadow-xl shadow-surface-900/10 motion-reduce:animate-none"
                >
                    <Calendar
                        month={month}
                        onMonthChange={setMonth}
                        selected={value || null}
                        onSelect={iso => { onChange(iso); setHint(null); setOpen(false); }}
                        min={min}
                        max={max}
                        today={today}
                    />
                    <div className="mt-1 flex items-center justify-between border-t border-surface-100 px-1 pt-2">
                        <button
                            type="button"
                            onClick={() => { onChange(clampIso(isoToday(today), min, max)); setOpen(false); }}
                            className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-primary-600 transition-colors hover:bg-primary-50"
                        >
                            النهاردة
                        </button>
                        {clearable && value && (
                            <button
                                type="button"
                                onClick={() => { onChange(''); setOpen(false); }}
                                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100"
                            >
                                مسح
                            </button>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
