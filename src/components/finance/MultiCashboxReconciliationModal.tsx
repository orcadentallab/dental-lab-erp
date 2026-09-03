import { useState, useMemo } from 'react';
import { 
    X, CheckCircle2, Lightbulb, ArrowLeftRight, 
    Calendar, CheckCheck, RefreshCw
} from 'lucide-react';
import clsx from 'clsx';
import { financeService, type CashboxSummaryRow } from '../../services/financeService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

interface MultiCashboxReconciliationModalProps {
    rows: CashboxSummaryRow[];
    onClose: () => void;
    onSuccess: () => void;
    onOpenTransfer?: (fromId: string, toId: string, amount: number) => void;
}

function formatCurrency(value: number) {
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

export default function MultiCashboxReconciliationModal({
    rows,
    onClose,
    onSuccess,
    onOpenTransfer
}: MultiCashboxReconciliationModalProps) {
    const { user } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();
    const today = new Date().toISOString().split('T')[0];
    const [reconciliationDate, setReconciliationDate] = useState(today);
    const [generalNotes, setGeneralNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const activeRows = useMemo(() => rows.filter(r => r.cashbox.isActive), [rows]);

    // State for actual balances and notes per cashbox
    // Keyed by cashboxId: { actualBalance: string, notes: string }
    const [entries, setEntries] = useState<Record<string, { actualBalance: string; notes: string }>>(() => {
        const initial: Record<string, { actualBalance: string; notes: string }> = {};
        activeRows.forEach(r => {
            initial[r.cashbox.id] = {
                actualBalance: '',
                notes: ''
            };
        });
        return initial;
    });

    function handleSetActual(cashboxId: string, value: string) {
        setEntries(prev => ({
            ...prev,
            [cashboxId]: {
                ...prev[cashboxId],
                actualBalance: value
            }
        }));
    }

    function handleSetNotes(cashboxId: string, value: string) {
        setEntries(prev => ({
            ...prev,
            [cashboxId]: {
                ...prev[cashboxId],
                notes: value
            }
        }));
    }

    function handleMatchExpected(cashboxId: string, expectedBalance: number) {
        handleSetActual(cashboxId, expectedBalance.toString());
    }

    function handleMatchAllExpected() {
        setEntries(prev => {
            const next = { ...prev };
            activeRows.forEach(r => {
                next[r.cashbox.id] = {
                    ...next[r.cashbox.id],
                    actualBalance: r.expectedBalance.toString()
                };
            });
            return next;
        });
    }

    // Calculations
    const sessionStats = useMemo(() => {
        let totalExpected = 0;
        let totalActual = 0;
        let filledCount = 0;
        const boxDiffs: Array<{
            cashboxId: string;
            cashboxName: string;
            expected: number;
            actual: number;
            diff: number;
            notes: string;
            isFilled: boolean;
        }> = [];

        activeRows.forEach(r => {
            const entry = entries[r.cashbox.id];
            const isFilled = entry && entry.actualBalance.trim() !== '';
            const actualVal = isFilled ? Number(entry.actualBalance) : r.expectedBalance;
            const diff = actualVal - r.expectedBalance;

            totalExpected += r.expectedBalance;
            if (isFilled) {
                totalActual += actualVal;
                filledCount++;
            } else {
                totalActual += r.expectedBalance;
            }

            boxDiffs.push({
                cashboxId: r.cashbox.id,
                cashboxName: r.cashbox.name,
                expected: r.expectedBalance,
                actual: actualVal,
                diff,
                notes: entry?.notes || '',
                isFilled
            });
        });

        const netDifference = totalActual - totalExpected;
        const surplusBoxes = boxDiffs.filter(b => b.diff > 0);
        const deficitBoxes = boxDiffs.filter(b => b.diff < 0);

        // Check if there is an exact or near offset between surplus and deficit
        let offsetSuggestion: { fromBox: string; toBox: string; amount: number } | null = null;
        if (surplusBoxes.length > 0 && deficitBoxes.length > 0) {
            for (const s of surplusBoxes) {
                for (const d of deficitBoxes) {
                    if (Math.abs(s.diff - Math.abs(d.diff)) < 0.01) {
                        offsetSuggestion = {
                            fromBox: s.cashboxName,
                            toBox: d.cashboxName,
                            amount: s.diff
                        };
                        break;
                    }
                }
                if (offsetSuggestion) break;
            }
        }

        return {
            totalExpected,
            totalActual,
            netDifference,
            filledCount,
            totalCount: activeRows.length,
            boxDiffs,
            surplusBoxes,
            deficitBoxes,
            offsetSuggestion
        };
    }, [activeRows, entries]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        // Check if all active cashboxes have actual balances
        const unfilled = activeRows.filter(r => !entries[r.cashbox.id] || entries[r.cashbox.id].actualBalance.trim() === '');
        if (unfilled.length > 0) {
            if (!confirm(`يوجد ${unfilled.length} صندوق لم يتم إدخال رصيده الفعلي بعد. هل تريد اعتبار رصيدهم الفعلي مساوياً للرصيد الدفتري تلقائياً وإتمام الجلسة؟`)) {
                return;
            }
        }

        setIsSubmitting(true);
        try {
            const reconciliationsToSave = activeRows.map(r => {
                const entry = entries[r.cashbox.id];
                const isFilled = entry && entry.actualBalance.trim() !== '';
                const actual = isFilled ? Number(entry.actualBalance) : r.expectedBalance;
                const diff = actual - r.expectedBalance;
                const notesParts: string[] = [];
                if (entry?.notes?.trim()) notesParts.push(entry.notes.trim());
                if (generalNotes.trim()) notesParts.push(`[جلسة موحدة: ${generalNotes.trim()}]`);

                return {
                    cashboxId: r.cashbox.id,
                    expectedBalance: r.expectedBalance,
                    actualBalance: actual,
                    difference: diff,
                    notes: notesParts.length > 0 ? notesParts.join(' - ') : undefined
                };
            });

            await financeService.batchSaveCashboxReconciliations(
                reconciliationsToSave,
                reconciliationDate,
                user?.id || null
            );

            toastSuccess(`تم تسجيل جلسة المطابقة الشاملة لـ ${activeRows.length} صندوق بنجاح`);
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Error saving multi-cashbox reconciliation:', error);
            toastError('حدث خطأ أثناء حفظ جلسة المطابقة');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-fade-in">
            <div className="relative flex flex-col max-h-[94vh] w-full max-w-5xl rounded-2xl bg-white shadow-2xl overflow-hidden">
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                            <CheckCheck size={22} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900">
                                جلسة مطابقة الخزائن والصناديق الشاملة
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                مطابقة متزامنة لكافة الصناديق النشطة ({activeRows.length} صندوق) مع التحليل التلقائي للفروقات
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Main Content & Table */}
                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                    {/* Controls Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-white p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Calendar size={16} className="text-slate-500" />
                                <label className="text-xs font-bold text-slate-700">تاريخ المطابقة:</label>
                                <input
                                    type="date"
                                    required
                                    value={reconciliationDate}
                                    onChange={e => setReconciliationDate(e.target.value)}
                                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleMatchAllExpected}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                                <CheckCircle2 size={13} />
                                ملء الكل بالرصيد الدفتري
                            </button>
                        </div>
                    </div>

                    {/* Table of Cashboxes */}
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                            <table className="w-full text-right text-xs">
                                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="p-3 w-56">الصندوق / الحساب</th>
                                        <th className="p-3 w-36">الرصيد الدفتري</th>
                                        <th className="p-3 w-48">الرصيد الفعلي (المعدود)</th>
                                        <th className="p-3 w-36">الفرق (الفعلي - الدفتري)</th>
                                        <th className="p-3">ملاحظات على هذا الصندوق</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-medium">
                                    {activeRows.map(row => {
                                        const entry = entries[row.cashbox.id];
                                        const actualStr = entry?.actualBalance || '';
                                        const isEntered = actualStr.trim() !== '';
                                        const actualNum = isEntered ? Number(actualStr) : row.expectedBalance;
                                        const diff = actualNum - row.expectedBalance;

                                        return (
                                            <tr key={row.cashbox.id} className="hover:bg-slate-50/70 transition-colors">
                                                <td className="p-3">
                                                    <div className="font-black text-slate-900 text-sm">
                                                        {row.cashbox.name}
                                                    </div>
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                                            {row.cashbox.type === 'cash' ? 'نقدي' : row.cashbox.type === 'bank' ? 'حساب بنكي' : row.cashbox.type === 'wallet' ? 'محفظة' : 'أخرى'}
                                                        </span>
                                                        {row.cashbox.isSaving && (
                                                            <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                                                ادخار
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3 font-mono font-black text-slate-800 text-sm">
                                                    {formatCurrency(row.expectedBalance)}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={actualStr}
                                                            onChange={e => handleSetActual(row.cashbox.id, e.target.value)}
                                                            placeholder={row.expectedBalance.toFixed(2)}
                                                            className="w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm font-bold text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleMatchExpected(row.cashbox.id, row.expectedBalance)}
                                                            title="تطابق بالدفتري"
                                                            className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors"
                                                        >
                                                            مطابق
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    {!isEntered ? (
                                                        <span className="inline-flex items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">
                                                            في انتظار الإدخال
                                                        </span>
                                                    ) : diff === 0 ? (
                                                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">
                                                            <CheckCircle2 size={13} />
                                                            مطابق (0 ج.م)
                                                        </span>
                                                    ) : diff > 0 ? (
                                                        <span className="inline-flex items-center rounded bg-blue-100 px-2.5 py-1 font-mono text-xs font-black text-blue-800">
                                                            فائض +{formatCurrency(diff)}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center rounded bg-rose-100 px-2.5 py-1 font-mono text-xs font-black text-rose-800">
                                                            عجز {formatCurrency(diff)}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <input
                                                        type="text"
                                                        value={entry?.notes || ''}
                                                        onChange={e => handleSetNotes(row.cashbox.id, e.target.value)}
                                                        placeholder="ملاحظات (سبب الفرق، كشف الحساب البنكي، إلخ)"
                                                        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Smart Cross-Analysis Banner */}
                        <div className="mt-4 space-y-3">
                            {/* Intelligent Discrepancy Matching Alert */}
                            {sessionStats.offsetSuggestion && (
                                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
                                    <div className="flex items-start gap-3">
                                        <Lightbulb size={22} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <h4 className="text-sm font-black text-amber-900">
                                                تحليل ذكي للفروقات: احتمال وجود تحويل غير مسجل أو توجيه خاطئ!
                                            </h4>
                                            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                                يوجد فائض في <b>{sessionStats.offsetSuggestion.fromBox}</b> بمبلغ ({formatCurrency(sessionStats.offsetSuggestion.amount)}) يقابله عجز بنفس القيمة تماماً في <b>{sessionStats.offsetSuggestion.toBox}</b>، وصافي الفرق الكلي بينهما <b>0 ج.م</b>.
                                                هذا يدل غالباً على تحويل داخلي تم بين الصندوقين ولم يُسجل في السيستم، أو أن إيراداً/مصروفاً تم تسجيله على الصندوق الخطأ.
                                            </p>
                                            {onOpenTransfer && (
                                                <div className="mt-2.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const fromRow = activeRows.find(r => r.cashbox.name === sessionStats.offsetSuggestion?.fromBox);
                                                            const toRow = activeRows.find(r => r.cashbox.name === sessionStats.offsetSuggestion?.toBox);
                                                            if (fromRow && toRow) {
                                                                onOpenTransfer(fromRow.cashbox.id, toRow.cashbox.id, sessionStats.offsetSuggestion!.amount);
                                                            }
                                                        }}
                                                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 shadow-sm transition-colors"
                                                    >
                                                        <ArrowLeftRight size={13} />
                                                        تسجيل تحويل داخلي لتسوية الصندوقين الآن
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Net Difference Summary */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <span className="text-xs font-bold text-slate-500">إجمالي الرصيد الدفتري (لكافة الصناديق)</span>
                                    <p className="mt-1 font-mono text-base font-black text-slate-900">
                                        {formatCurrency(sessionStats.totalExpected)}
                                    </p>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <span className="text-xs font-bold text-slate-500">إجمالي الرصيد الفعلي (المعدود)</span>
                                    <p className="mt-1 font-mono text-base font-black text-slate-900">
                                        {formatCurrency(sessionStats.totalActual)}
                                    </p>
                                </div>
                                <div className={clsx(
                                    "rounded-xl border p-3",
                                    sessionStats.netDifference === 0 ? "border-emerald-200 bg-emerald-50"
                                    : sessionStats.netDifference > 0 ? "border-blue-200 bg-blue-50"
                                    : "border-rose-200 bg-rose-50"
                                )}>
                                    <span className={clsx(
                                        "text-xs font-bold",
                                        sessionStats.netDifference === 0 ? "text-emerald-800"
                                        : sessionStats.netDifference > 0 ? "text-blue-800"
                                        : "text-rose-800"
                                    )}>
                                        صافي الفروقات الكلي عبر المعمل
                                    </span>
                                    <p className={clsx(
                                        "mt-1 font-mono text-base font-black",
                                        sessionStats.netDifference === 0 ? "text-emerald-700"
                                        : sessionStats.netDifference > 0 ? "text-blue-700"
                                        : "text-rose-700"
                                    )}>
                                        {sessionStats.netDifference === 0 ? '0.00 ج.م (مطابق تماماً)'
                                        : sessionStats.netDifference > 0 ? `+${formatCurrency(sessionStats.netDifference)} (فائض كلي)`
                                        : `${formatCurrency(sessionStats.netDifference)} (عجز كلي)`}
                                    </p>
                                </div>
                            </div>

                            {/* General Session Notes */}
                            <div className="rounded-xl border border-slate-100 bg-white p-3">
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    ملاحظات عامة على جلسة المطابقة (تُحفظ مع كافة الصناديق):
                                </label>
                                <input
                                    type="text"
                                    value={generalNotes}
                                    onChange={e => setGeneralNotes(e.target.value)}
                                    placeholder="مثال: جرد نهاية الأسبوع بحضور المدير المالي ومطابقة كشوف حسابات البنوك..."
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer Buttons */}
                    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-6 py-4">
                        <div className="text-xs text-slate-500 font-medium">
                            تم إدخال {sessionStats.filledCount} من {sessionStats.totalCount} صندوق
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-xs font-black text-white hover:bg-emerald-700 shadow-sm transition-colors disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw size={14} className="animate-spin" />
                                        جاري حفظ المطابقة...
                                    </>
                                ) : (
                                    <>
                                        <CheckCheck size={16} />
                                        اعتماد وحفظ مطابقة جميع الصناديق ({activeRows.length})
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
