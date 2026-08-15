import { useState, useEffect, useMemo } from 'react';
import { UserPlus } from 'lucide-react';
import { analyticsService, type MarketingAcquisition } from '../../services/supabase/analyticsService';
import { EXPENSE_CATEGORY, normalizeExpenseCategory } from '../../constants/expenseCategories';

const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function firstDayOfMonthsAgo(months: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayDateString(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Customer acquisition, over its own period.
 *
 * The rest of the marketing page works in hours and days because it watches
 * live landing-page traffic. Acquisition cannot: a doctor registered today
 * has not had time to place an order, so a one-day CAC would divide real
 * spend by an artificially empty denominator. This section defaults to three
 * months and carries its own range control.
 */
export default function AcquisitionSection() {
    const [monthsBack, setMonthsBack] = useState(3);
    const [data, setData] = useState<MarketingAcquisition | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let ignore = false;

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const result = await analyticsService.getMarketingAcquisition(
                    firstDayOfMonthsAgo(monthsBack),
                    todayDateString(),
                );
                if (ignore) return;
                setData(result);
            } catch (e) {
                if (ignore) return;
                console.error('Failed to load acquisition data:', e);
                setData(null);
                setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الاكتساب');
            } finally {
                if (!ignore) setLoading(false);
            }
        })();

        return () => { ignore = true; };
    }, [monthsBack]);

    // Ad spend is derived here, not in SQL, so the alias list and Arabic
    // normalization in normalizeExpenseCategory stay the single classifier.
    const adSpend = useMemo(() => {
        if (!data) return 0;
        return data.expense_by_category
            .filter(row => normalizeExpenseCategory(row.category) === EXPENSE_CATEGORY.marketing)
            .reduce((sum, row) => sum + row.total, 0);
    }, [data]);

    // CAC is undefined, not zero, when nothing was spent. Reporting "0 per
    // doctor" would read as free acquisition rather than as no data.
    const cac = adSpend > 0 && data && data.activated_doctors > 0
        ? adSpend / data.activated_doctors
        : null;

    return (
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <UserPlus size={15} className="text-slate-500" />
                    <div>
                        <h3 className="text-sm font-bold text-slate-800">الاكتساب وتكلفة العميل (CAC)</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            فترة مستقلة عن باقي الصفحة — الاكتساب محتاج شهور مش ساعات.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    {[1, 3, 6, 12].map(months => (
                        <button
                            key={months}
                            onClick={() => setMonthsBack(months)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                monthsBack === months ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            {months === 12 ? 'سنة' : `${months} شهور`}
                        </button>
                    ))}
                </div>
            </div>

            {error ? (
                <div className="p-6 text-center">
                    <p className="text-rose-700 text-xs font-bold">{error}</p>
                    <p className="text-slate-400 text-[11px] mt-1">مفيش أرقام معروضة — مش بيانات جزئية.</p>
                </div>
            ) : loading ? (
                <div className="p-8 text-center text-slate-400 text-xs">جاري التحميل...</div>
            ) : adSpend === 0 ? (
                <div className="p-8 text-center">
                    <p className="text-slate-800 font-bold mb-2">مفيش صرف إعلاني مسجل في الفترة دي</p>
                    <p className="text-slate-600 text-sm mb-1">
                        الـ CAC مش معروض لأن قسمة على صفر صرف بتطلّع رقم مضلل، مش صفر.
                        سجّل الصرف الإعلاني كمصروف بفئة «{EXPENSE_CATEGORY.marketing}» من صفحة المالية.
                    </p>
                    <p className="text-slate-400 text-xs">
                        في نفس الفترة: {data?.new_doctors ?? 0} طبيب جديد، منهم {data?.activated_doctors ?? 0} عملوا طلب.
                    </p>
                </div>
            ) : (
                <>
                    <div className="p-4 grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الصرف الإعلاني</span>
                            <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">{fmt(adSpend)}</h4>
                            <span className="text-[10px] text-slate-400">فئة «{EXPENSE_CATEGORY.marketing}»</span>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">أطباء جدد</span>
                            <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">{data?.new_doctors ?? 0}</h4>
                            <span className="text-[10px] text-slate-400">اتسجلوا في الفترة</span>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">منهم مفعّلين</span>
                            <h4 className="text-lg font-extrabold text-emerald-600 font-mono mt-1">{data?.activated_doctors ?? 0}</h4>
                            <span className="text-[10px] text-slate-400">عملوا طلب واحد على الأقل</span>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CAC</span>
                            <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">
                                {cac === null ? '—' : fmt(cac)}
                            </h4>
                            <span className="text-[10px] text-slate-400">
                                {cac === null ? 'مفيش طبيب مفعّل في الفترة' : 'الصرف ÷ عدد المفعّلين'}
                            </span>
                        </div>
                        <div className="col-span-2 lg:col-span-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">إيراد أول 90 يوم</span>
                            <h4 className="text-lg font-extrabold text-slate-800 font-mono mt-1">
                                {fmt(data?.first_90_day_revenue ?? 0)}
                            </h4>
                            <span className="text-[10px] text-slate-400">من نفس دفعة الأطباء الجدد</span>
                        </div>
                    </div>

                    <div className="px-4 pb-4">
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                            <strong className="text-slate-600">أساس الأرقام:</strong>{' '}
                            الصرف من <span className="font-mono">transactions</span> بفئة «{EXPENSE_CATEGORY.marketing}» بعد توحيد
                            التسميات القديمة. المقام هو الأطباء <strong>المفعّلين</strong> مش المسجّلين: طبيب اتسجّل وما طلبش خالص
                            كلّفنا فلوس بس ما جابش شغل، والقسمة على المسجّلين كانت هتقلّل الـ CAC بالغلط.
                            إيراد أول 90 يوم بنفس أساس الإيراد المتسوّي في <span className="font-mono">/analytics</span>.
                            <strong className="text-slate-600"> CAC لكل قناة مش متاح</strong> — الصرف مسجّل كمبلغ إجمالي من غير قناة.
                        </p>
                    </div>
                </>
            )}
        </section>
    );
}
