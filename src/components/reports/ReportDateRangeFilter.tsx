import { Calendar } from 'lucide-react';
import clsx from 'clsx';
import { format, subMonths } from 'date-fns';
import type { ReportDateRangeState, ReportDateRangePreset } from '../../hooks/useReportDateRange';
import DateRangeField from '../ui/DateRangeField';

const PRESET_ORDER: ReportDateRangePreset[] = [
    'today', 'week', 'month', 'current_month', 'prev_month', 'prev_prev_month', 'year', 'all',
];

function presetLabels(): Record<ReportDateRangePreset, string> {
    const today = new Date();
    return {
        today: 'اليوم',
        week: 'آخر 7 أيام',
        month: 'آخر 30 يوم',
        current_month: format(today, 'MMMM'),
        prev_month: format(subMonths(today, 1), 'MMMM'),
        prev_prev_month: format(subMonths(today, 2), 'MMMM'),
        year: 'هذا العام',
        all: 'الكل',
        custom: 'تاريخ مخصص',
    };
}

/**
 * Same preset set and behaviour as /analytics's date filter (useReportDateRange
 * mirrors its computation exactly), re-skinned for the light bg-white cards
 * the rest of this reporting work uses instead of Analytics' dark hero header.
 * Drop this in the same top-of-page position on every report page so the
 * control is always where it's expected.
 */
export default function ReportDateRangeFilter({ state }: { state: ReportDateRangeState }) {
    const labels = presetLabels();

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex flex-wrap items-center gap-1 border border-slate-200">
                {PRESET_ORDER.map(preset => (
                    <button
                        key={preset}
                        type="button"
                        onClick={() => state.setPreset(preset)}
                        className={clsx(
                            'px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap',
                            state.preset === preset ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                        )}
                    >
                        {labels[preset]}
                    </button>
                ))}
            </div>
            <button
                type="button"
                onClick={() => state.setPreset('custom')}
                className={clsx(
                    'p-2 rounded-xl border transition-all',
                    state.preset === 'custom' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-400 border-slate-200 hover:text-slate-700'
                )}
                title={labels.custom}
                aria-label={labels.custom}
            >
                <Calendar size={16} />
            </button>

            {state.preset === 'custom' && (
                <DateRangeField
                    start={state.customStart}
                    end={state.customEnd}
                    onChange={({ start, end }) => {
                        state.setCustomStart(start);
                        state.setCustomEnd(end);
                    }}
                    size="sm"
                    // The preset buttons are already sitting right next to it.
                    presets={false}
                    className="w-[22rem] max-w-full"
                />
            )}
        </div>
    );
}
