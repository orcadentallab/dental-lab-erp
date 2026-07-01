/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Doctor, type Supplier, type Order, type Transaction, type User, type EntityBillingSettings } from '../services/db';
import { financeService, type Adjustment } from '../services/financeService';
import { hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION, isDesignerUser } from '../lib/userRoles';
import { getDoctorReceivableAmount, getOfficialStatementDate, isDoctorStatementIncluded } from '../constants/orderLifecycle';
import { getLabCostMetadata } from '../constants/financialObligations';
import { BILLING_ENTITY_TYPES } from '../constants/billingSettings';
import { generateDoctorStatementPDF, generateMonthlyInvoicePDF } from '../services/pdfService';
import { statementService } from '../services/statementService';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import { matchArabic } from '../lib/searchUtils';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Factory, Palette, Search, FileDown, Printer,
    Calendar, X, Receipt, ChevronLeft, ChevronRight, FileText
} from 'lucide-react';
import clsx from 'clsx';

// ── Types ────────────────────────────────────────────────────────────────────

type TabType = 'doctors' | 'suppliers' | 'designers';
type TimeFilter = 'all' | 'currentMonth' | 'previousMonth' | 'custom';
type ViewMode = 'statement' | 'invoice';

interface EntitySummary {
    id: string;
    name: string;
    code?: string;
    totalWork: number;
    totalPaid: number;
    balance: number;
    ordersCount: number;
    isSalaried?: boolean;
    billingMode?: EntityBillingSettings['billingMode'];
}

interface StatementLineItem {
    id: string;
    date: string;
    description: string;
    subName?: string;    // اسم الطبيب الفرعي أو الفرع
    type: 'debit' | 'credit';
    amount: number;
    runningBalance: number;
    services?: string;
    status?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const formatDateInput = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const getDateRange = (filter: TimeFilter, custom: { start: string; end: string }) => {
    const today = new Date();
    switch (filter) {
        case 'currentMonth': {
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            return { start: formatDateInput(start), end: formatDateInput(today) };
        }
        case 'previousMonth': {
            const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const end = new Date(today.getFullYear(), today.getMonth(), 0);
            return { start: formatDateInput(start), end: formatDateInput(end) };
        }
        case 'custom':
            return custom;
        default:
            return { start: '', end: '' };
    }
};

const isInRange = (dateStr: string, start: string, end: string) => {
    const d = (dateStr || '').split('T')[0];
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
};

const isVisible = (order: Partial<Order>) => {
    if (order.isDeleted) return false;
    if (!order.isArchived) return true;
    return ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled'].includes(order.status || '');
};

// For "all" time filter: get receivable amount for any order status
// Rejected / Cancelled → 0, everything else → totalPrice
const ZERO_VALUE_NORMALIZED = new Set(['doctor rejected', 'lab rejected', 'cancelled', 'rejected']);
const getAllDoctorAmount = (order: Partial<Order>): number => {
    if (ZERO_VALUE_NORMALIZED.has((order.status || '').trim().toLowerCase())) return 0;
    return order.totalPrice || 0;
};

// Status badge config for "all" mode
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    'doctor rejected': { label: 'مرتجع طبيب', cls: 'bg-amber-100 text-amber-700' },
    'rejected':        { label: 'مرفوض',       cls: 'bg-amber-100 text-amber-700' },
    'lab rejected':    { label: 'رفض معمل',    cls: 'bg-red-100 text-red-600' },
    'cancelled':       { label: 'ملغي',         cls: 'bg-slate-100 text-slate-500' },
    'delivered':       { label: 'تم التسليم',   cls: 'bg-emerald-100 text-emerald-700' },
    'completed':       { label: 'مكتمل',        cls: 'bg-emerald-100 text-emerald-700' },
    'under production':{ label: 'تحت الإنتاج', cls: 'bg-blue-100 text-blue-700' },
    'in progress':     { label: 'قيد التنفيذ',  cls: 'bg-blue-100 text-blue-700' },
    'sent to lab':     { label: 'أُرسل للمعمل', cls: 'bg-indigo-100 text-indigo-700' },
    'sent to external lab': { label: 'معمل خارجي', cls: 'bg-indigo-100 text-indigo-700' },
    'ready':           { label: 'جاهز',         cls: 'bg-teal-100 text-teal-700' },
    'try in':          { label: 'تجربة',         cls: 'bg-purple-100 text-purple-700' },
    'try in approved': { label: 'تجربة مقبولة', cls: 'bg-purple-100 text-purple-700' },
    'new case':        { label: 'حالة جديدة',   cls: 'bg-slate-100 text-slate-600' },
    'pending':         { label: 'معلق',          cls: 'bg-slate-100 text-slate-600' },
    'under design':    { label: 'تحت التصميم',  cls: 'bg-violet-100 text-violet-700' },
    'returned for adjustments': { label: 'إعادة تعديل', cls: 'bg-orange-100 text-orange-700' },
};

// Month navigation helpers
const monthToRange = (monthStr: string) => {
    const [y, m] = monthStr.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
};

const prevMonth = (monthStr: string) => {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const nextMonth = (monthStr: string) => {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (monthStr: string) => {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function StatementsPage() {
    useAuth();

    // ─ Global data
    const [orders, setOrders] = useState<Order[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [allDoctors, setAllDoctors] = useState<Doctor[]>([]);     // ALL including children
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    // ─ UI state
    const [activeTab, setActiveTab] = useState<TabType>('doctors');
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [customRange, setCustomRange] = useState({ start: '', end: '' });
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('statement');
    const [invoiceMonth, setInvoiceMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [selectedBillingSettings, setSelectedBillingSettings] = useState<EntityBillingSettings | null>(null);

    // ─ Load data
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const [o, t, doc, sup, usr, adj] = await Promise.all([
                    db.getOrdersForFinanceSummary(),
                    db.getTransactionsForFinanceSummary(),
                    db.getDoctors(),          // ALL doctors including children (parentId set)
                    db.getSuppliers(),
                    db.getUsers(),
                    financeService.getAdjustments(),
                ]);
                setOrders(Array.isArray(o) ? o as Order[] : []);
                setTransactions(Array.isArray(t) ? t as Transaction[] : []);
                setAllDoctors(Array.isArray(doc) ? doc : []);
                setSuppliers(Array.isArray(sup) ? sup : []);
                setDesigners((Array.isArray(usr) ? usr : []).filter(isDesignerUser));
                setAdjustments(Array.isArray(adj) ? adj : []);
            } catch (e) {
                console.error('Statements load error:', e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    // ─ Load billing settings when selected entity changes
    useEffect(() => {
        if (!selectedId) {
            setSelectedBillingSettings(null);
            return;
        }
        const entityType = activeTab === 'doctors' ? BILLING_ENTITY_TYPES.doctor : activeTab === 'suppliers' ? BILLING_ENTITY_TYPES.externalLab : BILLING_ENTITY_TYPES.designer;
        db.getEntityBillingSettings(entityType, selectedId)
            .then(s => {
                setSelectedBillingSettings(s);
                // Auto-switch view mode based on billing settings
                setViewMode(s.billingMode === 'monthly_cycle' ? 'invoice' : 'statement');
            })
            .catch(() => setSelectedBillingSettings(null));
    }, [selectedId, activeTab]);

    // ─ Derived maps ──────────────────────────────────────────────────────────

    // parentId map: childDoctorId → parentDoctorId (or self if no parent)
    const doctorParentById = useMemo(() => {
        const map = new Map<string, string>();
        for (const d of allDoctors) {
            map.set(d.id, d.parentId || d.id);
        }
        return map;
    }, [allDoctors]);

    // Quick lookup: id → Doctor
    const doctorById = useMemo(() => new Map(allDoctors.map(d => [d.id, d])), [allDoctors]);

    // Primary doctors (no parent) sorted by name
    const primaryDoctors = useMemo(
        () => allDoctors.filter(d => !d.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ar')),
        [allDoctors]
    );

    const dateRange = useMemo(() => getDateRange(timeFilter, customRange), [timeFilter, customRange]);

    // ─ Summary per entity ────────────────────────────────────────────────────

    const summaries = useMemo((): EntitySummary[] => {
        if (loading) return [];
        const { start, end } = dateRange;
        const inRange = (d: string) => isInRange(d, start, end);

        if (activeTab === 'doctors') {
            const workMap = new Map<string, number>();
            const paidMap = new Map<string, number>();
            const countMap = new Map<string, number>();

            for (const o of orders) {
                if (!isVisible(o) || !o.doctorId) continue;
                const statDate = getOfficialStatementDate(o);
                if (!inRange(statDate)) continue;
                // "all" filter: show every order regardless of status (rejected/cancelled = 0)
                // Other filters: only statement-included statuses (delivered/completed)
                if (timeFilter !== 'all' && !isDoctorStatementIncluded(o)) continue;
                const pid = doctorParentById.get(o.doctorId) || o.doctorId;
                const amount = timeFilter === 'all' ? getAllDoctorAmount(o) : getDoctorReceivableAmount(o);
                workMap.set(pid, (workMap.get(pid) ?? 0) + amount);
                countMap.set(pid, (countMap.get(pid) ?? 0) + 1);
            }
            for (const t of transactions) {
                if ((t.entityType !== 'doctor' && t.entityType) || t.type !== 'income' || !t.entityId) continue;
                if (!inRange(t.date)) continue;
                const pid = doctorParentById.get(t.entityId) || t.entityId;
                paidMap.set(pid, (paidMap.get(pid) ?? 0) + (t.amount || 0));
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'doctor' || !inRange(adj.date)) continue;
                const pid = doctorParentById.get(adj.entity_id) || adj.entity_id;
                if (adj.type === 'charge') workMap.set(pid, (workMap.get(pid) ?? 0) + adj.amount);
                else paidMap.set(pid, (paidMap.get(pid) ?? 0) + adj.amount);
            }

            return primaryDoctors.map(d => {
                const work = workMap.get(d.id) ?? 0;
                const paid = paidMap.get(d.id) ?? 0;
                return { id: d.id, name: d.name, code: d.doctorCode, totalWork: work, totalPaid: paid, balance: work - paid, ordersCount: countMap.get(d.id) ?? 0 };
            }).filter(s => s.totalWork > 0 || s.totalPaid > 0 || s.balance !== 0);
        }

        if (activeTab === 'suppliers') {
            const workMap = new Map<string, number>();
            const paidMap = new Map<string, number>();
            const countMap = new Map<string, number>();
            for (const o of orders) {
                if (!isVisible(o) || !o.supplierId) continue;
                const opDate = (o.deliveryDate || o.createdAt || '').split('T')[0];
                if (!inRange(opDate)) continue;
                const hasRejCost = o.status === 'Doctor Rejected' && typeof o.rejectedLabCost === 'number';
                const relevant = (o.status !== 'Doctor Rejected' || hasRejCost) && (o.status === 'Delivered' || o.status === 'Cancelled' || o.status === 'Lab Rejected' || hasRejCost);
                if (!relevant) continue;
                const designer = designers.find(d => d.id === o.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                let cost = getLabCostMetadata(o, isSalaried).cost;
                if (o.status === 'Cancelled' || o.status === 'Lab Rejected') cost = 0;
                else if (o.status === 'Doctor Rejected') cost = hasRejCost ? (o.rejectedLabCost ?? 0) : 0;
                workMap.set(o.supplierId, (workMap.get(o.supplierId) ?? 0) + cost);
                countMap.set(o.supplierId, (countMap.get(o.supplierId) ?? 0) + 1);
            }
            for (const t of transactions) {
                if ((t.entityType !== 'supplier' && t.entityType) || t.type !== 'expense' || !t.entityId) continue;
                if (!inRange(t.date)) continue;
                paidMap.set(t.entityId, (paidMap.get(t.entityId) ?? 0) + (t.amount || 0));
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'supplier' || !inRange(adj.date)) continue;
                if (adj.type === 'charge') paidMap.set(adj.entity_id, (paidMap.get(adj.entity_id) ?? 0) + adj.amount);
                else workMap.set(adj.entity_id, (workMap.get(adj.entity_id) ?? 0) + adj.amount);
            }
            return suppliers.map(s => {
                const work = workMap.get(s.id) ?? 0;
                const paid = paidMap.get(s.id) ?? 0;
                return { id: s.id, name: s.name, totalWork: work, totalPaid: paid, balance: work - paid, ordersCount: countMap.get(s.id) ?? 0 };
            }).filter(s => s.totalWork > 0 || s.totalPaid > 0 || s.balance !== 0);
        }

        if (activeTab === 'designers') {
            const workMap = new Map<string, number>();
            const paidMap = new Map<string, number>();
            const countMap = new Map<string, number>();
            for (const o of orders) {
                if (!isVisible(o) || !o.designerId || o.workflowType !== 'split') continue;
                const opDate = (o.deliveryDate || o.createdAt || '').split('T')[0];
                if (!inRange(opDate)) continue;
                const hasRejCost = o.status === 'Doctor Rejected' && typeof o.rejectedLabCost === 'number';
                const relevant = o.designStatus === 'completed' || o.status === 'Doctor Rejected' || o.status === 'Lab Rejected' || o.status === 'Cancelled' || hasRejCost;
                if (!relevant) continue;
                const designer = designers.find(d => d.id === o.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                if (isSalaried) continue;
                let price = (o.status === 'Cancelled' || o.status === 'Lab Rejected' || o.status === 'Doctor Rejected') ? 0 : (o.designPrice || 0);
                if (hasRejCost) price = o.rejectedLabCost ?? 0;
                workMap.set(o.designerId, (workMap.get(o.designerId) ?? 0) + price);
                countMap.set(o.designerId, (countMap.get(o.designerId) ?? 0) + 1);
            }
            for (const t of transactions) {
                if ((t.entityType !== 'designer' && t.entityType) || t.type !== 'expense' || !t.entityId) continue;
                if (!inRange(t.date)) continue;
                paidMap.set(t.entityId, (paidMap.get(t.entityId) ?? 0) + (t.amount || 0));
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'designer' || !inRange(adj.date)) continue;
                if (adj.type === 'charge') paidMap.set(adj.entity_id, (paidMap.get(adj.entity_id) ?? 0) + adj.amount);
                else workMap.set(adj.entity_id, (workMap.get(adj.entity_id) ?? 0) + adj.amount);
            }
            return designers.map(d => {
                const isSalaried = hasCustomPermission(d, FIXED_SALARY_DESIGNER_PERMISSION);
                const work = isSalaried ? 0 : (workMap.get(d.id) ?? 0);
                const paid = paidMap.get(d.id) ?? 0;
                return { id: d.id, name: d.name, totalWork: work, totalPaid: paid, balance: work - paid, ordersCount: countMap.get(d.id) ?? 0, isSalaried };
            }).filter(s => s.totalWork > 0 || s.totalPaid > 0 || s.balance !== 0);
        }

        return [];
    }, [loading, activeTab, orders, transactions, adjustments, primaryDoctors, suppliers, designers, dateRange, doctorParentById, timeFilter]);

    const totalBalance = useMemo(() => summaries.reduce((s, e) => s + e.balance, 0), [summaries]);
    const filtered = useMemo(() => {
        if (!search.trim()) return summaries;
        return summaries.filter(e => matchArabic(e.name, search) || (e.code && matchArabic(e.code, search)));
    }, [summaries, search]);

    // ─ Statement lines (regular كشف حساب) ───────────────────────────────────

    const statementLines = useMemo((): StatementLineItem[] => {
        if (!selectedId || viewMode !== 'statement') return [];
        const { start, end } = dateRange;
        const inRange = (d: string) => isInRange(d, start, end);
        const lines: Omit<StatementLineItem, 'runningBalance'>[] = [];

        if (activeTab === 'doctors') {
            for (const o of orders) {
                if (!isVisible(o) || !o.doctorId) continue;
                const pid = doctorParentById.get(o.doctorId) || o.doctorId;
                if (pid !== selectedId) continue;
                const statDate = getOfficialStatementDate(o);
                if (!inRange(statDate)) continue;
                // "all" filter: include every order (rejected/cancelled shown with 0)
                // Other filters: only statement-included statuses
                if (timeFilter !== 'all' && !isDoctorStatementIncluded(o)) continue;
                const amount = timeFilter === 'all' ? getAllDoctorAmount(o) : getDoctorReceivableAmount(o);
                // Sub-doctor name (if order is from a child clinic)
                const subDoc = o.doctorId !== selectedId ? doctorById.get(o.doctorId || '') : null;
                lines.push({
                    id: o.id, date: statDate,
                    description: `حالة #${o.caseId || '—'} — ${o.patientName || '—'}`,
                    subName: subDoc?.name,
                    type: 'debit', amount,
                    services: ((o.items || []) as any[]).map(i => {
                        const count = Array.isArray(i.teethNumbers) && i.teethNumbers.length > 0 ? i.teethNumbers.length : 1;
                        return `${i.serviceType || '-'}(${count})`;
                    }).filter(Boolean).join(' + '),
                    status: o.status,
                });
            }
            for (const t of transactions) {
                if ((t.entityType !== 'doctor' && t.entityType) || t.type !== 'income') continue;
                const pid = doctorParentById.get(t.entityId || '') || t.entityId;
                if (pid !== selectedId) continue;
                if (!inRange(t.date)) continue;
                lines.push({ id: t.id, date: t.date.split('T')[0], description: `دفعة — ${t.description || t.category || ''}`, type: 'credit', amount: t.amount });
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'doctor') continue;
                const pid = doctorParentById.get(adj.entity_id) || adj.entity_id;
                if (pid !== selectedId) continue;
                if (!inRange(adj.date)) continue;
                lines.push({ id: adj.id, date: adj.date, description: `تسوية — ${adj.reason || 'قيد محاسبي'}`, type: adj.type === 'charge' ? 'debit' : 'credit', amount: adj.amount });
            }
        }

        if (activeTab === 'suppliers') {
            for (const o of orders) {
                if (!isVisible(o) || o.supplierId !== selectedId) continue;
                const opDate = (o.deliveryDate || o.createdAt || '').split('T')[0];
                if (!inRange(opDate)) continue;
                const hasRejCost = o.status === 'Doctor Rejected' && typeof o.rejectedLabCost === 'number';
                const relevant = (o.status !== 'Doctor Rejected' || hasRejCost) && (o.status === 'Delivered' || o.status === 'Cancelled' || o.status === 'Lab Rejected' || hasRejCost);
                if (!relevant) continue;
                const designer = designers.find(d => d.id === o.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                let cost = getLabCostMetadata(o, isSalaried).cost;
                if (o.status === 'Cancelled' || o.status === 'Lab Rejected') cost = 0;
                else if (o.status === 'Doctor Rejected') cost = hasRejCost ? (o.rejectedLabCost ?? 0) : 0;
                lines.push({
                    id: o.id, date: (o.deliveryDate || o.createdAt || '').split('T')[0],
                    description: `حالة #${o.caseId || '—'} — ${o.patientName || '—'}`,
                    type: 'debit', amount: cost,
                    services: ((o.items || []) as any[]).map(i => {
                        const count = Array.isArray(i.teethNumbers) && i.teethNumbers.length > 0 ? i.teethNumbers.length : 1;
                        return `${i.serviceType || '-'}(${count})`;
                    }).filter(Boolean).join(' + '),
                    status: o.status
                });
            }
            for (const t of transactions) {
                if ((t.entityType !== 'supplier' && t.entityType) || t.type !== 'expense' || t.entityId !== selectedId) continue;
                if (!inRange(t.date)) continue;
                lines.push({ id: t.id, date: t.date.split('T')[0], description: `سداد — ${t.description || t.category || ''}`, type: 'credit', amount: t.amount });
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'supplier' || adj.entity_id !== selectedId) continue;
                if (!inRange(adj.date)) continue;
                lines.push({ id: adj.id, date: adj.date, description: `تسوية — ${adj.reason || 'قيد محاسبي'}`, type: adj.type === 'charge' ? 'credit' : 'debit', amount: adj.amount });
            }
        }

        if (activeTab === 'designers') {
            for (const o of orders) {
                if (!isVisible(o) || o.designerId !== selectedId || o.workflowType !== 'split') continue;
                const opDate = (o.deliveryDate || o.createdAt || '').split('T')[0];
                if (!inRange(opDate)) continue;
                const hasRejCost = o.status === 'Doctor Rejected' && typeof o.rejectedLabCost === 'number';
                const relevant = o.designStatus === 'completed' || o.status === 'Doctor Rejected' || o.status === 'Lab Rejected' || o.status === 'Cancelled' || hasRejCost;
                if (!relevant) continue;
                const designer = designers.find(d => d.id === o.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                if (isSalaried) continue;
                let price = (o.status === 'Cancelled' || o.status === 'Lab Rejected' || o.status === 'Doctor Rejected') ? 0 : (o.designPrice || 0);
                if (hasRejCost) price = o.rejectedLabCost ?? 0;
                lines.push({
                    id: o.id, date: opDate,
                    description: `حالة #${o.caseId || '—'} — ${o.patientName || '—'}`,
                    type: 'debit', amount: price,
                    services: ((o.items || []) as any[]).map(i => {
                        const count = Array.isArray(i.teethNumbers) && i.teethNumbers.length > 0 ? i.teethNumbers.length : 1;
                        return `${i.serviceType || '-'}(${count})`;
                    }).filter(Boolean).join(' + '),
                    status: o.status
                });
            }
            for (const t of transactions) {
                if ((t.entityType !== 'designer' && t.entityType) || t.type !== 'expense' || t.entityId !== selectedId) continue;
                if (!inRange(t.date)) continue;
                lines.push({ id: t.id, date: t.date.split('T')[0], description: `مدفوعات — ${t.description || t.category || ''}`, type: 'credit', amount: t.amount });
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'designer' || adj.entity_id !== selectedId) continue;
                if (!inRange(adj.date)) continue;
                lines.push({ id: adj.id, date: adj.date, description: `تسوية — ${adj.reason || 'قيد محاسبي'}`, type: adj.type === 'charge' ? 'credit' : 'debit', amount: adj.amount });
            }
        }

        lines.sort((a, b) => a.date.localeCompare(b.date));
        let running = 0;
        return lines.map(l => {
            running += l.type === 'debit' ? l.amount : -l.amount;
            return { ...l, runningBalance: running };
        });
    }, [selectedId, activeTab, viewMode, orders, transactions, adjustments, doctorParentById, doctorById, designers, dateRange, timeFilter]);

    // ─ Invoice lines (فاتورة شهرية) ─────────────────────────────────────────

    const invoiceData = useMemo(() => {
        if (!selectedId || viewMode !== 'invoice') return null;

        const { start: monthStart, end: monthEnd } = monthToRange(invoiceMonth);

        // Smart cutoff for payments:
        // We count payments that happened up to the END of the invoice month (or today if still in that month).
        // This way: if April was paid on May 5 and we're generating May's invoice,
        // the April payment IS counted → opening balance = 0 ✅ (not a "stale debt")
        const today = new Date().toISOString().split('T')[0];
        const paymentCutoff = monthEnd < today ? monthEnd : today; // min(monthEnd, today)

        // Opening balance = all orders BEFORE this month  -  all payments up to paymentCutoff
        let openingDebit = 0, openingCredit = 0;
        const monthOrders: Omit<StatementLineItem, 'runningBalance'>[] = [];

        if (activeTab === 'doctors') {
            for (const o of orders) {
                if (!isVisible(o) || !o.doctorId) continue;
                const pid = doctorParentById.get(o.doctorId) || o.doctorId;
                if (pid !== selectedId) continue;
                const statDate = getOfficialStatementDate(o);
                if (statDate >= monthStart) continue;
                if (!isDoctorStatementIncluded(o)) continue;
                openingDebit += getDoctorReceivableAmount(o);
            }
            for (const t of transactions) {
                if ((t.entityType !== 'doctor' && t.entityType) || t.type !== 'income') continue;
                const pid = doctorParentById.get(t.entityId || '') || t.entityId;
                if (pid !== selectedId) continue;
                const tDate = t.date.split('T')[0];
                if (tDate > paymentCutoff) continue;
                openingCredit += t.amount || 0;
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'doctor') continue;
                const pid = doctorParentById.get(adj.entity_id) || adj.entity_id;
                if (pid !== selectedId) continue;
                if (adj.date >= monthStart) continue;
                if (adj.type === 'charge') openingDebit += adj.amount;
                else openingCredit += adj.amount;
            }

            for (const o of orders) {
                if (!isVisible(o) || !o.doctorId) continue;
                const pid = doctorParentById.get(o.doctorId) || o.doctorId;
                if (pid !== selectedId) continue;
                const statDate = getOfficialStatementDate(o);
                if (statDate < monthStart || statDate > monthEnd) continue;
                if (!isDoctorStatementIncluded(o)) continue;
                const amount = getDoctorReceivableAmount(o);
                const subDoc = o.doctorId !== selectedId ? doctorById.get(o.doctorId || '') : null;
                monthOrders.push({
                    id: o.id, date: statDate,
                    description: `حالة #${o.caseId || '—'} — ${o.patientName || '—'}`,
                    subName: subDoc?.name,
                    type: 'debit', amount,
                    services: ((o.items || []) as any[]).map(i => {
                        const count = Array.isArray(i.teethNumbers) && i.teethNumbers.length > 0 ? i.teethNumbers.length : 1;
                        return `${i.serviceType || '-'}(${count})`;
                    }).filter(Boolean).join(' + '),
                    status: o.status,
                });
            }
        } else if (activeTab === 'suppliers') {
            for (const o of orders) {
                if (!isVisible(o) || o.supplierId !== selectedId) continue;
                const opDate = (o.deliveryDate || o.createdAt || '').split('T')[0];
                const hasRejCost = (o.status === 'Doctor Rejected' || o.status === 'Rejected') && typeof o.rejectedLabCost === 'number';
                const relevant = (o.status !== 'Doctor Rejected' && o.status !== 'Rejected' || hasRejCost) && (o.status === 'Delivered' || o.status === 'Cancelled' || o.status === 'Lab Rejected' || hasRejCost);
                if (!relevant) continue;

                const designer = designers.find(d => d.id === o.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                let cost = getLabCostMetadata(o, isSalaried).cost;
                if (o.status === 'Cancelled' || o.status === 'Lab Rejected') cost = 0;
                else if (o.status === 'Doctor Rejected' || o.status === 'Rejected') cost = hasRejCost ? (o.rejectedLabCost ?? 0) : 0;

                if (opDate < monthStart) {
                    openingDebit += cost;
                } else if (opDate <= monthEnd) {
                    monthOrders.push({
                        id: o.id, date: opDate,
                        description: `حالة #${o.caseId || '—'} — ${o.patientName || '—'}`,
                        type: 'debit', amount: cost,
                        services: ((o.items || []) as any[]).map(i => {
                            const count = Array.isArray(i.teethNumbers) && i.teethNumbers.length > 0 ? i.teethNumbers.length : 1;
                            return `${i.serviceType || '-'}(${count})`;
                        }).filter(Boolean).join(' + '),
                        status: o.status,
                    });
                }
            }
            for (const t of transactions) {
                if ((t.entityType !== 'supplier' && t.entityType) || t.type !== 'expense' || t.entityId !== selectedId) continue;
                const tDate = t.date.split('T')[0];
                if (tDate > paymentCutoff) continue;
                openingCredit += t.amount || 0;
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'supplier' || adj.entity_id !== selectedId) continue;
                if (adj.date < monthStart) {
                    if (adj.type === 'charge') openingCredit += adj.amount;
                    else openingDebit += adj.amount;
                }
            }
        } else if (activeTab === 'designers') {
            for (const o of orders) {
                if (!isVisible(o) || o.designerId !== selectedId || o.workflowType !== 'split') continue;
                const opDate = (o.deliveryDate || o.createdAt || '').split('T')[0];
                const hasRejCost = (o.status === 'Doctor Rejected' || o.status === 'Rejected') && typeof o.rejectedLabCost === 'number';
                const relevant = o.designStatus === 'completed' || o.status === 'Doctor Rejected' || o.status === 'Lab Rejected' || o.status === 'Rejected' || o.status === 'Cancelled' || hasRejCost;
                if (!relevant) continue;

                const designer = designers.find(d => d.id === o.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                if (isSalaried) continue;

                let price = (o.status === 'Cancelled' || o.status === 'Doctor Rejected' || o.status === 'Lab Rejected' || o.status === 'Rejected') ? 0 : (o.designPrice || 0);
                if (hasRejCost) price = o.rejectedLabCost ?? 0;

                if (opDate < monthStart) {
                    openingDebit += price;
                } else if (opDate <= monthEnd) {
                    monthOrders.push({
                        id: o.id, date: opDate,
                        description: `حالة #${o.caseId || '—'} — ${o.patientName || '—'}`,
                        type: 'debit', amount: price,
                        services: ((o.items || []) as any[]).map(i => {
                            const count = Array.isArray(i.teethNumbers) && i.teethNumbers.length > 0 ? i.teethNumbers.length : 1;
                            return `${i.serviceType || '-'}(${count})`;
                        }).filter(Boolean).join(' + '),
                        status: o.status,
                    });
                }
            }
            for (const t of transactions) {
                if ((t.entityType !== 'designer' && t.entityType) || t.type !== 'expense' || t.entityId !== selectedId) continue;
                const tDate = t.date.split('T')[0];
                if (tDate > paymentCutoff) continue;
                openingCredit += t.amount || 0;
            }
            for (const adj of adjustments) {
                if (adj.entity_type !== 'designer' || adj.entity_id !== selectedId) continue;
                if (adj.date < monthStart) {
                    if (adj.type === 'charge') openingCredit += adj.amount;
                    else openingDebit += adj.amount;
                }
            }
        }

        monthOrders.sort((a, b) => a.date.localeCompare(b.date));

        const monthTotal = monthOrders.reduce((s, l) => s + l.amount, 0);
        const openingBalance = openingDebit - openingCredit;
        const totalDue = openingBalance + monthTotal;

        return { openingBalance, monthOrders, monthTotal, totalDue, monthStart, monthEnd };
    }, [selectedId, viewMode, activeTab, invoiceMonth, orders, transactions, adjustments, doctorParentById, doctorById, designers]);

    // ─ Selected entity info ───────────────────────────────────────────────────

    const selectedEntity = useMemo(() => {
        if (!selectedId) return null;
        if (activeTab === 'doctors') return primaryDoctors.find(d => d.id === selectedId);
        if (activeTab === 'suppliers') return suppliers.find(s => s.id === selectedId);
        return designers.find(d => d.id === selectedId);
    }, [selectedId, activeTab, primaryDoctors, suppliers, designers]);

    const selectedSummary = useMemo(() => summaries.find(s => s.id === selectedId), [summaries, selectedId]);

    // ─ PDF / Print ────────────────────────────────────────────────────────────

    const handlePDF = useCallback(async () => {
        if (!selectedId || activeTab !== 'doctors') return;
        const doctor = primaryDoctors.find(d => d.id === selectedId);
        const result = statementService.calculateDoctorStatement(
            selectedId, orders as any[], transactions as any[], dateRange.start, dateRange.end, adjustments as any[]
        );
        result.doctorName = doctor?.name;
        await generateDoctorStatementPDF(result, dateRange, DEFAULT_LAB_INFO);
    }, [selectedId, activeTab, primaryDoctors, orders, transactions, adjustments, dateRange]);

    const handlePrint = useCallback(async () => {
        if (!selectedId || activeTab !== 'doctors') return;
        const doctor = primaryDoctors.find(d => d.id === selectedId);
        const result = statementService.calculateDoctorStatement(
            selectedId, orders as any[], transactions as any[], dateRange.start, dateRange.end, adjustments as any[]
        );
        result.doctorName = doctor?.name;
        await generateDoctorStatementPDF(result, dateRange, DEFAULT_LAB_INFO, { print: true });
    }, [selectedId, activeTab, primaryDoctors, orders, transactions, adjustments, dateRange]);

    const handleInvoicePDF = useCallback(async (print = false) => {
        if (!selectedId || !selectedEntity || !invoiceData) return;
        
        let type: 'doctor' | 'supplier' | 'designer';
        if (activeTab === 'doctors') type = 'doctor';
        else if (activeTab === 'suppliers') type = 'supplier';
        else type = 'designer';

        await generateMonthlyInvoicePDF(
            selectedEntity.name,
            type,
            invoiceMonth,
            invoiceData,
            DEFAULT_LAB_INFO,
            { print }
        );
    }, [selectedId, selectedEntity, activeTab, invoiceMonth, invoiceData]);

    // ─ Tab config ─────────────────────────────────────────────────────────────

    const tabs = [
        { id: 'doctors' as TabType, label: 'الأطباء', icon: Users },
        { id: 'suppliers' as TabType, label: 'الموردين', icon: Factory },
        { id: 'designers' as TabType, label: 'المصممين', icon: Palette },
    ];

    const tabActiveClass = { doctors: 'bg-teal-600 text-white', suppliers: 'bg-indigo-600 text-white', designers: 'bg-amber-500 text-white' }[activeTab];
    const tabBadgeClass = { doctors: 'bg-teal-100 text-teal-700', suppliers: 'bg-indigo-100 text-indigo-700', designers: 'bg-amber-100 text-amber-700' }[activeTab];

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6" dir="rtl">
            {/* Header */}
            <div className="mb-6 flex items-center gap-3">
                <div className="p-2 bg-teal-600 rounded-xl shadow-lg shadow-teal-600/20">
                    <Receipt size={22} className="text-white" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-slate-900">كشوف الحسابات والفواتير</h1>
                    <p className="text-sm text-slate-500">أطباء · موردين · مصممين</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-5 bg-white border border-slate-200 p-1 rounded-2xl shadow-sm w-fit">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    const activeClass = { doctors: 'bg-teal-600', suppliers: 'bg-indigo-600', designers: 'bg-amber-500' }[tab.id];
                    return (
                        <button key={tab.id}
                            onClick={() => { setActiveTab(tab.id); setSelectedId(null); setSearch(''); }}
                            className={clsx('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200', isActive ? `${activeClass} text-white shadow-md` : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50')}
                        >
                            <Icon size={16} /> {tab.label}
                        </button>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

                {/* ── Left: List ── */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Filters */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                            {[{ id: 'all', label: 'الكل' }, { id: 'currentMonth', label: 'هذا الشهر' }, { id: 'previousMonth', label: 'الشهر الماضي' }, { id: 'custom', label: 'مخصص' }].map(f => (
                                <button key={f.id} onClick={() => setTimeFilter(f.id as TimeFilter)}
                                    className={clsx('px-3 py-1 rounded-lg text-xs font-semibold transition-all', timeFilter === f.id ? `${tabActiveClass} shadow-sm` : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <AnimatePresence>
                            {timeFilter === 'custom' && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                    <div className="flex gap-2 pt-1">
                                        <div className="flex-1">
                                            <label className="text-[10px] text-slate-400 font-semibold block mb-1">من</label>
                                            <input type="date" value={customRange.start} onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-400" />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] text-slate-400 font-semibold block mb-1">إلى</label>
                                            <input type="date" value={customRange.end} onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-400" />
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <div className="relative">
                            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)}
                                className="w-full pr-9 pl-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100"
                            />
                        </div>
                    </div>

                    {/* Total card */}
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 text-white shadow-lg">
                        <p className="text-xs text-slate-400 mb-1">إجمالي الرصيد المستحق</p>
                        <p className="text-2xl font-bold font-mono">{fmt(totalBalance)} <span className="text-sm text-slate-400">ج.م</span></p>
                        <p className="text-xs text-slate-500 mt-1">{filtered.length} {activeTab === 'doctors' ? 'طبيب' : activeTab === 'suppliers' ? 'مورد' : 'مصمم'}</p>
                    </div>

                    {/* Entity list */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        {loading ? (
                            <div className="p-8 text-center text-slate-400 text-sm">جاري التحميل...</div>
                        ) : filtered.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm">لا توجد نتائج</div>
                        ) : (
                            <div className="divide-y divide-slate-100 max-h-[calc(100vh-380px)] overflow-y-auto">
                                {[...filtered].sort((a, b) => b.balance - a.balance).map(entity => (
                                    <button key={entity.id} onClick={() => setSelectedId(entity.id === selectedId ? null : entity.id)}
                                        className={clsx('w-full text-right px-4 py-3 transition-all duration-150 hover:bg-slate-50 flex items-center justify-between gap-3', selectedId === entity.id && 'bg-teal-50 border-r-4 border-teal-500')}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-800 truncate">{entity.name}</span>
                                                {entity.code && <span className="text-[10px] text-slate-400 font-mono">{entity.code}</span>}
                                                {entity.isSalaried && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">مرتب ثابت</span>}
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5">
                                                <span className="text-[11px] text-slate-500">{entity.ordersCount} حالة</span>
                                                <span className="text-[11px] text-emerald-600 font-mono">دُفع {fmt(entity.totalPaid)}</span>
                                            </div>
                                        </div>
                                        <div className="text-left flex-shrink-0">
                                            <span className={clsx('text-sm font-bold font-mono', entity.balance > 0 ? 'text-red-600' : entity.balance < 0 ? 'text-emerald-600' : 'text-slate-400')}>
                                                {entity.balance > 0 ? '+' : ''}{fmt(entity.balance)}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Right: Detail ── */}
                <div className="lg:col-span-3">
                    <AnimatePresence mode="wait">
                        {selectedId && selectedEntity ? (
                            <motion.div key={selectedId} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                            >
                                {/* Detail header */}
                                <div className="flex items-start justify-between p-5 border-b border-slate-100">
                                    <div>
                                        <h2 className="text-lg font-bold text-slate-900">{selectedEntity.name}</h2>
                                        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-semibold mt-1 inline-block', tabBadgeClass)}>
                                            {activeTab === 'doctors' ? 'طبيب' : activeTab === 'suppliers' ? 'مورد' : 'مصمم'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* View mode toggle (all tabs) */}
                                        <div className="flex bg-slate-100 rounded-xl p-1">
                                            <button onClick={() => setViewMode('statement')}
                                                className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5', viewMode === 'statement' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700')}
                                            >
                                                <FileText size={12} /> كشف حساب
                                            </button>
                                            <button onClick={() => setViewMode('invoice')}
                                                className={clsx(
                                                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                                                    viewMode === 'invoice' 
                                                        ? (activeTab === 'doctors' ? 'bg-teal-600 text-white shadow-sm' : activeTab === 'suppliers' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-amber-500 text-white shadow-sm')
                                                        : 'text-slate-500 hover:text-slate-700'
                                                )}
                                            >
                                                <Receipt size={12} /> فاتورة شهرية
                                            </button>
                                        </div>

                                        {/* PDF/Print buttons depending on viewMode */}
                                        {viewMode === 'invoice' ? (
                                            <>
                                                <button onClick={() => handleInvoicePDF(true)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                                                    <Printer size={13} /> طباعة
                                                </button>
                                                <button onClick={() => handleInvoicePDF(false)} className={clsx('flex items-center gap-1.5 px-3 py-1.5 text-white rounded-xl text-xs font-semibold hover:opacity-90 transition-colors shadow-sm', activeTab === 'doctors' ? 'bg-teal-600' : activeTab === 'suppliers' ? 'bg-indigo-600' : 'bg-amber-500')}>
                                                    <FileDown size={13} /> PDF
                                                </button>
                                            </>
                                        ) : (
                                            activeTab === 'doctors' && (
                                                <>
                                                    <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                                                        <Printer size={13} /> طباعة
                                                    </button>
                                                    <button onClick={handlePDF} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-semibold hover:bg-teal-700 transition-colors shadow-sm">
                                                        <FileDown size={13} /> PDF
                                                    </button>
                                                </>
                                            )
                                        )}
                                        <button onClick={() => setSelectedId(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                                            <X size={16} className="text-slate-400" />
                                        </button>
                                    </div>
                                </div>

                                {/* ── INVOICE MODE ── */}
                                {viewMode === 'invoice' && invoiceData && (
                                    <>
                                        {/* Month navigator */}
                                        <div className={clsx('flex items-center justify-between px-5 py-3 border-b', activeTab === 'doctors' ? 'bg-teal-50 border-teal-100' : activeTab === 'suppliers' ? 'bg-indigo-50 border-indigo-100' : 'bg-amber-50 border-amber-100')}>
                                            <button onClick={() => setInvoiceMonth(prevMonth(invoiceMonth))} className={clsx('p-1.5 rounded-lg transition-colors', activeTab === 'doctors' ? 'hover:bg-teal-100 text-teal-600' : activeTab === 'suppliers' ? 'hover:bg-indigo-100 text-indigo-600' : 'hover:bg-amber-100 text-amber-600')}>
                                                <ChevronRight size={18} />
                                            </button>
                                            <div className="text-center">
                                                <p className={clsx('text-sm font-bold', activeTab === 'doctors' ? 'text-teal-800' : activeTab === 'suppliers' ? 'text-indigo-800' : 'text-amber-800')}>{monthLabel(invoiceMonth)}</p>
                                                <p className={clsx('text-[10px]', activeTab === 'doctors' ? 'text-teal-500' : activeTab === 'suppliers' ? 'text-indigo-500' : 'text-amber-500')}>{invoiceData.monthStart} → {invoiceData.monthEnd}</p>
                                            </div>
                                            <button onClick={() => setInvoiceMonth(nextMonth(invoiceMonth))} className={clsx('p-1.5 rounded-lg transition-colors', activeTab === 'doctors' ? 'hover:bg-teal-100 text-teal-600' : activeTab === 'suppliers' ? 'hover:bg-indigo-100 text-indigo-600' : 'hover:bg-amber-100 text-amber-600')}>
                                                <ChevronLeft size={18} />
                                            </button>
                                        </div>

                                        {/* Total Due Summary Card */}
                                        <div className={clsx('mx-4 mt-4 p-4 rounded-2xl flex items-center justify-between text-white shadow-md', activeTab === 'doctors' ? 'bg-teal-700 shadow-teal-700/10' : activeTab === 'suppliers' ? 'bg-indigo-700 shadow-indigo-700/10' : 'bg-amber-600 shadow-amber-600/10')}>
                                            <div>
                                                <p className="text-xs text-white/85 font-semibold">إجمالي المبلغ المطلوب للمطالبة</p>
                                                <p className="text-[10px] text-white/70 mt-0.5">{invoiceData.monthStart} ⟵ {invoiceData.monthEnd}</p>
                                            </div>
                                            <div className="text-left font-mono">
                                                <p className="text-2xl font-black">{fmt(invoiceData.totalDue)} <span className="text-xs font-bold">ج.م</span></p>
                                            </div>
                                        </div>

                                        {/* Opening balance */}
                                        {invoiceData.openingBalance !== 0 && (
                                            <div className={clsx('mx-4 mt-4 px-4 py-3 rounded-xl flex items-center justify-between text-sm', invoiceData.openingBalance > 0 ? 'bg-red-50 border border-red-100' : 'bg-emerald-50 border border-emerald-100')}>
                                                <span className={clsx('font-semibold', invoiceData.openingBalance > 0 ? 'text-red-700' : 'text-emerald-700')}>
                                                    {invoiceData.openingBalance > 0 
                                                        ? (activeTab === 'doctors' ? 'رصيد مدين من الفترة السابقة' : 'رصيد مستحق لهم من الفترة السابقة') 
                                                        : (activeTab === 'doctors' ? 'رصيد دائن من الفترة السابقة' : 'رصيد مدفوع مقدماً من الفترة السابقة')}
                                                </span>
                                                <span className={clsx('font-bold font-mono text-base', invoiceData.openingBalance > 0 ? 'text-red-600' : 'text-emerald-600')}>
                                                    {invoiceData.openingBalance > 0 ? '+' : ''}{fmt(invoiceData.openingBalance)} ج.م
                                                </span>
                                            </div>
                                        )}

                                        {/* Invoice cases table */}
                                        <div className="overflow-auto max-h-[calc(100vh-500px)] mt-4">
                                            {invoiceData.monthOrders.length === 0 ? (
                                                <div className="p-10 text-center text-slate-400 text-sm">لا توجد حالات في {monthLabel(invoiceMonth)}</div>
                                            ) : (
                                                <table className="w-full text-sm">
                                                    <thead className="sticky top-0 bg-slate-800 text-white z-10">
                                                        <tr>
                                                            <th className="text-right px-4 py-2.5 text-xs font-semibold">الحالة / المريض</th>
                                                            <th className="px-3 py-2.5 text-xs font-semibold text-center">التاريخ</th>
                                                            <th className="px-3 py-2.5 text-xs font-semibold text-center">المبلغ</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {invoiceData.monthOrders.map((line, i) => (
                                                            <tr key={line.id + i} className={clsx('hover:bg-slate-50', i % 2 !== 0 && 'bg-slate-50/50')}>
                                                                <td className="px-4 py-2.5">
                                                                    <div className="font-medium text-slate-800 text-xs">{line.description}</div>
                                                                    {line.subName && <div className="text-[10px] text-indigo-500 font-semibold mt-0.5">📍 {line.subName}</div>}
                                                                    {line.services && <div className="text-[10px] text-slate-400 mt-0.5">{line.services}</div>}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-center text-[11px] text-slate-500 font-mono">{line.date}</td>
                                                                <td className="px-3 py-2.5 text-center font-mono text-xs font-semibold text-slate-800">{fmt(line.amount)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="bg-slate-100">
                                                            <td className="px-4 py-2.5 text-xs font-bold text-slate-700">إجمالي الشهر</td>
                                                            <td />
                                                            <td className="px-3 py-2.5 text-center font-mono text-sm font-bold text-slate-800">{fmt(invoiceData.monthTotal)}</td>
                                                        </tr>
                                                        {invoiceData.openingBalance !== 0 && (
                                                            <tr className="bg-slate-200">
                                                                <td className="px-4 py-2 text-xs font-bold text-slate-600">رصيد سابق</td>
                                                                <td />
                                                                <td className={clsx('px-3 py-2 text-center font-mono text-xs font-bold', invoiceData.openingBalance > 0 ? 'text-red-600' : 'text-emerald-600')}>
                                                                    {invoiceData.openingBalance > 0 ? '+' : ''}{fmt(invoiceData.openingBalance)}
                                                                </td>
                                                            </tr>
                                                        )}
                                                        <tr className={clsx('text-white', activeTab === 'doctors' ? 'bg-teal-700' : activeTab === 'suppliers' ? 'bg-indigo-700' : 'bg-amber-600')}>
                                                            <td className="px-4 py-3 text-sm font-bold">الإجمالي المستحق</td>
                                                            <td />
                                                            <td className="px-3 py-3 text-center font-mono text-base font-bold">{fmt(invoiceData.totalDue)} ج.م</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            )}
                                        </div>
                                        {selectedBillingSettings && (
                                            <div className="px-5 py-2 border-t border-slate-100 text-[10px] text-slate-400 flex items-center gap-2">
                                                <Calendar size={10} />
                                                نظام السداد: {selectedBillingSettings.billingMode === 'monthly_cycle' ? 'شهري' : 'بالفاتورة'}
                                                {selectedBillingSettings.billingDay && ` · يوم الاستحقاق: ${selectedBillingSettings.billingDay}`}
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* ── STATEMENT MODE ── */}
                                {viewMode === 'statement' && (
                                    <>
                                        {/* Summary cards */}
                                        {selectedSummary && (
                                            <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 border-b border-slate-100">
                                                <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                                                    <p className="text-[10px] text-slate-400 font-semibold mb-1">{activeTab === 'doctors' ? 'إجمالي الحالات' : 'إجمالي العمل'}</p>
                                                    <p className="text-base font-bold text-slate-800 font-mono">{fmt(selectedSummary.totalWork)}</p>
                                                </div>
                                                <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                                                    <p className="text-[10px] text-slate-400 font-semibold mb-1">{activeTab === 'doctors' ? 'المدفوع' : 'المسدَّد'}</p>
                                                    <p className="text-base font-bold text-emerald-600 font-mono">{fmt(selectedSummary.totalPaid)}</p>
                                                </div>
                                                <div className={clsx('rounded-xl border p-3 text-center', selectedSummary.balance > 0 ? 'bg-red-50 border-red-200' : selectedSummary.balance < 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200')}>
                                                    <p className="text-[10px] text-slate-400 font-semibold mb-1">الرصيد</p>
                                                    <p className={clsx('text-base font-bold font-mono', selectedSummary.balance > 0 ? 'text-red-600' : selectedSummary.balance < 0 ? 'text-emerald-600' : 'text-slate-400')}>
                                                        {selectedSummary.balance > 0 ? '+' : ''}{fmt(selectedSummary.balance)}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Statement table */}
                                        <div className="overflow-auto max-h-[calc(100vh-380px)]">
                                            {statementLines.length === 0 ? (
                                                <div className="p-10 text-center text-slate-400 text-sm">لا توجد حركات في هذه الفترة</div>
                                            ) : (
                                                <table className="w-full text-sm">
                                                    <thead className="sticky top-0 bg-slate-800 text-white z-10">
                                                        <tr>
                                                            <th className="text-right px-4 py-2.5 text-xs font-semibold">البيان</th>
                                                            <th className="px-3 py-2.5 text-xs font-semibold text-center">التاريخ</th>
                                                            <th className="px-3 py-2.5 text-xs font-semibold text-center">{activeTab === 'doctors' ? 'مدين' : 'عمل'}</th>
                                                            <th className="px-3 py-2.5 text-xs font-semibold text-center">{activeTab === 'doctors' ? 'دائن' : 'سداد'}</th>
                                                            <th className="px-3 py-2.5 text-xs font-semibold text-center">الرصيد</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {statementLines.map((line, i) => (
                                                            <tr key={line.id + i} className={clsx('hover:bg-slate-50 transition-colors', i % 2 !== 0 && 'bg-slate-50/50')}>
                                                                <td className="px-4 py-2.5">
                                                                    <div className="font-medium text-slate-800 text-xs">{line.description}</div>
                                                                    {line.subName && <div className="text-[10px] text-indigo-500 font-semibold mt-0.5">📍 {line.subName}</div>}
                                                                    {line.services && <div className="text-[10px] text-slate-400 mt-0.5">{line.services}</div>}
                                                                    {/* Status badge — shown for all orders that have a status */}
                                                                    {line.status && (() => {
                                                                        const key = (line.status || '').trim().toLowerCase();
                                                                        const badge = STATUS_BADGE[key];
                                                                        return badge
                                                                            ? <span className={`mt-1 inline-block text-[9px] px-1.5 py-0.5 rounded-full font-bold ${badge.cls}`}>{badge.label}</span>
                                                                            : <span className="mt-1 inline-block text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-500">{line.status}</span>;
                                                                    })()}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-center text-[11px] text-slate-500 font-mono">{line.date}</td>
                                                                <td className="px-3 py-2.5 text-center font-mono text-xs">
                                                                    {line.type === 'debit' ? <span className="text-red-600 font-semibold">{fmt(line.amount)}</span> : <span className="text-slate-300">—</span>}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-center font-mono text-xs">
                                                                    {line.type === 'credit' ? <span className="text-emerald-600 font-semibold">{fmt(line.amount)}</span> : <span className="text-slate-300">—</span>}
                                                                </td>
                                                                <td className={clsx('px-3 py-2.5 text-center font-mono text-xs font-bold', line.runningBalance > 0 ? 'text-red-600' : line.runningBalance < 0 ? 'text-emerald-600' : 'text-slate-400')}>
                                                                    {fmt(line.runningBalance)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="bg-slate-800 text-white">
                                                            <td className="px-4 py-3 text-xs font-bold">الإجمالي</td>
                                                            <td />
                                                            <td className="px-3 py-3 text-center font-mono text-xs font-bold text-red-300">{fmt(statementLines.filter(l => l.type === 'debit').reduce((s, l) => s + l.amount, 0))}</td>
                                                            <td className="px-3 py-3 text-center font-mono text-xs font-bold text-emerald-300">{fmt(statementLines.filter(l => l.type === 'credit').reduce((s, l) => s + l.amount, 0))}</td>
                                                            <td className={clsx('px-3 py-3 text-center font-mono text-sm font-bold', (selectedSummary?.balance ?? 0) > 0 ? 'text-red-300' : 'text-emerald-300')}>{fmt(selectedSummary?.balance ?? 0)}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            )}
                                        </div>
                                    </>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                className="bg-white rounded-2xl border border-dashed border-slate-200 h-64 flex flex-col items-center justify-center gap-3 text-slate-400"
                            >
                                <Receipt size={40} className="text-slate-200" />
                                <p className="text-sm">اختر {activeTab === 'doctors' ? 'طبيباً' : activeTab === 'suppliers' ? 'مورداً' : 'مصمماً'} لعرض كشف حسابه</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
