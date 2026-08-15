import { useState, useEffect, useMemo } from 'react';
import { Wallet, AlertTriangle, Truck } from 'lucide-react';
import clsx from 'clsx';
import { db, type Transaction, type Order } from '../services/db';
import { EXPENSE_CATEGORY, normalizeExpenseCategory } from '../constants/expenseCategories';

/**
 * How many completed weeks of history the report shows.
 *
 * The forward-looking half of a cash-flow report is deliberately NOT built.
 * A forecast needs expected inflows and outflows to be entered somewhere, and
 * nothing in this system records them. Projecting from past weeks alone would
 * be a guess wearing the costume of a forecast, which is worse than an
 * honest gap.
 */
const WEEKS_SHOWN = 13;

const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function toDateOnly(value?: string | null): string | null {
    if (!value) return null;
    return value.split('T')[0];
}

/** Monday-anchored week start, matching how the lab reads a working week. */
function startOfWeek(date: Date): Date {
    const d = new Date(date);
    const diff = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function dateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface WeekRow {
    key: string;
    label: string;
    start: string;
    end: string;
    collections: number;
    otherIncome: number;
    supplierPayments: number;
    salaries: number;
    shipping: number;
    otherExpenses: number;
    net: number;
    openingBalance: number;
    closingBalance: number;
}

interface LogisticsSummary {
    shippingCost: number;
    deliveries: number;
    /** null when no shipping expense was recorded — a cost of 0 per delivery would be a lie. */
    costPerDelivery: number | null;
    /** null when no order carries both a promised and an actual delivery date. */
    onTimePct: number | null;
    /** How many deliveries the on-time rate could actually be measured on. */
    datedDeliveries: number;
}

function emptyWeek(start: Date): WeekRow {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
        key: dateKey(start),
        label: `${dateKey(start).slice(5)} → ${dateKey(end).slice(5)}`,
        start: dateKey(start),
        end: dateKey(end),
        collections: 0,
        otherIncome: 0,
        supplierPayments: 0,
        salaries: 0,
        shipping: 0,
        otherExpenses: 0,
        net: 0,
        openingBalance: 0,
        closingBalance: 0,
    };
}

export default function CashFlow() {
    const [transactions, setTransactions] = useState<Partial<Transaction>[]>([]);
    const [orders, setOrders] = useState<Partial<Order>[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let ignore = false;

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const [tx, ord] = await Promise.all([
                    db.getTransactionsForFinanceSummary(),
                    db.getOrdersForFinanceSummary(),
                ]);
                if (ignore) return;
                setTransactions(tx || []);
                setOrders(ord || []);
            } catch (e) {
                if (ignore) return;
                console.error('Failed to load cash flow data:', e);
                setTransactions([]);
                setOrders([]);
                setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات التدفق النقدي');
            } finally {
                if (!ignore) setLoading(false);
            }
        })();

        return () => { ignore = true; };
    }, []);

    const weeks = useMemo<WeekRow[]>(() => {
        const thisWeekStart = startOfWeek(new Date());
        const windowStart = new Date(thisWeekStart);
        windowStart.setDate(windowStart.getDate() - (WEEKS_SHOWN - 1) * 7);
        const windowStartKey = dateKey(windowStart);

        // Build every week up front so a week with no movement still shows as
        // a row. A silently missing week reads as "nothing loaded", not as
        // "nothing happened".
        const rows: WeekRow[] = [];
        for (let i = 0; i < WEEKS_SHOWN; i++) {
            const start = new Date(windowStart);
            start.setDate(start.getDate() + i * 7);
            rows.push(emptyWeek(start));
        }
        const rowByKey = new Map(rows.map(r => [r.key, r]));

        // Everything dated before the window forms the opening balance, so the
        // first week does not start from a fictional zero.
        let runningBalance = 0;

        for (const tx of transactions) {
            // Same date basis get_analytics_summary uses: the effective date
            // when one was recorded, otherwise the entry date.
            const dateStr = toDateOnly(tx.effectiveDate) || toDateOnly(tx.date);
            if (!dateStr) continue;

            const amount = Number(tx.amount) || 0;
            if (!amount) continue;

            if (dateStr < windowStartKey) {
                runningBalance += tx.type === 'income' ? amount : -amount;
                continue;
            }

            const row = rowByKey.get(dateKey(startOfWeek(new Date(dateStr))));
            if (!row) continue; // dated beyond the current week

            if (tx.type === 'income') {
                // Doctor money is collections; anything else is other income
                // and is kept separate so the collections line stays readable
                // as "what we got paid for our work".
                if (tx.entityType === 'doctor') row.collections += amount;
                else row.otherIncome += amount;
                continue;
            }

            // Expense buckets are mutually exclusive so a row always sums to
            // its own net. Entity wins over category: a payment to a supplier
            // is a supplier payment whatever category was typed on it.
            const category = normalizeExpenseCategory(tx.category);
            if (tx.entityType === 'supplier' || tx.entityType === 'designer') {
                row.supplierPayments += amount;
            } else if (category === EXPENSE_CATEGORY.salaries) {
                row.salaries += amount;
            } else if (category === EXPENSE_CATEGORY.shipping) {
                row.shipping += amount;
            } else {
                row.otherExpenses += amount;
            }
        }

        for (const row of rows) {
            row.net = row.collections + row.otherIncome
                - row.supplierPayments - row.salaries - row.shipping - row.otherExpenses;
            row.openingBalance = runningBalance;
            runningBalance += row.net;
            row.closingBalance = runningBalance;
        }

        return rows;
    }, [transactions]);

    // ── Logistics. Deliberately a section here, not its own page: delivery
    // runs through one external courier billed as a monthly invoice, so there
    // are no routes or in-house drivers to analyse.
    const logistics = useMemo<LogisticsSummary>(() => {
        const windowStart = weeks[0]?.start;
        const windowEnd = weeks[weeks.length - 1]?.end;
        if (!windowStart || !windowEnd) {
            return { shippingCost: 0, deliveries: 0, costPerDelivery: null, onTimePct: null, datedDeliveries: 0 };
        }

        const shippingCost = weeks.reduce((sum, w) => sum + w.shipping, 0);

        let deliveries = 0;
        let onTime = 0;
        let datedDeliveries = 0;

        for (const order of orders) {
            if (order.status !== 'Delivered' && order.status !== 'Completed') continue;
            const delivered = toDateOnly(order.actualDeliveryDate) || toDateOnly(order.deliveryDate);
            if (!delivered || delivered < windowStart || delivered > windowEnd) continue;
            deliveries += 1;

            // On-time is only answerable when both a promise and an actual
            // date exist. Orders missing either are excluded from the rate and
            // the excluded count is shown, rather than being counted as on
            // time by default.
            const promised = toDateOnly(order.deliveryDate);
            const actual = toDateOnly(order.actualDeliveryDate);
            if (promised && actual) {
                datedDeliveries += 1;
                if (actual <= promised) onTime += 1;
            }
        }

        return {
            shippingCost,
            deliveries,
            costPerDelivery: deliveries > 0 && shippingCost > 0 ? shippingCost / deliveries : null,
            onTimePct: datedDeliveries > 0 ? (onTime / datedDeliveries) * 100 : null,
            datedDeliveries,
        };
    }, [weeks, orders]);

    const totals = useMemo(() => ({
        collections: weeks.reduce((s, w) => s + w.collections, 0),
        otherIncome: weeks.reduce((s, w) => s + w.otherIncome, 0),
        supplierPayments: weeks.reduce((s, w) => s + w.supplierPayments, 0),
        salaries: weeks.reduce((s, w) => s + w.salaries, 0),
        shipping: weeks.reduce((s, w) => s + w.shipping, 0),
        otherExpenses: weeks.reduce((s, w) => s + w.otherExpenses, 0),
        net: weeks.reduce((s, w) => s + w.net, 0),
    }), [weeks]);

    return (
        <div className="space-y-6 p-1" dir="rtl">
            <div>
                <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                    <Wallet size={20} className="text-blue-600" />
                    التدفق النقدي
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                    آخر {WEEKS_SHOWN} أسبوع فعلي من حركة الخزنة — تحصيلات ومدفوعات حصلت بالفعل.
                </p>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-rose-800">تعذر تحميل التقرير</p>
                        <p className="text-xs text-rose-700 mt-1 font-mono">{error}</p>
                        <p className="text-xs text-rose-600 mt-1">مفيش أرقام معروضة — مش بيانات جزئية.</p>
                    </div>
                </div>
            )}

            {/* The missing forecast, stated rather than faked */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm font-bold text-amber-900">الجزء التنبؤي مؤجّل — والمعروض هنا ماضي بس</p>
                    <p className="text-xs text-amber-800 mt-1">
                        التنبؤ بالتدفق محتاج إدخال البنود المتوقعة (تحصيلات متوقعة ومدفوعات مجدولة)، وده مش مسجّل في النظام دلوقتي.
                        استنتاج المستقبل من الأسابيع الماضية بس <strong>تخمين</strong> مش توقّع، فما اتعملش.
                    </p>
                </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">التحصيلات</span>
                    <h3 className="text-lg font-extrabold text-emerald-600 font-mono mt-1">
                        {loading ? '—' : fmt(totals.collections)}
                    </h3>
                    <span className="text-xs text-slate-400">من الأطباء</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">مدفوعات موردين ومصممين</span>
                    <h3 className="text-lg font-extrabold text-slate-700 font-mono mt-1">
                        {loading ? '—' : fmt(totals.supplierPayments)}
                    </h3>
                    <span className="text-xs text-slate-400">حسب جهة الصرف</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الرواتب</span>
                    <h3 className="text-lg font-extrabold text-slate-700 font-mono mt-1">
                        {loading ? '—' : fmt(totals.salaries)}
                    </h3>
                    <span className="text-xs text-slate-400">فئة «{EXPENSE_CATEGORY.salaries}»</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">مصروفات تشغيل</span>
                    <h3 className="text-lg font-extrabold text-slate-700 font-mono mt-1">
                        {loading ? '—' : fmt(totals.otherExpenses + totals.shipping)}
                    </h3>
                    <span className="text-xs text-slate-400">منها شحن {loading ? '—' : fmt(totals.shipping)}</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 col-span-2 lg:col-span-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">صافي الحركة</span>
                    <h3 className={clsx(
                        'text-lg font-extrabold font-mono mt-1',
                        totals.net >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    )}>
                        {loading ? '—' : fmt(totals.net)}
                    </h3>
                    <span className="text-xs text-slate-400">داخل ناقص خارج</span>
                </div>
            </div>

            {/* Weekly table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800">الحركة الأسبوعية</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        الأسبوع يبدأ الاثنين. محور التاريخ هو تاريخ السريان (<span className="font-mono">effective_date</span>) لو متسجّل، وإلا تاريخ القيد —
                        نفس أساس بطاقات المدفوعات في <span className="font-mono">/analytics</span>.
                        الرصيد الافتتاحي لأول أسبوع = كل الحركة قبل النافذة، مش صفر.
                    </p>
                </div>

                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-10 text-center text-slate-400 text-xs">جاري تحميل البيانات...</div>
                    ) : error ? (
                        <div className="p-10 text-center text-rose-500 text-xs">مفيش بيانات معروضة بسبب خطأ التحميل فوق.</div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="bg-slate-800 text-white">
                                <tr>
                                    <th className="text-right px-4 py-2.5 font-bold whitespace-nowrap">الأسبوع</th>
                                    <th className="px-3 py-2.5 text-center font-bold">رصيد افتتاحي</th>
                                    <th className="px-3 py-2.5 text-center font-bold">تحصيلات</th>
                                    <th className="px-3 py-2.5 text-center font-bold">إيرادات أخرى</th>
                                    <th className="px-3 py-2.5 text-center font-bold">موردين ومصممين</th>
                                    <th className="px-3 py-2.5 text-center font-bold">رواتب</th>
                                    <th className="px-3 py-2.5 text-center font-bold">شحن</th>
                                    <th className="px-3 py-2.5 text-center font-bold">مصروفات أخرى</th>
                                    <th className="px-3 py-2.5 text-center font-bold">الصافي</th>
                                    <th className="px-3 py-2.5 text-center font-bold">رصيد ختامي</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {weeks.map(week => (
                                    <tr key={week.key} className="hover:bg-slate-50">
                                        <td className="px-4 py-2 text-right font-mono text-slate-700 whitespace-nowrap">{week.label}</td>
                                        <td className="px-3 py-2 text-center font-mono text-slate-400">{fmt(week.openingBalance)}</td>
                                        <td className="px-3 py-2 text-center font-mono text-emerald-600">{week.collections ? fmt(week.collections) : <span className="text-slate-300">—</span>}</td>
                                        <td className="px-3 py-2 text-center font-mono text-emerald-600/70">{week.otherIncome ? fmt(week.otherIncome) : <span className="text-slate-300">—</span>}</td>
                                        <td className="px-3 py-2 text-center font-mono text-slate-600">{week.supplierPayments ? fmt(week.supplierPayments) : <span className="text-slate-300">—</span>}</td>
                                        <td className="px-3 py-2 text-center font-mono text-slate-600">{week.salaries ? fmt(week.salaries) : <span className="text-slate-300">—</span>}</td>
                                        <td className="px-3 py-2 text-center font-mono text-slate-600">{week.shipping ? fmt(week.shipping) : <span className="text-slate-300">—</span>}</td>
                                        <td className="px-3 py-2 text-center font-mono text-slate-600">{week.otherExpenses ? fmt(week.otherExpenses) : <span className="text-slate-300">—</span>}</td>
                                        <td className={clsx(
                                            'px-3 py-2 text-center font-mono font-bold',
                                            week.net > 0 ? 'text-emerald-600' : week.net < 0 ? 'text-rose-600' : 'text-slate-300'
                                        )}>
                                            {week.net ? fmt(week.net) : '—'}
                                        </td>
                                        <td className={clsx(
                                            'px-3 py-2 text-center font-mono font-bold',
                                            week.closingBalance >= 0 ? 'text-slate-800' : 'text-rose-600'
                                        )}>
                                            {fmt(week.closingBalance)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Logistics */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                    <Truck size={15} className="text-slate-500" />
                    <div>
                        <h3 className="text-sm font-bold text-slate-800">اللوجستيات</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            قسم هنا مش صفحة مستقلة: التوصيل عبر شركة شحن خارجية بفاتورة شهرية، فمفيش خطوط سير ولا مندوبين داخليين يتحللوا.
                        </p>
                    </div>
                </div>

                <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">تكلفة الشحن</span>
                        <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">
                            {loading ? '—' : fmt(logistics.shippingCost)}
                        </h4>
                        <span className="text-[10px] text-slate-400">فئة «{EXPENSE_CATEGORY.shipping}» خلال النافذة</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">عدد التوصيلات</span>
                        <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">
                            {loading ? '—' : fmt(logistics.deliveries)}
                        </h4>
                        <span className="text-[10px] text-slate-400">طلبات مسلّمة في نفس النافذة</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">متوسط تكلفة التوصيلة</span>
                        <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">
                            {loading || logistics.costPerDelivery === null ? '—' : fmt(logistics.costPerDelivery)}
                        </h4>
                        <span className="text-[10px] text-slate-400">
                            {!loading && logistics.costPerDelivery === null
                                ? 'مفيش مصروف شحن مسجّل في الفترة'
                                : 'تكلفة الشحن ÷ عدد التوصيلات'}
                        </span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الالتزام بالمواعيد</span>
                        <h4 className={clsx(
                            'text-lg font-extrabold font-mono mt-1',
                            logistics.onTimePct === null ? 'text-slate-400'
                                : logistics.onTimePct >= 90 ? 'text-emerald-600'
                                    : logistics.onTimePct >= 75 ? 'text-amber-600' : 'text-rose-600'
                        )}>
                            {loading || logistics.onTimePct === null ? '—' : `${logistics.onTimePct.toFixed(0)}%`}
                        </h4>
                        <span className="text-[10px] text-slate-400">
                            {!loading && logistics.onTimePct === null
                                ? 'مفيش طلب عليه موعد وتاريخ تسليم فعلي'
                                : `محسوبة على ${logistics.datedDeliveries} من ${logistics.deliveries} طلب`}
                        </span>
                    </div>
                </div>

                <div className="px-4 pb-4">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                        <strong className="text-slate-600">غير متاح عن قصد:</strong> نسبة التوصيل الفاشل وتكلفة الخط.
                        الأولى مش مسجّلة في النظام أصلاً، والتانية مالهاش معنى مع فاتورة شحن إجمالية.
                        نسبة الالتزام محسوبة على الطلبات اللي ليها <strong>موعد محدد وتاريخ تسليم فعلي معاً</strong> —
                        الطلبات الناقص فيها أي منهما مستبعدة مش محسوبة ملتزمة.
                    </p>
                </div>
            </div>
        </div>
    );
}
