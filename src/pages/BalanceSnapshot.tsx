/**
 * BalanceSnapshotPage — صفحة مخفية داخل التطبيق
 * تسحب الأرصدة الحالية وتحفظها في localStorage
 * بنفس منطق AccountInfoPanel تماماً
 *
 * المسار: /balance-snapshot (للادمن فقط)
 */

/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { db } from '../services/db';
import { financeService } from '../services/financeService';
import {
    getDoctorReceivableAmount,
    isDoctorStatementIncluded,
} from '../constants/orderLifecycle';
import { getLabCostMetadata } from '../constants/financialObligations';
import { hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION, isDesignerUser } from '../lib/userRoles';
import { useAuth } from '../context/AuthContext';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EntityBalance {
    entityType: 'doctor' | 'supplier' | 'designer';
    entityId: string;
    entityName: string;
    totalWork: number;
    totalPaid: number;
    totalAdjCharges: number;
    totalAdjCredits: number;
    balance: number;
    ordersCount: number;
    transactionsCount: number;
}

interface BalanceSnapshot {
    generatedAt: string;
    label: string;
    summary: {
        // يطابق totalEquity في Accounts.tsx (يجمع الموجب والسالب)
        totalDoctorReceivables: number;
        // تفصيل إضافي:
        totalDoctorDebts: number;    // فقط ما عليهم
        totalDoctorCredits: number;  // فقط ما دفعوا زيادة
        totalSupplierPayables: number;
        totalDesignerPayables: number;
    };
    entities: EntityBalance[];
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function BalanceSnapshotPage() {
    const { user } = useAuth();
    const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'comparing' | 'error'>('idle');
    const [snapshot, setSnapshot] = useState<BalanceSnapshot | null>(null);
    const [savedSnapshots, setSavedSnapshots] = useState<{ key: string; label: string; generatedAt: string }[]>([]);
    const [compareResult, setCompareResult] = useState<{
        diffs: { name: string; field: string; before: number; after: number; diff: number }[];
        totalDiff: number;
    } | null>(null);
    const [selectedCompareKey, setSelectedCompareKey] = useState<string>('');

    // Load saved snapshots from localStorage
    useEffect(() => {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('balance_snapshot_'));
        const list = keys.map(k => {
            try {
                const s = JSON.parse(localStorage.getItem(k) || '{}') as BalanceSnapshot;
                return { key: k, label: s.label, generatedAt: s.generatedAt };
            } catch { return null; }
        }).filter(Boolean) as { key: string; label: string; generatedAt: string }[];
        list.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSavedSnapshots(list);
    }, [snapshot]);

    // Only admin/accountant
    if (!user || !['admin', 'accountant'].includes(user.role || '')) {
        return <div className="p-8 text-center text-red-600 font-bold">غير مسموح</div>;
    }

    async function captureSnapshot(label: string) {
        setStatus('loading');
        setCompareResult(null);
        try {
            const [allOrdersRaw, doctors, suppliers, users, adjustments, transactions] = await Promise.all([
                db.getOrdersForFinanceSummary(),  // ← نفس Accounts.tsx تماماً
                db.getDoctors(),
                db.getSuppliers(),
                db.getUsers(),
                financeService.getAdjustments(),
                db.getTransactionsForFinanceSummary(),  // ← نفس Accounts.tsx تماماً
            ]);

            // نفس منطق isVisibleInAccountStatement في Accounts.tsx
            const allOrders = allOrdersRaw.filter(o => 
                !o.isArchived || ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Rejected'].includes(o.status || '')
            );

            const designers = users.filter(isDesignerUser);
            const primaryDoctors = doctors.filter(d => !d.parentId);
            const entities: EntityBalance[] = [];

            // ── Doctors ──────────────────────────────────────────────────────
            for (const doctor of primaryDoctors) {
                const entityIds = new Set([
                    doctor.id,
                    ...doctors.filter(d => d.parentId === doctor.id).map(d => d.id),
                ]);

                const entityOrders = allOrders.filter(o =>
                    !!o.doctorId && entityIds.has(o.doctorId) && isDoctorStatementIncluded(o)
                );
                const entityTransactions = transactions.filter(t =>
                    // نفس منطق Accounts.tsx: entityType === 'doctor' أو null (للسجلات القديمة)
                    (t.entityType === 'doctor' || !t.entityType) && t.entityId && entityIds.has(t.entityId)
                );
                const entityAdj = adjustments.filter(a =>
                    a.entity_type === 'doctor' && entityIds.has(a.entity_id)
                );

                const totalAdjCharges = entityAdj.filter(a => a.type === 'charge').reduce((s, a) => s + a.amount, 0);
                const totalAdjCredits = entityAdj.filter(a => a.type === 'credit').reduce((s, a) => s + a.amount, 0);

                const totalWork = entityOrders.reduce((s, o) => s + getDoctorReceivableAmount(o), 0) + totalAdjCharges;
                const totalPaid = entityTransactions.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount ?? 0), 0) + totalAdjCredits;

                entities.push({
                    entityType: 'doctor',
                    entityId: doctor.id,
                    entityName: doctor.name,
                    totalWork: round2(totalWork),
                    totalPaid: round2(totalPaid),
                    totalAdjCharges: round2(totalAdjCharges),
                    totalAdjCredits: round2(totalAdjCredits),
                    balance: round2(totalWork - totalPaid),
                    ordersCount: entityOrders.length,
                    transactionsCount: entityTransactions.length,
                });
            }

            // ── Suppliers ────────────────────────────────────────────────────
            for (const supplier of suppliers) {
                const entityOrders = allOrders.filter(o => o.supplierId === supplier.id);
                const entityTransactions = transactions.filter(t =>
                    (t.entityType === 'supplier' || !t.entityType) && t.entityId === supplier.id
                );
                const entityAdj = adjustments.filter(a =>
                    a.entity_type === 'supplier' && a.entity_id === supplier.id
                );

                // ← نفس Accounts.tsx سطر 437-444 للموردين:
                // charge → يُضاف للمدفوع (يُنقص الدين = خصم)
                // credit → يُضاف للعمل (المورد عمل أكثر = إضافة للدين)
                const totalAdjCharges = entityAdj.filter(a => a.type === 'charge').reduce((s, a) => s + a.amount, 0); // → totalPaid
                const totalAdjCredits = entityAdj.filter(a => a.type === 'credit').reduce((s, a) => s + a.amount, 0); // → totalWork

                let totalWork = 0;
                entityOrders.forEach(o => {
                    const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                    // نفس شرط Accounts.tsx تماماً
                    const isRelevant = (o.status !== 'Rejected' || hasRejectionCost) &&
                        ((o.status || '').toLowerCase() === 'delivered' ||
                         (o.status || '').toLowerCase() === 'cancelled' ||
                         hasRejectionCost);
                    if (!isRelevant) return;

                    // نفس منطق Accounts.tsx: دائماً getLabCostMetadata لكل الأوردرات
                    const designer = designers.find(d => d.id === o.designerId);
                    const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                    let cost = getLabCostMetadata(o, isSalaried).cost;

                    if (o.status === 'Cancelled') cost = 0;
                    else if (o.status === 'Rejected') {
                        cost = hasRejectionCost ? o.rejectedLabCost! : 0;
                    }
                    totalWork += cost;
                });
                // charge → يُنقص الدين = يُضاف للمدفوع (خصم على المورد)
                // credit → يُزيد العمل = يُضاف للعمل (المورد عمل أكثر)
                totalWork += totalAdjCredits;

                const totalPaid = entityTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount ?? 0), 0) + totalAdjCharges;

                entities.push({
                    entityType: 'supplier',
                    entityId: supplier.id,
                    entityName: supplier.name,
                    totalWork: round2(totalWork),
                    totalPaid: round2(totalPaid),
                    totalAdjCharges: round2(totalAdjCharges),
                    totalAdjCredits: round2(totalAdjCredits),
                    balance: round2(totalWork - totalPaid),
                    ordersCount: entityOrders.length,
                    transactionsCount: entityTransactions.length,
                });
            }

            // ── Designers ────────────────────────────────────────────────────
            for (const designer of designers) {
                const entityOrders = allOrders.filter(o => o.designerId === designer.id);
                const entityTransactions = transactions.filter(t =>
                    (t.entityType === 'designer' || !t.entityType) && t.entityId === designer.id
                );
                const entityAdj = adjustments.filter(a =>
                    a.entity_type === 'designer' && a.entity_id === designer.id
                );

                const totalAdjCharges = entityAdj.filter(a => a.type === 'charge').reduce((s, a) => s + a.amount, 0);
                const totalAdjCredits = entityAdj.filter(a => a.type === 'credit').reduce((s, a) => s + a.amount, 0);

                // نفس Accounts.tsx سطر 484:
                // totalCredit = isSalaried ? 0 : oStats.totalCredit
                // يعني المصمم بمرتب ثابت يستحق صفر من الأوردرات
                const isSalaried = hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION);

                let totalWork = 0;
                if (!isSalaried) {
                    entityOrders.forEach(o => {
                        const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                        const isRelevant = o.workflowType === 'split' &&
                            (o.designStatus === 'completed' || o.status === 'Rejected' || o.status === 'Cancelled' || hasRejectionCost);
                        if (!isRelevant) return;
                        // نفس منطق Accounts.tsx سطر 393:
                        // price = (Cancelled||Rejected) ? 0 : getEffectiveDesignPrice
                        let price = (o.status === 'Cancelled' || o.status === 'Rejected') ? 0 : (o.designPrice || 0);
                        if (hasRejectionCost) price = o.rejectedLabCost!;
                        totalWork += price;
                    });
                }
                // التسويات تضاف حتى للمرتب الثابت
                totalWork += totalAdjCharges;

                const totalPaid = entityTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount ?? 0), 0) + totalAdjCredits;

                entities.push({
                    entityType: 'designer',
                    entityId: designer.id,
                    entityName: designer.name,
                    totalWork: round2(totalWork),
                    totalPaid: round2(totalPaid),
                    totalAdjCharges: round2(totalAdjCharges),
                    totalAdjCredits: round2(totalAdjCredits),
                    balance: round2(totalWork - totalPaid),
                    ordersCount: entityOrders.length,
                    transactionsCount: entityTransactions.length,
                });
            }

            const doctors_ = entities.filter(e => e.entityType === 'doctor');
            const suppliers_ = entities.filter(e => e.entityType === 'supplier');
            const designers_ = entities.filter(e => e.entityType === 'designer');

            const snap: BalanceSnapshot = {
                generatedAt: new Date().toISOString(),
                label,
                summary: {
                    // ← يطابق بالضبط رقم "إجمالي الأرصدة" في Accounts.tsx:
                    //   totalEquity = filteredSummary.reduce((sum, item) => sum + item.balance, 0)
                    //   (يجمع الموجب والسالب معاً — الأطباء اللي دفعوا زيادة بيخفضوا الرقم)
                    totalDoctorReceivables: round2(doctors_.reduce((s, e) => s + e.balance, 0)),
                    // ← رقم إضافي للمقارنة: فقط الأرصدة الموجبة (ديون)
                    totalDoctorDebts: round2(doctors_.reduce((s, e) => s + Math.max(0, e.balance), 0)),
                    totalDoctorCredits: round2(doctors_.reduce((s, e) => s + Math.max(0, -e.balance), 0)),
                    totalSupplierPayables: round2(suppliers_.reduce((s, e) => s + e.balance, 0)),
                    totalDesignerPayables: round2(designers_.reduce((s, e) => s + e.balance, 0)),
                },
                entities,
            };


            // Save to localStorage
            const key = `balance_snapshot_${Date.now()}`;
            localStorage.setItem(key, JSON.stringify(snap));
            setSnapshot(snap);
            setStatus('done');
        } catch (err) {
            console.error(err);
            setStatus('error');
        }
    }

    function compareWithSaved() {
        if (!snapshot || !selectedCompareKey) return;
        const savedRaw = localStorage.getItem(selectedCompareKey);
        if (!savedRaw) return;

        const before = JSON.parse(savedRaw) as BalanceSnapshot;
        const after = snapshot;
        const beforeMap = new Map(before.entities.map(e => [`${e.entityType}:${e.entityId}`, e]));

        const diffs: { name: string; field: string; before: number; after: number; diff: number }[] = [];
        let totalDiff = 0;

        for (const aft of after.entities) {
            const bef = beforeMap.get(`${aft.entityType}:${aft.entityId}`);
            if (!bef) continue;
            const fields: Array<keyof EntityBalance> = ['totalWork', 'totalPaid', 'balance'];
            for (const field of fields) {
                const bVal = bef[field] as number;
                const aVal = aft[field] as number;
                const diff = round2(aVal - bVal);
                if (Math.abs(diff) > 0.005) {
                    diffs.push({ name: `${aft.entityName} (${aft.entityType})`, field, before: bVal, after: aVal, diff });
                    totalDiff += Math.abs(diff);
                }
            }
        }

        setCompareResult({ diffs, totalDiff: round2(totalDiff) });
        setStatus('comparing');
    }

    function deleteSnapshot(key: string) {
        localStorage.removeItem(key);
        setSavedSnapshots(prev => prev.filter(s => s.key !== key));
    }

    function downloadSnapshot(snap: BalanceSnapshot) {
        const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `balance_snapshot_${snap.label}_${snap.generatedAt.slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const doctors = snapshot?.entities.filter(e => e.entityType === 'doctor') || [];
    const suppliers = snapshot?.entities.filter(e => e.entityType === 'supplier') || [];
    const designers = snapshot?.entities.filter(e => e.entityType === 'designer') || [];

    return (
        <div className="min-h-screen bg-gray-50 p-6 space-y-6" dir="rtl">
            {/* Header */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-xl font-bold text-gray-900">📸 حفظ snapshot الأرصدة</h1>
                    <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-bold">للمحاسب والأدمن فقط</span>
                </div>
                <p className="text-sm text-gray-500">
                    يحسب الأرصدة بنفس منطق شاشات الحسابات الحالية — لضمان عدم تغيير أي رقم ولو جنيه واحد.
                </p>
            </div>

            {/* Capture Buttons */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h2 className="font-bold text-gray-800 mb-4">📌 التقاط snapshot جديد</h2>
                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={() => captureSnapshot('before_ui_changes')}
                        disabled={status === 'loading'}
                        className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-100"
                        id="btn-capture-before"
                    >
                        {status === 'loading' ? '⏳ جاري الحساب...' : '📸 قبل التغييرات'}
                    </button>
                    <button
                        onClick={() => captureSnapshot('after_ui_changes')}
                        disabled={status === 'loading'}
                        className="px-5 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-emerald-100"
                        id="btn-capture-after"
                    >
                        {status === 'loading' ? '⏳ جاري الحساب...' : '✅ بعد التغييرات'}
                    </button>
                </div>
            </div>

            {/* Saved Snapshots + Compare */}
            {savedSnapshots.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <h2 className="font-bold text-gray-800 mb-4">🗂️ الـ Snapshots المحفوظة</h2>
                    <div className="space-y-2 mb-4">
                        {savedSnapshots.map(s => (
                            <div key={s.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="radio"
                                        name="compare-select"
                                        id={`snap-${s.key}`}
                                        value={s.key}
                                        checked={selectedCompareKey === s.key}
                                        onChange={() => setSelectedCompareKey(s.key)}
                                        className="accent-blue-600"
                                    />
                                    <label htmlFor={`snap-${s.key}`} className="text-sm font-medium text-gray-800 cursor-pointer">
                                        <span className="font-bold">{s.label}</span>
                                        <span className="text-gray-400 text-xs mr-2">{new Date(s.generatedAt).toLocaleString('ar-EG')}</span>
                                    </label>
                                </div>
                                <button
                                    onClick={() => deleteSnapshot(s.key)}
                                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                                >
                                    حذف
                                </button>
                            </div>
                        ))}
                    </div>
                    {snapshot && selectedCompareKey && (
                        <button
                            onClick={compareWithSaved}
                            className="px-5 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-100"
                            id="btn-compare"
                        >
                            🔍 قارن مع الـ Snapshot المختار
                        </button>
                    )}
                </div>
            )}

            {/* Compare Results */}
            {compareResult && (
                <div className={`rounded-2xl shadow-sm border p-6 ${compareResult.diffs.length === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <h2 className={`font-bold text-lg mb-4 ${compareResult.diffs.length === 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                        {compareResult.diffs.length === 0
                            ? '✅ ممتاز! الأرصدة متطابقة تماماً — لا يوجد أي فرق'
                            : `❌ تم اكتشاف ${compareResult.diffs.length} فرق — إجمالي: ${compareResult.totalDiff.toLocaleString()} ج.م`
                        }
                    </h2>
                    {compareResult.diffs.length > 0 && (
                        <div className="space-y-2">
                            {compareResult.diffs.map((d, i) => (
                                <div key={i} className="bg-white rounded-xl p-4 border border-red-100 text-sm">
                                    <div className="font-bold text-gray-900 mb-1">{d.name} — {d.field}</div>
                                    <div className="flex gap-4 text-gray-600">
                                        <span>قبل: <strong>{d.before.toLocaleString()}</strong></span>
                                        <span>بعد: <strong>{d.after.toLocaleString()}</strong></span>
                                        <span className={`font-bold ${d.diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                            فرق: {d.diff > 0 ? '+' : ''}{d.diff.toLocaleString()} ج.م
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Current Snapshot Display */}
            {snapshot && (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* الكارد الرئيسي - يطابق Accounts.tsx "إجمالي الأرصدة" */}
                        <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-2xl text-white shadow-lg">
                            <p className="text-slate-400 text-xs font-medium mb-1">إجمالي الأرصدة (مطابق Accounts)</p>
                            <p className="text-2xl font-bold">
                                {Math.abs(snapshot.summary.totalDoctorReceivables).toLocaleString()}
                                <span className="text-sm font-normal text-slate-400"> ج.م</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                {snapshot.summary.totalDoctorReceivables > 0 ? '🔴 مستحقات' : '🟢 سلف زيادة'}
                            </p>
                        </div>
                        <SummaryCard
                            title={`ديون الأطباء (${snapshot.summary.totalDoctorDebts > 0 ? 'على الأطباء' : 'لا يوجد'})`}
                            value={snapshot.summary.totalDoctorDebts}
                            color="blue"
                        />
                        <SummaryCard
                            title="مدفوع زيادة (سلف للأطباء)"
                            value={snapshot.summary.totalDoctorCredits}
                            color="green"
                        />
                        <SummaryCard
                            title="إجمالي مستحق للموردين"
                            value={snapshot.summary.totalSupplierPayables}
                            color="orange"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-400">تم الحساب: {new Date(snapshot.generatedAt).toLocaleString('ar-EG')}</p>
                        <button
                            onClick={() => downloadSnapshot(snapshot)}
                            className="text-sm text-blue-600 hover:underline"
                        >
                            ⬇️ تحميل كـ JSON
                        </button>
                    </div>

                    {/* Tables */}
                    <BalanceTable title="الأطباء" color="blue" entities={doctors} />
                    <BalanceTable title="الموردون" color="orange" entities={suppliers} />
                    <BalanceTable title="المصممون" color="pink" entities={designers} />
                </>
            )}
        </div>
    );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ title, value, color }: { title: string; value: number; color: string }) {
    const colors: Record<string, string> = {
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        orange: 'bg-orange-50 border-orange-200 text-orange-800',
        pink: 'bg-pink-50 border-pink-200 text-pink-800',
        green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    };
    return (
        <div className={`rounded-2xl border p-5 ${colors[color]}`}>
            <p className="text-xs font-medium opacity-70 mb-1">{title}</p>
            <p className="text-2xl font-bold">{value.toLocaleString()} <span className="text-sm">ج.م</span></p>
        </div>
    );
}

function BalanceTable({ title, color, entities }: { title: string; color: string; entities: EntityBalance[] }) {
    const headerColors: Record<string, string> = {
        blue: 'bg-blue-600',
        orange: 'bg-orange-500',
        pink: 'bg-pink-500',
    };
    const nonZero = entities.filter(e => Math.abs(e.balance) > 0.005);
    if (nonZero.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className={`${headerColors[color]} text-white px-6 py-3 font-bold`}>
                {title} ({nonZero.length} بحساب رصيد)
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                    <thead className="bg-gray-50 text-gray-500">
                        <tr>
                            <th className="p-3 font-medium">الاسم</th>
                            <th className="p-3 font-medium text-center">إجمالي العمل</th>
                            <th className="p-3 font-medium text-center">المدفوع</th>
                            <th className="p-3 font-medium text-center">الرصيد</th>
                            <th className="p-3 font-medium text-center">الحالة</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {nonZero.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).map(e => (
                            <tr key={e.entityId} className="hover:bg-gray-50 transition-colors">
                                <td className="p-3 font-medium text-gray-900">{e.entityName}</td>
                                <td className="p-3 text-center text-gray-600">{e.totalWork.toLocaleString()}</td>
                                <td className="p-3 text-center text-gray-600">{e.totalPaid.toLocaleString()}</td>
                                <td className={`p-3 text-center font-bold ${e.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {Math.abs(e.balance).toLocaleString()}
                                </td>
                                <td className="p-3 text-center">
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                        e.balance > 0
                                            ? 'bg-red-50 text-red-700'
                                            : 'bg-emerald-50 text-emerald-700'
                                    }`}>
                                        {e.balance > 0 ? 'عليه / دائن للمعمل' : 'له / دائن للطرف'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                        <tr>
                            <td className="p-3 text-gray-700">الإجمالي</td>
                            <td className="p-3 text-center">{nonZero.reduce((s, e) => s + e.totalWork, 0).toLocaleString()}</td>
                            <td className="p-3 text-center">{nonZero.reduce((s, e) => s + e.totalPaid, 0).toLocaleString()}</td>
                            <td className="p-3 text-center text-red-700">
                                {nonZero.reduce((s, e) => s + Math.max(0, e.balance), 0).toLocaleString()}
                            </td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
