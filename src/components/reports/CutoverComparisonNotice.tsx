import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface CutoverBoundary {
    cutover_at: string | null;
    is_production_v1: boolean;
    meaning_before: string;
    meaning_after: string;
}

interface Props {
    /** Start of the period the report is currently showing (YYYY-MM-DD). */
    periodStart?: string | null;
    /** End of the period the report is currently showing (YYYY-MM-DD). */
    periodEnd?: string | null;
}

/**
 * The RPC returns untyped JSONB, so the shape is checked rather than asserted --
 * a malformed payload should make the banner disappear, not crash a report.
 */
function toBoundary(value: unknown): CutoverBoundary | null {
    if (typeof value !== 'object' || value === null) return null;
    const v: Record<string, unknown> = { ...value };
    const at = v.cutover_at;
    if (at !== null && typeof at !== 'string') return null;
    return {
        cutover_at: at,
        is_production_v1: v.is_production_v1 === true,
        meaning_before: typeof v.meaning_before === 'string' ? v.meaning_before : '',
        meaning_after: typeof v.meaning_after === 'string' ? v.meaning_after : '',
    };
}

/**
 * Plan section 5.2 -- the mandatory warning on any cost comparison crossing the
 * cutover.
 *
 * Before the lab opens, "cost" means the outside lab's invoice. After it opens,
 * cost means materials + labour + overhead. A chart drawn across that line puts
 * two different definitions on one axis and reads as a real change in cost when
 * nothing about the work changed at all.
 *
 * Renders nothing until the boundary actually exists AND the shown period
 * actually straddles it -- a warning that is always on gets ignored.
 */
export function CutoverComparisonNotice({ periodStart, periodEnd }: Props) {
    const [boundary, setBoundary] = useState<CutoverBoundary | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.rpc('get_cutover_boundary');
            // A missing boundary is the normal pre-cutover state, not an error
            // worth showing anybody.
            if (!cancelled && !error) setBoundary(toBoundary(data));
        })();
        return () => { cancelled = true; };
    }, []);

    if (!boundary?.cutover_at) return null;
    if (!periodStart || !periodEnd) return null;

    const cutoverDay = boundary.cutover_at.slice(0, 10);
    const straddles = periodStart < cutoverDay && periodEnd >= cutoverDay;
    if (!straddles) return null;

    return (
        <div
            role="status"
            className="flex items-start gap-3 p-4 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
        >
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="space-y-1 text-sm">
                <p className="font-bold text-amber-900 dark:text-amber-200">
                    الفترة دي بتعدّي على يوم تشغيل المعمل الداخلي ({cutoverDay})
                </p>
                <p className="text-amber-800 dark:text-amber-300">
                    معنى «التكلفة» اتغيّر في اليوم ده، فمقارنة قبل بـ بعد بتقارن تعريفين مختلفين:
                </p>
                <ul className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5 pr-4 list-disc">
                    <li><span className="font-semibold">قبل:</span> {boundary.meaning_before}</li>
                    <li><span className="font-semibold">بعد:</span> {boundary.meaning_after}</li>
                </ul>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                    للمقارنة الصح، شوف «التكلفة الفعلية والإنتاجية» أو خط الأساس المجمّد قبل التشغيل.
                </p>
            </div>
        </div>
    );
}

export default CutoverComparisonNotice;
