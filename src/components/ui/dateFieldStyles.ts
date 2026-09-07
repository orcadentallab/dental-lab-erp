import clsx from 'clsx';

/**
 * Shell styling and hint types shared by DateField and DateRangeField.
 *
 * Kept out of DateField.tsx so that file exports components only — mixing
 * component and non-component exports breaks Fast Refresh for every consumer.
 */

export type DateHint = { tone: 'ok' | 'warn'; text: string };

/**
 * `dark` is for the few places that sit on a dark hero header (Analytics).
 * Only the field shell changes — the popover stays light in both, which is what
 * every dark-header date picker does and keeps the calendar readable.
 */
export type DateFieldTone = 'light' | 'dark';

export function fieldShellClasses(tone: DateFieldTone, warn: boolean): string {
    if (tone === 'dark') {
        return clsx(
            'border-white/10 bg-white/5 focus-within:border-white/30 focus-within:bg-white/10 focus-within:ring-white/20',
            warn && 'border-amber-400/60'
        );
    }
    return clsx(
        'bg-surface-50 focus-within:border-primary-500 focus-within:bg-white focus-within:ring-primary-500/20',
        warn ? 'border-amber-300' : 'border-surface-200'
    );
}
