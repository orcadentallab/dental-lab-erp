import { useMemo, useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

/**
 * The exact preset set /analytics uses. Kept as ONE hook so every report
 * page that adopts it computes the same date range from the same button —
 * "آخر 30 يوم" means the same 30 days everywhere, not a per-page reimplementation
 * that drifts. See ReportDateRangeFilter.tsx for the matching UI.
 */
export type ReportDateRangePreset =
    | 'today' | 'week' | 'month'
    | 'current_month' | 'prev_month' | 'prev_prev_month'
    | 'year' | 'all' | 'custom';

export interface ReportDateRangeState {
    preset: ReportDateRangePreset;
    setPreset: (preset: ReportDateRangePreset) => void;
    customStart: string;
    customEnd: string;
    setCustomStart: (value: string) => void;
    setCustomEnd: (value: string) => void;
    /** '' means open-ended (only occurs for the 'all' preset, or an empty custom bound). */
    startDate: string;
    endDate: string;
}

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

export function useReportDateRange(defaultPreset: ReportDateRangePreset = 'current_month'): ReportDateRangeState {
    const [preset, setPreset] = useState<ReportDateRangePreset>(defaultPreset);
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const { startDate, endDate } = useMemo(() => {
        if (preset === 'custom') {
            return { startDate: customStart, endDate: customEnd };
        }

        const today = new Date();

        switch (preset) {
            case 'today':
                return { startDate: fmt(today), endDate: fmt(today) };
            case 'week': {
                const start = new Date(today);
                start.setDate(today.getDate() - 7);
                return { startDate: fmt(start), endDate: fmt(today) };
            }
            case 'month': {
                const start = new Date(today);
                start.setDate(today.getDate() - 30);
                return { startDate: fmt(start), endDate: fmt(today) };
            }
            case 'current_month':
                return { startDate: fmt(startOfMonth(today)), endDate: fmt(endOfMonth(today)) };
            case 'prev_month': {
                const d = subMonths(today, 1);
                return { startDate: fmt(startOfMonth(d)), endDate: fmt(endOfMonth(d)) };
            }
            case 'prev_prev_month': {
                const d = subMonths(today, 2);
                return { startDate: fmt(startOfMonth(d)), endDate: fmt(endOfMonth(d)) };
            }
            case 'year':
                return {
                    startDate: fmt(new Date(today.getFullYear(), 0, 1)),
                    endDate: fmt(new Date(today.getFullYear(), 11, 31)),
                };
            case 'all':
            default:
                return { startDate: '', endDate: '' };
        }
    }, [preset, customStart, customEnd]);

    return { preset, setPreset, customStart, customEnd, setCustomStart, setCustomEnd, startDate, endDate };
}
