import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type CostRow = {
    order_id: string | null;
    case_id: string | null;
    doctor_id: string | null;
    doctor: string | null;
    shipping_area: string | null;
    actual: number | null;
    estimated: number | null;
    unknown: number;
    attempts: number;
};

export default function ShippingCostReport({ month }: { month: string }) {
    const [rows, setRows] = useState<CostRow[]>([]);
    const [group, setGroup] = useState<'case' | 'doctor' | 'area'>('case');
    const [error, setError] = useState('');
    const [loadedMonth, setLoadedMonth] = useState('');
    useEffect(() => {
        if (!month) return;
        let current = true;
        supabase.rpc('get_shipping_cost_report', { p_month: month + '-01' }).then(({ data, error: failure }) => {
            if (!current) return;
            setError(failure?.message ?? '');
            setRows(data ?? []);
            setLoadedMonth(month);
        });
        return () => { current = false; };
    }, [month]);

    const totals = new Map<string, { name: string; actual: number | null; estimated: number | null; unknown: number; attempts: number }>();
    for (const row of rows) {
        const key = (group === 'case' ? row.order_id : group === 'doctor' ? row.doctor_id : row.shipping_area) ?? '';
        const name = (group === 'case' ? row.case_id : group === 'doctor' ? row.doctor : row.shipping_area) ?? 'غير محدد';
        const total = totals.get(key) ?? { name, actual: null, estimated: null, unknown: 0, attempts: 0 };
        if (row.actual != null) total.actual = (total.actual ?? 0) + Number(row.actual);
        if (row.estimated != null) total.estimated = (total.estimated ?? 0) + Number(row.estimated);
        total.unknown += Number(row.unknown);
        total.attempts += Number(row.attempts);
        totals.set(key, total);
    }
    const money = (amount: number | null) => amount == null ? '—' : `${amount.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
    return <details className="rounded-2xl border border-surface-200 bg-white p-4 dark:bg-surface-900">
        <summary className="cursor-pointer font-semibold">تكلفة الشحن على المعمل</summary>
        <div className="mt-3 space-y-3">
            <label className="block text-sm">التجميع
                <select className="ms-2 rounded-lg border bg-transparent px-2 py-1" value={group} onChange={event => {
                    const value = event.target.value;
                    if (value === 'case' || value === 'doctor' || value === 'area') setGroup(value);
                }}>
                    <option value="case">الأوردر</option><option value="doctor">الطبيب</option><option value="area">المنطقة</option>
                </select>
            </label>
            {loadedMonth !== month ? <p role="status">جاري تحميل التكاليف…</p> : error ? <p role="alert">{error}</p> :
                totals.size === 0 ? <p>مفيش شحنات في الشهر ده.</p> : <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                        <thead><tr className="border-b"><th>البيان</th><th>فعلي</th><th>تقديري</th><th>بدون سعر</th><th>{group === 'case' ? 'المحاولات' : 'روابط الأوردرات بالشحن'}</th></tr></thead>
                        <tbody>{[...totals].sort(([, a], [, b]) => a.name.localeCompare(b.name, 'ar')).map(([key, item]) =>
                            <tr key={key} className="border-b"><td className="py-2">{item.name}</td><td>{money(item.actual)}</td>
                                <td>{money(item.estimated)}</td><td>{item.unknown}</td><td>{item.attempts}</td></tr>)}</tbody>
                    </table>
                </div>}
        </div>
    </details>;
}
