import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Order, type EntityBillingSettings, type AgingBuckets, type Doctor, type Supplier, type User, type Transaction } from '../services/db';
import { matchArabic } from '../lib/searchUtils';
import { calculateDueDate, BILLING_ENTITY_TYPES } from '../constants/billingSettings';
import { getDoctorReceivableAmount, getOfficialStatementDate, isDoctorStatementIncluded } from '../constants/orderLifecycle';
import { getLabCostMetadata } from '../constants/financialObligations';
import { financeService, type Adjustment } from '../services/financeService';
import { hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION, isDesignerUser } from '../lib/userRoles';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Clock, Search, Calendar, AlertTriangle, 
    CheckCircle2, DollarSign, ArrowLeftRight,
    Users, Factory, Palette, Phone, ScissorsLineDashed
} from 'lucide-react';
import clsx from 'clsx';

// ── Types ────────────────────────────────────────────────────────────────────

type TabType = 'doctors' | 'suppliers' | 'designers';

interface DebitItem {
    type: 'order' | 'adjustment';
    id?: string;
    caseId?: string | null;
    patientName?: string | null;
    triggerDate: string;
    amount: number;
    order?: Partial<Order> | Order;
    reason?: string | null;
}

interface CreditItem {
    type: 'payment' | 'adjustment';
    amount: number;
    date: string;
}

// ─── Module Constants ─────────────────────────────────────────────────────────

const entityTypeMap = {
    doctors: BILLING_ENTITY_TYPES.doctor,
    suppliers: BILLING_ENTITY_TYPES.externalLab,
    designers: BILLING_ENTITY_TYPES.designer
} as const;

interface SummaryStats {
    totalEntities: number;
    totalCurrent: number;
    total1to30: number;
    total31to60: number;
    totalOver60: number;
    grandTotal: number;
}

interface FIFOObligation {
    obligationId: string;
    orderId: string;
    caseId: string | null;
    patientName: string | null;
    triggerDate: string;
    dueDate: string;
    remainingAmount: number;
    daysPastDue: number;
    bucket: 'current' | '1_30' | '31_60' | 'over_60';
    type: 'order' | 'adjustment';
    reason: string | null;
    itemsText?: string;
}

interface FIFOEntityReport {
    entityId: string;
    entityName: string;
    entityCode: string | null;
    entityPhone: string | null;
    aging: AgingBuckets;
    obligations: FIFOObligation[];
    settings: EntityBillingSettings;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const todayDateString = (): string => {
    return new Date().toISOString().split('T')[0];
};

function daysBetween(from: string, to: string): number {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export default function AgingReport() {
    const { user } = useAuth();

    // ─ State
    const [activeTab, setActiveTab] = useState<TabType>('doctors');
    const [search, setSearch] = useState('');
    const [minAmount, setMinAmount] = useState<number>(0);
    const [asOfDate, setAsOfDate] = useState(todayDateString());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedBucketFilter, setSelectedBucketFilter] = useState<'all' | 'current' | '1_30' | '31_60' | 'over_60'>('all');

    // ── Adjustment modal state
    const [adjModal, setAdjModal] = useState<{
        open: boolean;
        entityId: string;
        entityName: string;
        entityType: 'doctor' | 'supplier' | 'designer';
        amount: string;
        reason: string;
        date: string;
        saving: boolean;
    }>({
        open: false, entityId: '', entityName: '', entityType: 'doctor',
        amount: '', reason: '', date: todayDateString(), saving: false
    });
    
    // Data state
    const [orders, setOrders] = useState<Partial<Order>[]>([]);
    const [transactions, setTransactions] = useState<Partial<Transaction>[]>([]);
    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [billingSettingsMap, setBillingSettingsMap] = useState<Map<string, EntityBillingSettings>>(new Map());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const [o, t, adj, doc, sup, usr] = await Promise.all([
                    db.getOrdersForFinanceSummary(),
                    db.getTransactionsForFinanceSummary(),
                    financeService.getAdjustments(),
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers()
                ]);
                setOrders(o || []);
                setTransactions(t || []);
                setAdjustments(adj || []);
                setDoctors(doc || []);
                setSuppliers(sup || []);
                const designersList = (usr || []).filter(isDesignerUser);
                setDesigners(designersList);

                // Fetch billing settings for all entities to calculate due dates in FIFO
                const settingsPromises: Promise<{ key: string; s: EntityBillingSettings | null }>[] = [];
                const docIds = (doc || []).filter((d) => !d.parentId).map((d) => d.id);
                const supIds = (sup || []).map((s) => s.id);
                const desIds = designersList.map((d) => d.id);

                docIds.forEach((id: string) => settingsPromises.push(db.getEntityBillingSettings(BILLING_ENTITY_TYPES.doctor, id).then(s => ({ key: `doctor:${id}`, s }))));
                supIds.forEach((id: string) => settingsPromises.push(db.getEntityBillingSettings(BILLING_ENTITY_TYPES.externalLab, id).then(s => ({ key: `external_lab:${id}`, s }))));
                desIds.forEach((id: string) => settingsPromises.push(db.getEntityBillingSettings(BILLING_ENTITY_TYPES.designer, id).then(s => ({ key: `designer:${id}`, s }))));

                const settingsResults = await Promise.all(settingsPromises);
                const settingsMap = new Map<string, EntityBillingSettings>();
                settingsResults.forEach(r => {
                    if (r?.s) settingsMap.set(r.key, r.s);
                });
                setBillingSettingsMap(settingsMap);
            } catch (e) {
                console.error('Failed to load aging report data:', e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [activeTab]);

    // ── Reload data after an adjustment is saved
    const reloadData = async () => {
        try {
            const [o, t, adj] = await Promise.all([
                db.getOrdersForFinanceSummary(),
                db.getTransactionsForFinanceSummary(),
                financeService.getAdjustments()
            ]);
            setOrders(o || []);
            setTransactions(t || []);
            setAdjustments(adj || []);
        } catch (e) {
            console.error('reload failed', e);
        }
    };

    // ── Save quick adjustment
    const handleSaveAdjustment = async (e: React.FormEvent) => {
        e.preventDefault();
        const amt = parseFloat(adjModal.amount);
        if (!amt || amt <= 0 || !adjModal.reason.trim()) return;
        setAdjModal(m => ({ ...m, saving: true }));
        try {
            await financeService.addAdjustment({
                entity_type: adjModal.entityType,
                entity_id:   adjModal.entityId,
                amount:      amt,
                type:        'credit',   // خصم = دائن (يُقلل ما يستحق على الطبيب)
                date:        adjModal.date,
                reason:      adjModal.reason.trim()
            });
            setAdjModal(m => ({ ...m, open: false, amount: '', reason: '', saving: false }));
            await reloadData();
        } catch (err) {
            console.error(err);
            setAdjModal(m => ({ ...m, saving: false }));
            alert('حدث خطأ أثناء حفظ التسوية');
        }
    };

    // ─ Derived data

    // FIFO Aging Calculation Engine
    const agingData = useMemo(() => {
        if (loading) {
            const emptyRows: FIFOEntityReport[] = [];
            const initialSummary: SummaryStats = { totalEntities: 0, totalCurrent: 0, total1to30: 0, total31to60: 0, totalOver60: 0, grandTotal: 0 };
            return {
                rows: emptyRows,
                summary: initialSummary
            };
        }

        const visibleOrders = orders.filter(o => !o.isDeleted && (!o.isArchived || ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled'].includes(o.status || '')));

        // Determine entities to process
        let targetEntities: (Doctor | Supplier | User)[] = [];
        let entityType: 'doctor' | 'external_lab' | 'designer' = 'doctor';
        if (activeTab === 'doctors') {
            targetEntities = doctors.filter((d) => !d.parentId);
            entityType = 'doctor';
        } else if (activeTab === 'suppliers') {
            targetEntities = suppliers;
            entityType = 'external_lab';
        } else {
            targetEntities = designers;
            entityType = 'designer';
        }

        const rows: FIFOEntityReport[] = [];
        const globalSummary: SummaryStats = {
            totalEntities: 0,
            totalCurrent: 0,
            total1to30: 0,
            total31to60: 0,
            totalOver60: 0,
            grandTotal: 0
        };

        for (const entity of targetEntities) {
            const settingsKey = entityType === 'external_lab' ? `external_lab:${entity.id}` : `${entityType}:${entity.id}`;
            const settings = billingSettingsMap.get(settingsKey) || {
                entityType: entityTypeMap[activeTab],
                entityId: entity.id,
                billingMode: 'per_order',
                billingDay: null,
                perOrderDueDays: 7,
                autoApplyCredit: true
            };

            // 1. Gather all debits and credits
            const debits: DebitItem[] = [];
            const credits: CreditItem[] = [];

            if (entityType === 'doctor') {
                const entityIds = new Set([
                    entity.id,
                    ...doctors.filter((d) => d.parentId === entity.id).map((d) => d.id)
                ]);

                // Orders
                visibleOrders.forEach(o => {
                    if (o.doctorId && entityIds.has(o.doctorId) && isDoctorStatementIncluded(o)) {
                        const amount = getDoctorReceivableAmount(o);
                        const triggerDate = getOfficialStatementDate(o);
                        if (amount > 0) {
                            debits.push({
                                type: 'order',
                                id: o.id,
                                caseId: o.caseId,
                                patientName: o.patientName,
                                triggerDate,
                                amount,
                                order: o
                            });
                        }
                    }
                });

                // Transactions
                transactions.forEach(t => {
                    if ((t.entityType === 'doctor' || !t.entityType) && t.entityId && entityIds.has(t.entityId)) {
                        if (t.type === 'income') {
                            credits.push({ type: 'payment', amount: t.amount || 0, date: t.date || '' });
                        }
                    }
                });

                // Adjustments
                adjustments.forEach(adj => {
                    if (adj.entity_type === 'doctor' && entityIds.has(adj.entity_id)) {
                        if (adj.type === 'charge') {
                            debits.push({
                                type: 'adjustment',
                                id: adj.id,
                                triggerDate: adj.date,
                                amount: adj.amount,
                                reason: adj.reason
                            });
                        } else {
                            credits.push({ type: 'adjustment', amount: adj.amount, date: adj.date });
                        }
                    }
                });
            } else if (entityType === 'external_lab') {
                // Supplier
                visibleOrders.forEach(o => {
                    if (o.supplierId === entity.id) {
                        const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                        const isRelevant = (o.status !== 'Rejected' || hasRejectionCost) &&
                            ((o.status || '').toLowerCase() === 'delivered' ||
                             (o.status || '').toLowerCase() === 'cancelled' ||
                             hasRejectionCost);
                        if (!isRelevant) return;

                        const designer = designers.find(d => d.id === o.designerId);
                        const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                        let cost = getLabCostMetadata(o, isSalaried).cost;

                        if (o.status === 'Cancelled') cost = 0;
                        else if (o.status === 'Rejected') {
                            cost = hasRejectionCost ? o.rejectedLabCost! : 0;
                        }

                        if (cost > 0) {
                            debits.push({
                                type: 'order',
                                id: o.id,
                                caseId: o.caseId,
                                patientName: o.patientName,
                                triggerDate: (o.deliveryDate || o.createdAt || '').split('T')[0],
                                amount: cost,
                                order: o
                            });
                        }
                    }
                });

                transactions.forEach(t => {
                    if ((t.entityType === 'supplier' || !t.entityType) && t.entityId === entity.id) {
                        if (t.type === 'expense') {
                            credits.push({ type: 'payment', amount: t.amount || 0, date: t.date || '' });
                        }
                    }
                });

                adjustments.forEach(adj => {
                    if (adj.entity_type === 'supplier' && adj.entity_id === entity.id) {
                        if (adj.type === 'credit') {
                            debits.push({
                                type: 'adjustment',
                                id: adj.id,
                                triggerDate: adj.date,
                                amount: adj.amount,
                                reason: adj.reason
                            });
                        } else {
                            credits.push({ type: 'adjustment', amount: adj.amount, date: adj.date });
                        }
                    }
                });
            } else {
                // Designer
                const isSalaried = ('role' in entity) ? hasCustomPermission(entity, FIXED_SALARY_DESIGNER_PERMISSION) : false;

                if (!isSalaried) {
                    visibleOrders.forEach(o => {
                        if (o.designerId === entity.id) {
                            const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                            const isRelevant = o.workflowType === 'split' &&
                                (o.designStatus === 'completed' || o.status === 'Rejected' || o.status === 'Cancelled' || hasRejectionCost);
                            if (!isRelevant) return;

                            let price = (o.status === 'Cancelled' || o.status === 'Rejected') ? 0 : (o.designPrice || 0);
                            if (hasRejectionCost) price = o.rejectedLabCost!;

                            if (price > 0) {
                                debits.push({
                                    type: 'order',
                                    id: o.id,
                                    caseId: o.caseId,
                                    patientName: o.patientName,
                                    triggerDate: (o.deliveryDate || o.createdAt || '').split('T')[0],
                                    amount: price,
                                    order: o
                                });
                            }
                        }
                    });
                }

                transactions.forEach(t => {
                    if ((t.entityType === 'designer' || !t.entityType) && t.entityId === entity.id) {
                        if (t.type === 'expense') {
                            credits.push({ type: 'payment', amount: t.amount || 0, date: t.date || '' });
                        }
                    }
                });

                adjustments.forEach(adj => {
                    if (adj.entity_type === 'designer' && adj.entity_id === entity.id) {
                        if (adj.type === 'charge') {
                            debits.push({
                                type: 'adjustment',
                                id: adj.id,
                                triggerDate: adj.date,
                                amount: adj.amount,
                                reason: adj.reason
                            });
                        } else {
                            credits.push({ type: 'adjustment', amount: adj.amount, date: adj.date });
                        }
                    }
                });
            }

            // 2. Perform FIFO matching
            let totalCredits = credits.reduce((sum, c) => sum + c.amount, 0);

            // Sort debits chronologically (oldest first)
            debits.sort((a, b) => a.triggerDate.localeCompare(b.triggerDate));

            const aging: AgingBuckets = { current: 0, days1to30: 0, days31to60: 0, over60Days: 0, total: 0 };
            const obligations: FIFOObligation[] = [];

            for (const deb of debits) {
                const amount = deb.amount;
                let remainingUnpaid = 0;

                if (totalCredits >= amount) {
                    totalCredits -= amount;
                    remainingUnpaid = 0;
                } else {
                    remainingUnpaid = amount - totalCredits;
                    totalCredits = 0;
                }

                if (remainingUnpaid > 0.005) {
                    // Calculate Due Date based on Billing settings
                    const dueDate = calculateDueDate({
                        billingMode: settings.billingMode,
                        billingDay: settings.billingDay,
                        triggerDate: deb.triggerDate,
                        perOrderDueDays: settings.perOrderDueDays
                    });

                    // Calculate Days Overdue
                    const daysPastDue = daysBetween(dueDate, asOfDate);
                    
                    let bucket: 'current' | '1_30' | '31_60' | 'over_60' = 'current';
                    if (daysPastDue > 0) {
                        if (daysPastDue <= 30) bucket = '1_30';
                        else if (daysPastDue <= 60) bucket = '31_60';
                        else bucket = 'over_60';
                    }

                    const itemsText = deb.order?.items?.map((i) => {
                        const count = i.teethNumbers?.length || 1;
                        return `${i.serviceType || '-'}(${count})`;
                    }).join(' + ');

                    obligations.push({
                        obligationId: deb.id || '',
                        orderId: deb.type === 'order' ? (deb.id || '') : '',
                        caseId: deb.caseId || null,
                        patientName: deb.patientName || null,
                        triggerDate: deb.triggerDate,
                        dueDate,
                        remainingAmount: remainingUnpaid,
                        daysPastDue,
                        bucket,
                        type: deb.type,
                        reason: deb.reason || null,
                        itemsText
                    });

                    aging.total += remainingUnpaid;
                    if (bucket === 'current') aging.current += remainingUnpaid;
                    else if (bucket === '1_30') aging.days1to30 += remainingUnpaid;
                    else if (bucket === '31_60') aging.days31to60 += remainingUnpaid;
                    else aging.over60Days += remainingUnpaid;
                }
            }

            // Round values
            aging.total = round2(aging.total);
            aging.current = round2(aging.current);
            aging.days1to30 = round2(aging.days1to30);
            aging.days31to60 = round2(aging.days31to60);
            aging.over60Days = round2(aging.over60Days);

            // Add entity row if they have outstanding debt
            if (aging.total > minAmount + 0.005) {
                rows.push({
                    entityId: entity.id,
                    entityName: entity.name,
                    entityCode: 'doctorCode' in entity ? entity.doctorCode || null : null,
                    entityPhone: 'phone' in entity ? entity.phone || null : null,
                    aging,
                    obligations,
                    settings
                });

                globalSummary.grandTotal += aging.total;
                globalSummary.totalCurrent += aging.current;
                globalSummary.total1to30 += aging.days1to30;
                globalSummary.total31to60 += aging.days31to60;
                globalSummary.totalOver60 += aging.over60Days;
                globalSummary.totalEntities += 1;
            }
        }

        globalSummary.grandTotal = round2(globalSummary.grandTotal);
        globalSummary.totalCurrent = round2(globalSummary.totalCurrent);
        globalSummary.total1to30 = round2(globalSummary.total1to30);
        globalSummary.total31to60 = round2(globalSummary.total31to60);
        globalSummary.totalOver60 = round2(globalSummary.totalOver60);

        return { rows, summary: globalSummary };
    }, [loading, activeTab, orders, transactions, adjustments, doctors, suppliers, designers, billingSettingsMap, asOfDate, minAmount]);

    // Filter, Sort and Selection list of entities (left panel)
    const summaries = useMemo(() => {
        const filteredList = agingData.rows.filter((r) => {
            // Text search filter
            if (search.trim() && !matchArabic(r.entityName, search) && !(r.entityCode && matchArabic(r.entityCode, search))) {
                return false;
            }
            // Bucket category filter
            if (selectedBucketFilter !== 'all') {
                if (selectedBucketFilter === 'current' && r.aging.current <= 0) return false;
                if (selectedBucketFilter === '1_30' && r.aging.days1to30 <= 0) return false;
                if (selectedBucketFilter === '31_60' && r.aging.days31to60 <= 0) return false;
                if (selectedBucketFilter === 'over_60' && r.aging.over60Days <= 0) return false;
            }
            return true;
        });

        // SORT BY LARGEST OUTSTANDING DEBT (أكبر مبالغ مستحقة)
        filteredList.sort((a, b) => b.aging.total - a.aging.total);

        return filteredList;
    }, [agingData, search, selectedBucketFilter]);

    // Auto-select first entity when list updates or tab changes
    useEffect(() => {
        if (summaries.length > 0) {
            const exists = summaries.some(s => s.entityId === selectedId);
            if (!exists) {
                setSelectedId(summaries[0].entityId);
            }
        } else {
            setSelectedId(null);
        }
    }, [summaries, selectedId]);

    const selectedEntityReport = useMemo(() => {
        if (!selectedId) return null;
        return agingData.rows.find(r => r.entityId === selectedId) || null;
    }, [selectedId, agingData]);

    // ─ Color Theme configuration
    const theme = useMemo(() => {
        switch (activeTab) {
            case 'doctors':
                return {
                    primary: 'bg-teal-700',
                    primaryText: 'text-teal-700',
                    border: 'border-teal-700',
                    lightBg: 'bg-teal-50',
                    accentText: 'text-teal-600',
                    gradient: 'from-teal-600 to-teal-800',
                    activeRing: 'ring-teal-500 border-teal-500'
                };
            case 'suppliers':
                return {
                    primary: 'bg-indigo-700',
                    primaryText: 'text-indigo-700',
                    border: 'border-indigo-700',
                    lightBg: 'bg-indigo-50',
                    accentText: 'text-indigo-600',
                    gradient: 'from-indigo-600 to-indigo-800',
                    activeRing: 'ring-indigo-500 border-indigo-500'
                };
            case 'designers':
                return {
                    primary: 'bg-amber-600',
                    primaryText: 'text-amber-600',
                    border: 'border-amber-600',
                    lightBg: 'bg-amber-50',
                    accentText: 'text-amber-600',
                    gradient: 'from-amber-500 to-amber-700',
                    activeRing: 'ring-amber-500 border-amber-500'
                };
        }
    }, [activeTab]);

    return (
        <>
        <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-800 dir-rtl" style={{ direction: 'rtl' }}>
            
            {/* Header section with page title */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">تقرير أعمار الديون والمستحقات</h1>
                    <p className="text-xs text-slate-500 mt-1">
                        تتبع المبالغ المستحقة غير المسددة وفئاتها الزمنية بناءً على دورة الفوترة المعتمدة بنظام FIFO المطابق للأرصدة الفعلية
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <button
                        onClick={() => { setActiveTab('doctors'); setSearch(''); setSelectedId(null); setSelectedBucketFilter('all'); }}
                        className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                            activeTab === 'doctors' ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
                        )}
                    >
                        <Users size={14} />
                        تحصيلات الأطباء
                    </button>
                    <button
                        onClick={() => { setActiveTab('suppliers'); setSearch(''); setSelectedId(null); setSelectedBucketFilter('all'); }}
                        className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                            activeTab === 'suppliers' ? 'bg-indigo-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
                        )}
                    >
                        <Factory size={14} />
                        مستحقات الموردين
                    </button>
                    <button
                        onClick={() => { setActiveTab('designers'); setSearch(''); setSelectedId(null); setSelectedBucketFilter('all'); }}
                        className={clsx(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                            activeTab === 'designers' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
                        )}
                    >
                        <Palette size={14} />
                        أتعاب المصممين
                    </button>
                </div>
            </div>

            {/* Quick stats widgets (With Filter triggers) */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Total Outstanding Card (Clears filters) */}
                <div 
                    onClick={() => setSelectedBucketFilter('all')}
                    className={clsx(
                        "p-4 rounded-2xl border cursor-pointer relative overflow-hidden transition-all hover:shadow-md",
                        selectedBucketFilter === 'all' ? "ring-2 ring-slate-700 border-transparent shadow-md bg-slate-50/50 scale-[1.01]" : "bg-white border-slate-200 shadow-sm"
                    )}
                >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 rounded-full -mr-6 -mt-6 -z-10" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الإجمالي المستحق</span>
                    <h3 className="text-lg md:text-xl font-extrabold text-slate-800 font-mono mt-1">{fmt(agingData.summary.grandTotal)} ج.م</h3>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-slate-400">
                        <DollarSign size={10} />
                        عرض جميع الحسابات المدينة
                    </div>
                </div>

                {/* Current Card */}
                <div 
                    onClick={() => setSelectedBucketFilter('current')}
                    className={clsx(
                        "p-4 rounded-2xl border cursor-pointer relative overflow-hidden transition-all hover:shadow-md",
                        selectedBucketFilter === 'current' ? "ring-2 ring-emerald-500 border-transparent shadow-md bg-emerald-50/20 scale-[1.01]" : "bg-white border-slate-200 shadow-sm"
                    )}
                >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full -mr-6 -mt-6 -z-10" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">الحالي (غير متأخر)</span>
                    <h3 className="text-lg md:text-xl font-extrabold text-emerald-600 font-mono mt-1">{fmt(agingData.summary.totalCurrent)} ج.م</h3>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-emerald-600">
                        <CheckCircle2 size={10} />
                        {selectedBucketFilter === 'current' ? 'تصفية مفعلة (انقر للإلغاء)' : 'انقر للتصفية'}
                    </div>
                </div>

                {/* 1-30 Days Card */}
                <div 
                    onClick={() => setSelectedBucketFilter('1_30')}
                    className={clsx(
                        "p-4 rounded-2xl border cursor-pointer relative overflow-hidden transition-all hover:shadow-md",
                        selectedBucketFilter === '1_30' ? "ring-2 ring-amber-500 border-transparent shadow-md bg-amber-50/20 scale-[1.01]" : "bg-white border-slate-200 shadow-sm"
                    )}
                >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-amber-50 rounded-full -mr-6 -mt-6 -z-10" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">متأخر (1 - 30 يوم)</span>
                    <h3 className="text-lg md:text-xl font-extrabold text-amber-500 font-mono mt-1">{fmt(agingData.summary.total1to30)} ج.م</h3>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-amber-500">
                        <Clock size={10} />
                        {selectedBucketFilter === '1_30' ? 'تصفية مفعلة (انقر للإلغاء)' : 'انقر للتصفية'}
                    </div>
                </div>

                {/* 31-60 Days Card */}
                <div 
                    onClick={() => setSelectedBucketFilter('31_60')}
                    className={clsx(
                        "p-4 rounded-2xl border cursor-pointer relative overflow-hidden transition-all hover:shadow-md",
                        selectedBucketFilter === '31_60' ? "ring-2 ring-orange-500 border-transparent shadow-md bg-orange-50/20 scale-[1.01]" : "bg-white border-slate-200 shadow-sm"
                    )}
                >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-full -mr-6 -mt-6 -z-10" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">متأخر (31 - 60 يوم)</span>
                    <h3 className="text-lg md:text-xl font-extrabold text-orange-500 font-mono mt-1">{fmt(agingData.summary.total31to60)} ج.م</h3>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-orange-500">
                        <AlertTriangle size={10} />
                        {selectedBucketFilter === '31_60' ? 'تصفية مفعلة (انقر للإلغاء)' : 'انقر للتصفية'}
                    </div>
                </div>

                {/* +60 Days Card */}
                <div 
                    onClick={() => setSelectedBucketFilter('over_60')}
                    className={clsx(
                        "p-4 rounded-2xl border cursor-pointer relative overflow-hidden transition-all hover:shadow-md col-span-2 lg:col-span-1",
                        selectedBucketFilter === 'over_60' ? "ring-2 ring-red-500 border-transparent shadow-md bg-red-50/20 scale-[1.01]" : "bg-white border-slate-200 shadow-sm"
                    )}
                >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 rounded-full -mr-6 -mt-6 -z-10" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">متأخر (+60 يوم)</span>
                    <h3 className="text-lg md:text-xl font-extrabold text-red-600 font-mono mt-1">{fmt(agingData.summary.totalOver60)} ج.م</h3>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-red-500">
                        <AlertTriangle size={10} />
                        {selectedBucketFilter === 'over_60' ? 'تصفية مفعلة (انقر للإلغاء)' : 'انقر للتصفية'}
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="relative">
                    <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="البحث بالاسم أو الرمز..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full text-xs pr-9 pl-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 whitespace-nowrap">الحد الأدنى للمبلغ:</span>
                    <input
                        type="number"
                        placeholder="0"
                        value={minAmount || ''}
                        onChange={(e) => setMinAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300 font-mono"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 whitespace-nowrap">تاريخ التقرير:</span>
                    <div className="relative w-full">
                        <Calendar className="absolute right-3 top-2.5 text-slate-400" size={14} />
                        <input
                            type="date"
                            value={asOfDate}
                            onChange={(e) => setAsOfDate(e.target.value || todayDateString())}
                            className="w-full text-xs pr-9 pl-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300 font-mono"
                        />
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left side: Entities list sorted by largest debt (35% on large screens) */}
                <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-[calc(100vh-320px)] flex flex-col">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 flex justify-between items-center">
                        <span>قائمة الأرصدة المستحقة ({summaries.length})</span>
                        {selectedBucketFilter !== 'all' && (
                            <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                                مصفى: {selectedBucketFilter === 'current' ? 'حالي' : selectedBucketFilter === '1_30' ? '1-30 يوم' : selectedBucketFilter === '31_60' ? '31-60 يوم' : '+60 يوم'}
                            </span>
                        )}
                    </div>
                    
                    <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
                        {loading ? (
                            <div className="p-8 text-center text-slate-400 text-xs">جاري تحميل البيانات...</div>
                        ) : summaries.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-xs">لا توجد سجلات مطابقة للفلاتر</div>
                        ) : (
                            summaries.map((entity) => {
                                const isSelected = selectedId === entity.entityId;
                                return (
                                    <div
                                        key={entity.entityId}
                                        onClick={() => setSelectedId(entity.entityId)}
                                        className={clsx(
                                            'p-3.5 cursor-pointer text-right transition-all flex items-start justify-between hover:bg-slate-50',
                                            isSelected && 'bg-slate-50/85 border-r-4 border-slate-800'
                                        )}
                                    >
                                        <div className="space-y-1">
                                            <p className={clsx('text-xs font-bold', isSelected ? 'text-slate-900 font-extrabold' : 'text-slate-800')}>{entity.entityName}</p>
                                            <div className="flex gap-1.5 items-center flex-wrap">
                                                {entity.aging.current > 0 && <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-semibold">حالي</span>}
                                                {entity.aging.days1to30 > 0 && <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-semibold">1-30</span>}
                                                {entity.aging.days31to60 > 0 && <span className="text-[9px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded font-semibold">31-60</span>}
                                                {entity.aging.over60Days > 0 && <span className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">+60</span>}
                                            </div>
                                        </div>
                                        <div className="text-left font-mono">
                                            <p className={clsx('text-xs font-extrabold', isSelected ? 'text-slate-900 font-black' : 'text-slate-800')}>{fmt(entity.aging.total)}</p>
                                            <p className="text-[9px] text-slate-400">مجموع المستحقات</p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right side: Detailed Aging View (65% on large screens) */}
                <div className="lg:col-span-8 space-y-6">
                    <AnimatePresence mode="wait">
                        {selectedEntityReport ? (
                            <motion.div
                                key={selectedId}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="space-y-6"
                            >
                                {/* Entity Information Header */}
                                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2.5">
                                                <h2 className="text-base font-extrabold text-slate-900">{selectedEntityReport.entityName}</h2>
                                                <span className={clsx('px-2 py-0.5 rounded-md text-[10px] font-bold', theme?.lightBg, theme?.accentText)}>
                                                    {selectedEntityReport.settings.billingMode === 'monthly_cycle' ? 'فوترة شهرية' : 'فوترة لكل حالة'}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-semibold mt-1 flex items-center gap-1.5 flex-wrap">
                                                {selectedEntityReport.settings.billingMode === 'monthly_cycle' ? (
                                                    <span>يوم الاستحقاق: {selectedEntityReport.settings.billingDay} من كل شهر التالي</span>
                                                ) : (
                                                    <span>فترة السماح قبل التأخير: {selectedEntityReport.settings.perOrderDueDays} أيام</span>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="text-left bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100 font-mono">
                                            <p className="text-xs text-slate-400">إجمالي المديونية</p>
                                            <p className="text-base font-black text-slate-800">{fmt(selectedEntityReport.aging.total)} ج.م</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Obligations Details Table */}
                                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 flex justify-between items-center">
                                        <span>تفاصيل العمليات المستحقة الذمة</span>
                                        {selectedBucketFilter !== 'all' && (
                                            <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                                                عرض فئة: {selectedBucketFilter === 'current' ? 'حالي' : selectedBucketFilter === '1_30' ? '1-30 يوم' : selectedBucketFilter === '31_60' ? '31-60 يوم' : '+60 يوم'}
                                            </span>
                                        )}
                                    </div>
                                    
                                    <div className="overflow-x-auto">
                                        {selectedEntityReport.obligations.length === 0 ? (
                                            <div className="p-10 text-center text-slate-400 text-xs">لا توجد حالات مستحقة في الوقت الحالي</div>
                                        ) : (
                                            <table className="w-full text-xs">
                                                <thead className="sticky top-0 bg-slate-800 text-white z-10">
                                                    <tr>
                                                        <th className="text-right px-4 py-3 font-bold">المريض والحالة</th>
                                                        <th className="px-3 py-3 text-center font-bold">تاريخ التسليم</th>
                                                        <th className="px-3 py-3 text-center font-bold">تاريخ الاستحقاق</th>
                                                        <th className="px-3 py-3 text-center font-bold">أيام التأخير</th>
                                                        <th className="px-4 py-3 text-left font-bold">المبلغ المستحق</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {selectedEntityReport.obligations
                                                        .filter(ob => selectedBucketFilter === 'all' || ob.bucket === selectedBucketFilter)
                                                        .map((ob) => {
                                                            const isOverdue = ob.daysPastDue > 0;
                                                            
                                                            return (
                                                                <tr key={ob.obligationId} className="hover:bg-slate-50 transition-colors">
                                                                    <td className="px-4 py-3 text-right">
                                                                        {ob.type === 'order' ? (
                                                                            <>
                                                                                <div className="font-bold text-slate-800">مريض: {ob.patientName || '—'}</div>
                                                                                <div className="text-[10px] text-slate-400 mt-0.5">حالة #{ob.caseId || '—'}</div>
                                                                                {ob.itemsText && <div className="text-[11.5px] font-semibold text-slate-600 mt-1">{ob.itemsText}</div>}
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <div className="font-bold text-slate-800">تسوية مالية</div>
                                                                                <div className="text-[10px] text-slate-400 mt-0.5">{ob.reason || 'قيد تسوية'}</div>
                                                                            </>
                                                                        )}
                                                                    </td>
                                                                    
                                                                    <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-500">
                                                                        {ob.triggerDate}
                                                                    </td>
                                                                    
                                                                    <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-500">
                                                                        {ob.dueDate}
                                                                    </td>
                                                                    
                                                                    <td className="px-3 py-3 text-center">
                                                                        {isOverdue ? (
                                                                            <span className={clsx(
                                                                                'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold',
                                                                                ob.daysPastDue > 60 ? 'bg-red-50 text-red-600' :
                                                                                ob.daysPastDue > 30 ? 'bg-orange-50 text-orange-600' :
                                                                                'bg-amber-50 text-amber-600'
                                                                            )}>
                                                                                {ob.daysPastDue} يوم
                                                                            </span>
                                                                        ) : (
                                                                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-600 font-bold">
                                                                                غير متأخر
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    
                                                                    <td className="px-4 py-3 text-left font-mono font-bold text-slate-800">
                                                                        {fmt(ob.remainingAmount)} ج.م
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>

                                {/* Suggested Actions Box */}
                                {(selectedEntityReport.entityPhone || selectedEntityReport.aging.over60Days > 0) && (
                                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">إجراءات مقترحة</div>
                                        <div className="flex flex-wrap gap-3">
                                            {selectedEntityReport.entityPhone && activeTab === 'doctors' && (() => {
                                                const rawPhone = selectedEntityReport.entityPhone;
                                                const waPhone = rawPhone.startsWith('0') ? `2${rawPhone}` : rawPhone.replace(/^\+/, '');
                                                return (
                                                    <>
                                                        <a
                                                            href={`tel:${rawPhone}`}
                                                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
                                                        >
                                                            <Phone size={13} />
                                                            اتصل بـ {selectedEntityReport.entityName}
                                                            <span className="opacity-75 font-mono font-normal">— {rawPhone}</span>
                                                        </a>
                                                        <a
                                                            href={`https://wa.me/${waPhone}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white text-xs font-bold rounded-xl hover:bg-[#1ebe5d] active:scale-95 transition-all shadow-sm"
                                                        >
                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                                                                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.847L0 24l6.335-1.508A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.368l-.36-.214-3.733.888.936-3.629-.235-.374A9.818 9.818 0 1112 21.818z"/>
                                                            </svg>
                                                            واتساب
                                                        </a>
                                                    </>
                                                );
                                            })()}

                                            {/* ── Quick Adjustment button — admin/accountant only */}
                                            {['admin', 'accountant'].includes(user?.role || '') && selectedEntityReport && (
                                                <button
                                                    type="button"
                                                    onClick={() => setAdjModal(m => ({
                                                        ...m,
                                                        open: true,
                                                        entityId:   selectedEntityReport.entityId,
                                                        entityName: selectedEntityReport.entityName,
                                                        entityType: activeTab === 'doctors' ? 'doctor' : activeTab === 'suppliers' ? 'supplier' : 'designer',
                                                        date: todayDateString(),
                                                        amount: '',
                                                        reason: ''
                                                    }))}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 active:scale-95 transition-all shadow-sm"
                                                >
                                                    <ScissorsLineDashed size={13} />
                                                    تسوية / خصم
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Visual Aging Bar representation */}
                                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                                    <div className="flex justify-between text-xs font-bold text-slate-700">
                                        <span>توزيع الديون حسب الفئة الزمنية:</span>
                                    </div>
                                    
                                    <div className="w-full h-3.5 bg-slate-100 rounded-full flex overflow-hidden border border-slate-200">
                                        {selectedEntityReport.aging.total > 0 ? (
                                            <>
                                                {selectedEntityReport.aging.current > 0 && (
                                                    <div
                                                        className="bg-emerald-500 transition-all"
                                                        style={{ width: `${(selectedEntityReport.aging.current / selectedEntityReport.aging.total) * 100}%` }}
                                                        title={`حالي: ${fmt(selectedEntityReport.aging.current)} ج.م`}
                                                    />
                                                )}
                                                {selectedEntityReport.aging.days1to30 > 0 && (
                                                    <div
                                                        className="bg-amber-500 transition-all"
                                                        style={{ width: `${(selectedEntityReport.aging.days1to30 / selectedEntityReport.aging.total) * 100}%` }}
                                                        title={`1-30 يوم: ${fmt(selectedEntityReport.aging.days1to30)} ج.م`}
                                                    />
                                                )}
                                                {selectedEntityReport.aging.days31to60 > 0 && (
                                                    <div
                                                        className="bg-orange-500 transition-all"
                                                        style={{ width: `${(selectedEntityReport.aging.days31to60 / selectedEntityReport.aging.total) * 100}%` }}
                                                        title={`31-60 يوم: ${fmt(selectedEntityReport.aging.days31to60)} ج.م`}
                                                    />
                                                )}
                                                {selectedEntityReport.aging.over60Days > 0 && (
                                                    <div
                                                        className="bg-red-500 transition-all"
                                                        style={{ width: `${(selectedEntityReport.aging.over60Days / selectedEntityReport.aging.total) * 100}%` }}
                                                        title={`+60 يوم: ${fmt(selectedEntityReport.aging.over60Days)} ج.م`}
                                                    />
                                                )}
                                            </>
                                        ) : (
                                            <div className="w-full bg-slate-100" />
                                        )}
                                    </div>

                                    {/* Legend indicator */}
                                    <div className="grid grid-cols-4 gap-2 pt-1">
                                        <div className="flex items-center gap-1">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 block" />
                                            <span className="text-[10px] text-slate-500 font-mono">حالي ({fmt(selectedEntityReport.aging.current)})</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 block" />
                                            <span className="text-[10px] text-slate-500 font-mono">1-30 يوم ({fmt(selectedEntityReport.aging.days1to30)})</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-orange-500 block" />
                                            <span className="text-[10px] text-slate-500 font-mono">31-60 يوم ({fmt(selectedEntityReport.aging.days31to60)})</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="w-2.5 h-2.5 rounded-sm bg-red-500 block" />
                                            <span className="text-[10px] text-slate-500 font-mono">+60 يوم ({fmt(selectedEntityReport.aging.over60Days)})</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="bg-white rounded-2xl border border-dashed border-slate-200 h-64 flex flex-col items-center justify-center gap-3 text-slate-400 shadow-sm"
                            >
                                <ArrowLeftRight size={40} className="text-slate-200" />
                                <p className="text-sm">اختر {activeTab === 'doctors' ? 'طبيباً' : activeTab === 'suppliers' ? 'مورداً' : 'مصمماً'} لرؤية تحليله التفصيلي</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

            </div>

        </div>

        {/* ────────────── Quick Adjustment Modal ────────────── */}
        <AnimatePresence>
            {adjModal.open && (
                <motion.div
                    key="adj-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={e => { if (e.target === e.currentTarget) setAdjModal(m => ({ ...m, open: false })); }}
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 12 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95, y: 12 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5"
                        style={{ direction: 'rtl' }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-violet-100 rounded-xl flex items-center justify-center">
                                    <ScissorsLineDashed size={15} className="text-violet-600" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-extrabold text-slate-800">تسوية / خصم من الحساب</h3>
                                    <p className="text-[10px] text-slate-400">{adjModal.entityName}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAdjModal(m => ({ ...m, open: false }))}
                                className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
                            >×</button>
                        </div>

                        {/* Info notice */}
                        <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-2.5 text-[11px] text-violet-700 leading-relaxed">
                            سيُسجّل هذا الخصم في سجل <strong>القيود والتسويات</strong> ويؤثّر تلقائياً على رصيد الحساب وتقرير الأعمار.
                        </div>

                        <form onSubmit={handleSaveAdjustment} className="space-y-4">
                            {/* Amount */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">مبلغ الخصم <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        required
                                        autoFocus
                                        value={adjModal.amount}
                                        onChange={e => setAdjModal(m => ({ ...m, amount: e.target.value }))}
                                        placeholder="0.00"
                                        className="w-full text-sm px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono text-left"
                                        style={{ direction: 'ltr' }}
                                    />
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">ج.م</span>
                                </div>
                            </div>

                            {/* Date */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">تاريخ التسوية <span className="text-red-500">*</span></label>
                                <input
                                    type="date"
                                    required
                                    value={adjModal.date}
                                    onChange={e => setAdjModal(m => ({ ...m, date: e.target.value }))}
                                    className="w-full text-sm px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono"
                                />
                            </div>

                            {/* Reason */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">سبب التسوية / البيان <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    required
                                    value={adjModal.reason}
                                    onChange={e => setAdjModal(m => ({ ...m, reason: e.target.value }))}
                                    placeholder="مثال: خصم خاص، تعويض حالة..."
                                    className="w-full text-sm px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 pt-1">
                                <button
                                    type="submit"
                                    disabled={adjModal.saving}
                                    className="flex-1 py-2.5 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 disabled:opacity-60 transition-all active:scale-95"
                                >
                                    {adjModal.saving ? 'جاري الحفظ...' : 'حفظ التسوية'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAdjModal(m => ({ ...m, open: false }))}
                                    className="px-5 py-2.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-200 transition-all"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
        </>
    );
}
