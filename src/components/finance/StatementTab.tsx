/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect } from 'react';
import {
    FileText,
    Download,
    Package,
    DollarSign,
    BarChart3,
    ChevronDown,
    ChevronUp,
    Star,
    Users,
    TrendingUp,
    TrendingDown,
    Layers
} from 'lucide-react';
import { db, getFamilyAnalyticsName, type Order, type Transaction, type Doctor, type Supplier, type Service } from '../../services/db';
import { exportToExcel } from '../../lib/exportUtils';
import clsx from 'clsx';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { getDoctorServicePrice } from '../../lib/pricingUtils';
import { isLedgerTransaction } from '../../utils/transactions';
import { ALL_EXPENSE_CATEGORIES, normalizeExpenseCategory } from '../../constants/expenseCategories';
import { isDoctorStatementIncluded, getDoctorReceivableAmount, getLabCostAmount, getOfficialStatementDate, normalizeStatus, getEffectiveIssueState } from '../../constants/orderLifecycle';
import { formatOpenDateRangeLabel, isDateInOpenRange } from '../../utils/dateRange';

interface StatementTabProps {
    type: 'service' | 'expense';
    orders: Partial<Order>[];
    transactions: Partial<Transaction>[];
    doctors: Doctor[];
    suppliers: Supplier[];
    services: Service[];
    /** When provided, overrides the internal time filter and hides the dropdown */
    externalStartDate?: string;
    externalEndDate?: string;
    externalRangeLabel?: string;
}

type TimeFilter = 'today' | 'week' | 'month' | 'current_month' | 'prev_month' | 'prev_prev_month' | '3months' | 'year' | 'all' | 'custom';
type ServiceSortKey = 'revenue' | 'units' | 'cases' | 'avgSalePrice' | 'margin';

interface ServiceStats {
    serviceName: string;
    totalCases: number;
    totalUnits: number;
    totalRevenue: number;
    totalCost: number;
    avgSalePrice: number;
    avgCostPrice: number;
    grossProfit: number;
    grossMargin: number;
    topDoctor: string;
    topDoctorRevenue: number;
    topDoctorCases: number;
    rejectedCases: number;
    rejectedCost: number;
    rejectionRate: number;
}

const NON_OPERATIONAL_CATEGORIES = ['supplier_payment', 'designer_payment'];

function getStatusBadgeStyle(status?: string, issueState?: string) {
    if (issueState === 'doctor_rejected') {
        return { label: 'مرتجع طبيب', color: 'bg-rose-100 text-rose-800 border-rose-300 font-bold' };
    }
    if (issueState === 'lab_rejected') {
        return { label: 'مرتجع معمل', color: 'bg-red-100 text-red-800 border-red-300 font-bold' };
    }
    if (issueState === 'cancelled' || normalizeStatus(status) === 'cancelled') {
        return { label: 'ملغي', color: 'bg-slate-200 text-slate-800 border-slate-300 font-bold' };
    }

    const norm = normalizeStatus(status);
    if (norm === 'delivered' || norm === 'تم التسليم') {
        return { label: 'تم التسليم', color: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold' };
    }
    if (norm === 'doctor rejected' || norm === 'rejected') {
        return { label: 'مرتجع طبيب', color: 'bg-rose-100 text-rose-800 border-rose-300 font-bold' };
    }
    if (norm === 'lab rejected') {
        return { label: 'مرتجع معمل', color: 'bg-red-100 text-red-800 border-red-300 font-bold' };
    }
    if (norm === 'try in' || norm === 'بروفة') {
        return { label: 'بروفة', color: 'bg-amber-100 text-amber-900 border-amber-300 font-bold' };
    }
    if (norm === 'under production' || norm === 'in progress' || norm === 'تشغيل') {
        return { label: 'قيد التشغيل', color: 'bg-blue-100 text-blue-800 border-blue-300 font-bold' };
    }
    if (norm === 'ready' || norm === 'جاهز') {
        return { label: 'جاهز للتسليم', color: 'bg-teal-100 text-teal-800 border-teal-300 font-bold' };
    }
    return { label: status || 'غير محدد', color: 'bg-slate-100 text-slate-700 border-slate-200 font-bold' };
}

export default function StatementTab({
    type: targetType,
    orders,
    transactions,
    doctors,
    services,
    externalStartDate,
    externalEndDate,
    externalRangeLabel,
}: StatementTabProps) {
    const usesExternalDates = externalStartDate !== undefined || externalEndDate !== undefined;
    const [selectedServiceId, setSelectedServiceId] = useState<string>('');
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [selectedExpenseCategory, setSelectedExpenseCategory] = useState<string>('');
    const [expandedExpenseCategory, setExpandedExpenseCategory] = useState<string | null>(null);
    const [serviceSortKey, setServiceSortKey] = useState<ServiceSortKey>('revenue');
    const [serviceSortAsc, setServiceSortAsc] = useState(false);
    const [expandedService, setExpandedService] = useState<string | null>(null);

    const [groupMode, setGroupMode] = useState<'service' | 'family'>('service');
    const [families, setFamilies] = useState<import('../../services/db').ServiceFamily[]>([]);
    const [expandedFamily, setExpandedFamily] = useState<string | null>(null);

    useEffect(() => {
        db.getServiceFamilies().then(setFamilies).catch(console.error);
    }, []);

    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });

    const expenseCategories = ALL_EXPENSE_CATEGORIES;



    // Resolve date range to start/end strings
    const resolvedDates = useMemo(() => {
        // External dates from parent override internal filter
        if (usesExternalDates) return { start: externalStartDate || '', end: externalEndDate || '' };
        if (timeFilter === 'custom') return { start: customDateRange.start, end: customDateRange.end };
        if (timeFilter === 'all') return { start: '', end: '' };

        const today = new Date();
        const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

        switch (timeFilter) {
            case 'today': return { start: fmt(today), end: fmt(today) };
            case 'week': { const w = new Date(today); w.setDate(today.getDate() - 7); return { start: fmt(w), end: fmt(today) }; }
            case 'month': { const m = new Date(today); m.setDate(today.getDate() - 30); return { start: fmt(m), end: fmt(today) }; }
            case 'current_month': return { start: fmt(startOfMonth(today)), end: fmt(endOfMonth(today)) };
            case 'prev_month': { const p = subMonths(today, 1); return { start: fmt(startOfMonth(p)), end: fmt(endOfMonth(p)) }; }
            case 'prev_prev_month': { const p2 = subMonths(today, 2); return { start: fmt(startOfMonth(p2)), end: fmt(endOfMonth(p2)) }; }
            case '3months': { const t3 = new Date(today); t3.setMonth(today.getMonth() - 3); return { start: fmt(t3), end: fmt(today) }; }
            case 'year': return { start: fmt(new Date(today.getFullYear(), 0, 1)), end: fmt(new Date(today.getFullYear(), 11, 31)) };
            default: return { start: '', end: '' };
        }
    }, [timeFilter, customDateRange, usesExternalDates, externalStartDate, externalEndDate]);



    const filteredOrders = useMemo(() => {
        const { start, end } = resolvedDates;
        return orders.filter(o => {
            if (!o.items) return false;
            // Same inclusion rule as the doctor statement page (Accounts.tsx):
            // delivered/completed/cancelled/rejected/returned orders only —
            // never an in-progress status (Ready, Under Production, Try In,
            // etc.), which used to be silently counted as sold here.
            if (!isDoctorStatementIncluded(o)) return false;
            // Same date rule as the doctor statement page: for a
            // final-delivered order, bucket it by when it was ACTUALLY
            // delivered, not the originally scheduled delivery date — an
            // order scheduled for one month but delivered the next must
            // land in the month it really happened, matching the RPC.
            const orderDate = getOfficialStatementDate(o);
            if (!isDateInOpenRange(orderDate, { start, end })) return false;
            if (selectedDoctorId && o.doctorId !== selectedDoctorId) return false;
            return true;
        });
    }, [orders, resolvedDates, selectedDoctorId]);

    // --- SERVICE ANALYTICS: aggregate per service from item-level data ---
    const serviceAnalytics = useMemo((): ServiceStats[] => {
        if (targetType !== 'service') return [];

        const map = new Map<string, {
            cases: Set<string>;
            units: number;
            revenue: number;
            cost: number;
            rejectedCases: Set<string>;
            rejectedCost: number;
            doctorStats: Map<string, { rev: number; cases: Set<string> }>;
        }>();

        filteredOrders.forEach(o => {
            const items = o.items as any[];
            if (!items || items.length === 0) return;

            const orderDoctor = doctors.find(d => d.id === o.doctorId);

            const isLabRejected = normalizeStatus(o.status) === 'lab rejected' || getEffectiveIssueState(o) === 'lab_rejected';
            const isDoctorRejected = ['Doctor Rejected', 'Rejected'].includes(o.status as string) || getEffectiveIssueState(o) === 'doctor_rejected';
            const isRejected = isLabRejected || isDoctorRejected;

            // Revenue mirrors the doctor statement page exactly: full price
            // for a normal delivered order, the settled rejection amount
            // (once decided) for a rejected/redo order, 0 otherwise.
            const effectiveTotalPrice = getDoctorReceivableAmount(o);
            
            // Cost on the P&L's basis. Shared with OrderAnalysisTab so the two
            // tabs of this page cannot report different costs for one order.
            const effectiveCost = getLabCostAmount(o);

            // Compute proportional weights (same approach regardless of rejection)
            const itemWeights2: number[] = items.map((it: any) => {
                const cnt = Array.isArray(it.teethNumbers) ? it.teethNumbers.length : 1;
                if (it.price > 0) return it.price * cnt;
                const sv = services.find(s => s.name === it.serviceType as string);
                const catalogUnitPrice = getDoctorServicePrice(it.serviceType as string, sv, orderDoctor, doctors);
                return catalogUnitPrice > 0 ? catalogUnitPrice * cnt : cnt;
            });
            const totalWeight2 = itemWeights2.reduce((s, w) => s + w, 0);

            items.forEach((item: any, itemIdx: number) => {
                const svcName = item.serviceType as string;
                if (!svcName) return;

                if (selectedServiceId) {
                    const srv = services.find(s => s.id === selectedServiceId);
                    if (srv && srv.name !== svcName) return;
                }

                const count = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;

                // Revenue = proportional share of effective total (0 for rejected)
                const itemRevenue = totalWeight2 > 0
                    ? (effectiveTotalPrice * itemWeights2[itemIdx]) / totalWeight2
                    : 0;

                // Cost = proportional share of effective cost (matching RPC & statement parity)
                const itemCost = totalWeight2 > 0
                    ? (effectiveCost * itemWeights2[itemIdx]) / totalWeight2
                    : 0;

                if (!map.has(svcName)) {
                    map.set(svcName, { cases: new Set(), units: 0, revenue: 0, cost: 0, rejectedCases: new Set(), rejectedCost: 0, doctorStats: new Map() });
                }
                const entry = map.get(svcName)!;
                if (o.id) entry.cases.add(o.id);
                entry.units += count;
                entry.revenue += itemRevenue;
                entry.cost += itemCost;
                if (isRejected && o.id) {
                    entry.rejectedCases.add(o.id);
                    entry.rejectedCost += itemCost;
                }

                const drId = o.doctorId || '';
                if (!entry.doctorStats.has(drId)) entry.doctorStats.set(drId, { rev: 0, cases: new Set() });
                const ds = entry.doctorStats.get(drId)!;
                ds.rev += itemRevenue;
                if (o.id) ds.cases.add(o.id);
            });
        });

        const stats: ServiceStats[] = [];
        map.forEach((entry, svcName) => {
            let topDoctorId = '';
            let topDoctorRev = 0;
            let topDoctorCases = 0;
            entry.doctorStats.forEach((ds, id) => {
                if (ds.rev > topDoctorRev) { topDoctorRev = ds.rev; topDoctorId = id; topDoctorCases = ds.cases.size; }
            });

            const grossProfit = entry.revenue - entry.cost;
            const grossMargin = entry.revenue > 0 ? (grossProfit / entry.revenue) * 100 : 0;

            stats.push({
                serviceName: svcName,
                totalCases: entry.cases.size,
                totalUnits: entry.units,
                totalRevenue: entry.revenue,
                totalCost: entry.cost,
                avgSalePrice: entry.units > 0 ? entry.revenue / entry.units : 0,
                avgCostPrice: entry.units > 0 ? entry.cost / entry.units : 0,
                grossProfit,
                grossMargin,
                topDoctor: doctors.find(d => d.id === topDoctorId)?.name || '',
                topDoctorRevenue: topDoctorRev,
                topDoctorCases,
                rejectedCases: entry.rejectedCases.size,
                rejectedCost: entry.rejectedCost,
                rejectionRate: entry.cases.size > 0 ? (entry.rejectedCases.size / entry.cases.size) * 100 : 0,
            });
        });

        stats.sort((a, b) => {
            const av = serviceSortKey === 'revenue' ? a.totalRevenue
                : serviceSortKey === 'units' ? a.totalUnits
                    : serviceSortKey === 'cases' ? a.totalCases
                        : serviceSortKey === 'margin' ? a.grossMargin
                            : a.avgSalePrice;
            const bv = serviceSortKey === 'revenue' ? b.totalRevenue
                : serviceSortKey === 'units' ? b.totalUnits
                    : serviceSortKey === 'cases' ? b.totalCases
                        : serviceSortKey === 'margin' ? b.grossMargin
                            : b.avgSalePrice;
            return serviceSortAsc ? av - bv : bv - av;
        });

        return stats;
    }, [filteredOrders, targetType, selectedServiceId, services, doctors, serviceSortKey, serviceSortAsc]);

    // Aggregate family analytics from serviceAnalytics
    const familyAnalytics = useMemo(() => {
        if (targetType !== 'service' || serviceAnalytics.length === 0) return [];
        const map = new Map<string, {
            familyId: string | null;
            familyName: string;
            familyColor: string;
            totalCases: number;
            totalUnits: number;
            totalRevenue: number;
            totalCost: number;
            services: ServiceStats[];
        }>();

        serviceAnalytics.forEach(stat => {
            const svc = services.find(s => s.name === stat.serviceName);
            const family = families.find(f => f.id === svc?.familyId);
            const familyKey = family ? family.id : `single_${stat.serviceName}`;
            const familyName = getFamilyAnalyticsName(family, stat.serviceName);
            const familyColor = family ? (family.color || 'emerald') : 'slate';

            if (!map.has(familyKey)) {
                map.set(familyKey, {
                    familyId: family?.id || null,
                    familyName,
                    familyColor,
                    totalCases: 0,
                    totalUnits: 0,
                    totalRevenue: 0,
                    totalCost: 0,
                    services: []
                });
            }
            const entry = map.get(familyKey)!;
            entry.totalCases += stat.totalCases;
            entry.totalUnits += stat.totalUnits;
            entry.totalRevenue += stat.totalRevenue;
            entry.totalCost += stat.totalCost;
            entry.services.push(stat);
        });

        return Array.from(map.values()).map(f => {
            const grossProfit = f.totalRevenue - f.totalCost;
            const grossMargin = f.totalRevenue > 0 ? (grossProfit / f.totalRevenue) * 100 : 0;
            const avgSalePrice = f.totalUnits > 0 ? f.totalRevenue / f.totalUnits : 0;
            const avgCostPrice = f.totalUnits > 0 ? f.totalCost / f.totalUnits : 0;
            return {
                ...f,
                grossProfit,
                grossMargin,
                avgSalePrice,
                avgCostPrice
            };
        }).sort((a, b) => b.totalRevenue - a.totalRevenue);
    }, [targetType, serviceAnalytics, services, families]);

    // Detail rows for expanded service panel
    const expandedItems = useMemo(() => {
        if (!expandedService) return [];
        const items: any[] = [];
        filteredOrders.forEach(o => {
            const orderDate = getOfficialStatementDate(o);
            const orderDocExp = doctors.find(d => d.id === o.doctorId);
            const orderItems = o.items as any[];

            // Compute proportional weights (same as analytics)
            const expWeights: number[] = orderItems.map((it: any) => {
                const cnt = Array.isArray(it.teethNumbers) ? it.teethNumbers.length : 1;
                if (it.price > 0) return it.price * cnt;
                const sv = services.find(s => s.name === it.serviceType as string);
                const catP = getDoctorServicePrice(it.serviceType as string, sv, orderDocExp, doctors);
                return catP > 0 ? catP * cnt : cnt;
            });
            const expWeightTotal = expWeights.reduce((s, w) => s + w, 0);

            orderItems.forEach((item: any, idx: number) => {
                if (item.serviceType !== expandedService) return;
                const count = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;

                // Revenue from proportional distribution (settlement-aware —
                // same amount the doctor statement page would recognize)
                const orderReceivable = getDoctorReceivableAmount(o);
                const itemRevExp = expWeightTotal > 0
                    ? (orderReceivable * expWeights[idx]) / expWeightTotal
                    : 0;
                const resolvedUnitPrice = count > 0 ? itemRevExp / count : 0;

                // Price source label
                let priceSource: 'actual' | 'derived' | 'estimated';
                if (item.price > 0) {
                    priceSource = 'actual';
                } else if ((o.totalPrice || 0) > 0) {
                    priceSource = 'derived'; // calculated from real totalPrice
                } else {
                    priceSource = 'estimated'; // catalog only
                }

                // Cost per unit based on proportional share of effective order cost
                const isCancelledExp = normalizeStatus(o.status) === 'cancelled' || getEffectiveIssueState(o) === 'cancelled';
                const isLabRejectedExp = normalizeStatus(o.status) === 'lab rejected' || getEffectiveIssueState(o) === 'lab_rejected';
                const isDoctorRejectedExp = ['Doctor Rejected', 'Rejected'].includes(o.status as string) || getEffectiveIssueState(o) === 'doctor_rejected';

                const effectiveCostExp = (isCancelledExp || isLabRejectedExp)
                    ? 0
                    : isDoctorRejectedExp
                        ? ((o as any).rejectedLabCost ?? o.cost ?? 0)
                        : (o.cost || 0);
                const itemCostExp = expWeightTotal > 0
                    ? (effectiveCostExp * expWeights[idx]) / expWeightTotal
                    : 0;
                const costPerUnit = count > 0 ? itemCostExp / count : 0;

                items.push({
                    id: `${o.id}-${idx}`,
                    date: orderDate, caseId: o.caseId,
                    serviceType: item.serviceType || expandedService,
                    patientName: o.patientName,
                    doctorName: orderDocExp?.name || 'غير معروف',
                    teeth: Array.isArray(item.teethNumbers) ? item.teethNumbers.join(', ') : '',
                    count,
                    unitPrice: resolvedUnitPrice,
                    totalPrice: itemRevExp,
                    costPerUnit,
                    totalCost: costPerUnit * count,
                    priceSource,
                    status: o.status,
                    issueState: getEffectiveIssueState(o)
                });
            });
        });
        items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return items;
    }, [expandedService, filteredOrders, doctors, services]);

    // Expense data
    const expenseData = useMemo(() => {
        if (targetType !== 'expense') return { items: [], totalAmount: 0 };
        const { start, end } = resolvedDates;
        const items: any[] = [];
        let totalAmount = 0;
        transactions.filter(t => {
            if (t.type !== 'expense') return false;
            if (!isLedgerTransaction(t)) return false;
            if (t.entityType === 'supplier' || t.entityType === 'designer' || t.entityType === 'representative') return false;
            if (NON_OPERATIONAL_CATEGORIES.includes(t.category || '')) return false;
            if (!t.amount || t.amount <= 0) return false;
            if ((t as any).status === 'rejected') return false;
            if ((t.category || '').startsWith('#')) return false;
            const txDate = ((t as any).effectiveDate || t.date || '').split('T')[0];
            if (!isDateInOpenRange(txDate, { start, end })) return false;
            if (selectedExpenseCategory && normalizeExpenseCategory(t.category) !== selectedExpenseCategory) return false;
            return true;
        }).forEach(t => {
            const transactionDate = (t.date || '').split('T')[0];
            const effectiveDate = ((t as any).effectiveDate || t.date || '').split('T')[0];
            items.push({
                id: t.id,
                date: effectiveDate,
                transactionDate,
                category: normalizeExpenseCategory(t.category),
                description: t.description || '',
                amount: t.amount || 0
            });
            totalAmount += (t.amount || 0);
        });
        items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return { items, totalAmount };
    }, [transactions, targetType, resolvedDates, selectedExpenseCategory]);

    // Expense analytics: aggregate by category
    const expenseCategoryStats = useMemo(() => {
        if (targetType !== 'expense') return [];
        const catMap = new Map<string, { total: number; count: number; items: any[] }>();
        expenseData.items.forEach((item: any) => {
            if (!catMap.has(item.category)) catMap.set(item.category, { total: 0, count: 0, items: [] });
            const entry = catMap.get(item.category)!;
            entry.total += item.amount;
            entry.count++;
            entry.items.push(item);
        });
        const total = expenseData.totalAmount;
        return Array.from(catMap.entries())
            .map(([cat, d]) => ({
                category: cat,
                total: d.total,
                count: d.count,
                share: total > 0 ? (d.total / total) * 100 : 0,
                items: d.items,
            }))
            .sort((a, b) => b.total - a.total);
    }, [expenseData, targetType]);

    // Non-operational payments aggregate (supplier_payment + designer_payment)
    const nonOperationalPayments = useMemo(() => {
        if (targetType !== 'expense') return { supplierTotal: 0, designerTotal: 0, supplierCount: 0, designerCount: 0 };
        const { start, end } = resolvedDates;
        let supplierTotal = 0, designerTotal = 0, supplierCount = 0, designerCount = 0;
        transactions.forEach(t => {
            if (t.type !== 'expense') return;
            if (!isLedgerTransaction(t)) return;
            if (!NON_OPERATIONAL_CATEGORIES.includes(t.category || '')) return;
            if (!t.amount || t.amount <= 0) return;
             
            if ((t as any).status === 'rejected') return;
             
            const txDate = ((t as any).effectiveDate || t.date || '').split('T')[0];
            if (!isDateInOpenRange(txDate, { start, end })) return;
            if (t.category === 'supplier_payment') { supplierTotal += t.amount; supplierCount++; }
            else if (t.category === 'designer_payment') { designerTotal += t.amount; designerCount++; }
        });
        return { supplierTotal, designerTotal, supplierCount, designerCount };
    }, [transactions, targetType, resolvedDates]);

    // Total income (for expense-to-revenue ratio)
    const totalIncomeForRatio = useMemo(() => {
        if (targetType !== 'expense') return 0;
        const { start, end } = resolvedDates;
        return transactions
            .filter(t => {
                if (t.type !== 'income') return false;
                if (!t.amount || t.amount <= 0) return false;
                 
                if ((t as any).status === 'rejected') return false;
                 
                const txDate = ((t as any).effectiveDate || t.date || '').split('T')[0];
                if (!isDateInOpenRange(txDate, { start, end })) return false;
                return true;
            })
            .reduce((s, t) => s + (t.amount || 0), 0);
    }, [transactions, targetType, resolvedDates]);

    const totalRevenue = serviceAnalytics.reduce((s, x) => s + x.totalRevenue, 0);
    const totalUnits = serviceAnalytics.reduce((s, x) => s + x.totalUnits, 0);
    const totalCost = serviceAnalytics.reduce((s, x) => s + x.totalCost, 0);
    const totalGrossProfit = totalRevenue - totalCost;

    // Doctor × Service Matrix: top doctors (by revenue) × top services (by units)
    const doctorServiceMatrix = useMemo(() => {
        if (targetType !== 'service' || filteredOrders.length === 0) return null;

        // Build {doctorId: {serviceName: units}}
        const matrix = new Map<string, Map<string, number>>();
        const doctorRevenue = new Map<string, number>();
        const serviceUnits = new Map<string, number>();

        filteredOrders.forEach(o => {
            const dId = o.doctorId || '';
            if (!dId) return;
            if (!matrix.has(dId)) matrix.set(dId, new Map());
            const dRow = matrix.get(dId)!;
             
            const items = (o.items as any[]) || [];
             
            items.forEach((item: any) => {
                const svc = item.serviceType as string;
                if (!svc) return;
                const cnt = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;
                dRow.set(svc, (dRow.get(svc) || 0) + cnt);
                serviceUnits.set(svc, (serviceUnits.get(svc) || 0) + cnt);
            });
            doctorRevenue.set(dId, (doctorRevenue.get(dId) || 0) + getDoctorReceivableAmount(o));
        });

        // Top 6 doctors by revenue
        const topDocIds = Array.from(doctorRevenue.entries())
            .sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
        // Top 6 services by units
        const topSvcNames = Array.from(serviceUnits.entries())
            .sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);

        // Max cell value for color scaling
        let maxCell = 0;
        topDocIds.forEach(dId => {
            const row = matrix.get(dId);
            topSvcNames.forEach(s => {
                const v = row?.get(s) || 0;
                if (v > maxCell) maxCell = v;
            });
        });

        const rows = topDocIds.map(dId => ({
            doctorId: dId,
            doctorName: doctors.find(d => d.id === dId)?.name || 'غير معروف',
            totalRev: doctorRevenue.get(dId) || 0,
            cells: topSvcNames.map(s => matrix.get(dId)?.get(s) || 0),
        }));

        return { rows, services: topSvcNames, maxCell };
    }, [filteredOrders, doctors, targetType]);
    const overallMargin = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;

    const handleExportExcel = () => {
        if (targetType === 'service') {
            exportToExcel(serviceAnalytics.map(s => ({
                'الخدمة': s.serviceName,
                'عدد الحالات': s.totalCases,
                'إجمالي الوحدات': s.totalUnits,
                'إجمالي الإيراد (ج.م)': Math.round(s.totalRevenue),
                'متوسط سعر البيع (ج.م/وحدة)': Math.round(s.avgSalePrice),
                'متوسط تكلفة الشراء (ج.م/وحدة)': s.avgCostPrice > 0 ? Math.round(s.avgCostPrice) : '—',
                'هامش الربح %': s.avgCostPrice > 0 ? s.grossMargin.toFixed(1) + '%' : '—',
                'أكثر طبيب': s.topDoctor,
            })), `تحليل_الخدمات_${format(new Date(), 'yyyy-MM-dd')}`);
        } else {
            exportToExcel(expenseCategoryStats.map((c: any) => ({
                'الفئة': c.category,
                'إجمالي المصروف (ج.م)': Math.round(c.total),
                '% من الإجمالي': c.share.toFixed(1) + '%',
                'عدد الحركات': c.count,
            })), `تحليل_المصروفات_${format(new Date(), 'yyyy-MM-dd')}`);
        }
    };

    const toggleSort = (key: ServiceSortKey) => {
        if (serviceSortKey === key) setServiceSortAsc(v => !v);
        else { setServiceSortKey(key); setServiceSortAsc(false); }
    };

    const SortIcon = ({ k }: { k: ServiceSortKey }) =>
        serviceSortKey === k ? (serviceSortAsc ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />) : <ChevronDown size={12} className="inline ml-1 opacity-20" />;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Filters */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex flex-col md:flex-row gap-4 mb-5">
                    <div className="flex-1">
                        <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
                            {targetType === 'service'
                                ? <><BarChart3 className="text-teal-600" /> تحليل أداء الخدمات</>
                                : <><FileText className="text-rose-600" /> كشف المصروفات التشغيلية</>}
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            {targetType === 'service'
                                ? 'مقارنة شاملة لكل خدمة: الإيراد، الوحدات، متوسط السعر، وأكثر طبيب طالب'
                                : 'تحليل مفصل للمصروفات التشغيلية لفترة محددة'}
                        </p>
                    </div>
                </div>

                {/* Active main-filter chip when external dates are in use */}
                {usesExternalDates && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl w-fit">
                        <BarChart3 size={14} className="text-blue-600" />
                        <span className="text-xs font-bold text-blue-700">الفترة الزمنية:</span>
                        <span className="text-xs font-bold text-blue-900">
                            {externalRangeLabel || formatOpenDateRangeLabel({
                                start: externalStartDate,
                                end: externalEndDate,
                            })}
                        </span>
                        <span className="text-[10px] text-blue-500 mr-2">(من فلتر الصفحة الرئيسي)</span>
                    </div>
                )}

                <div className={clsx(
                    "grid gap-4 p-4 bg-gray-50/50 rounded-xl border border-gray-100",
                    usesExternalDates
                        ? "grid-cols-1 md:grid-cols-2"
                        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
                )}>
                    {!usesExternalDates && (
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">الفترة الزمنية</label>
                            <select aria-label="الفترة الزمنية" value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
                                className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5">
                                <option value="today">اليوم</option>
                                <option value="week">آخر 7 أيام</option>
                                <option value="month">آخر 30 يوم</option>
                                <option value="current_month">{format(new Date(), 'MMMM')} (الشهر الحالي)</option>
                                <option value="prev_month">{format(subMonths(new Date(), 1), 'MMMM')} (الشهر السابق)</option>
                                <option value="prev_prev_month">{format(subMonths(new Date(), 2), 'MMMM')}</option>
                                <option value="3months">آخر 3 شهور</option>
                                <option value="year">هذا العام</option>
                                <option value="custom">فترة مخصصة...</option>
                                <option value="all">كل الأوقات</option>
                            </select>
                        </div>
                    )}

                    {!usesExternalDates && timeFilter === 'custom' && (
                        <div className="space-y-1.5 col-span-1 lg:col-span-2">
                            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">من - إلى</label>
                            <div className="flex gap-2">
                                <input type="date" aria-label="من" value={customDateRange.start}
                                    onChange={e => setCustomDateRange(p => ({ ...p, start: e.target.value }))}
                                    className="w-full bg-white border border-gray-200 text-sm rounded-lg p-2.5" />
                                <span className="self-center text-gray-400">–</span>
                                <input type="date" aria-label="إلى" value={customDateRange.end}
                                    onChange={e => setCustomDateRange(p => ({ ...p, end: e.target.value }))}
                                    className="w-full bg-white border border-gray-200 text-sm rounded-lg p-2.5" />
                            </div>
                            <p className="mt-1 text-[11px] text-gray-400">
                                يمكن ترك أي طرف فارغًا ليبقى النطاق مفتوحًا.
                            </p>
                        </div>
                    )}

                    {targetType === 'service' ? (
                        <>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">فلتر الخدمة</label>
                                <select aria-label="الخدمة" value={selectedServiceId}
                                    onChange={(e) => { setSelectedServiceId(e.target.value); setExpandedService(null); }}
                                    className="w-full bg-white border border-gray-200 text-sm rounded-lg p-2.5">
                                    <option value="">جميع الخدمات</option>
                                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">فلتر الطبيب</label>
                                <select aria-label="الطبيب" value={selectedDoctorId}
                                    onChange={(e) => setSelectedDoctorId(e.target.value)}
                                    className="w-full bg-white border border-gray-200 text-sm rounded-lg p-2.5">
                                    <option value="">جميع الأطباء</option>
                                    {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">فئة المصروف</label>
                            <select aria-label="فئة المصروف" value={selectedExpenseCategory}
                                onChange={(e) => setSelectedExpenseCategory(e.target.value)}
                                className="w-full bg-white border border-gray-200 text-sm rounded-lg p-2.5">
                                <option value="">جميع المصروفات</option>
                                {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* ===== SERVICE ANALYSIS ===== */}
            {targetType === 'service' && (
                <>
                    {/* KPI Summary */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-5 rounded-2xl border border-teal-100 shadow-sm text-center">
                            <div className="flex justify-center mb-2"><div className="p-2 bg-teal-50 rounded-xl"><Package size={20} className="text-teal-600" /></div></div>
                            <p className="text-xs font-bold text-teal-600 mb-1">عدد الخدمات</p>
                            <p className="text-3xl font-black text-teal-900">{serviceAnalytics.length}</p>
                            <p className="text-xs text-gray-400 mt-1">{totalUnits.toLocaleString()} وحدة إجمالاً</p>
                        </div>
                        <div className="bg-white p-5 rounded-2xl border border-blue-100 shadow-sm text-center">
                            <div className="flex justify-center mb-2"><div className="p-2 bg-blue-50 rounded-xl"><DollarSign size={20} className="text-blue-600" /></div></div>
                            <p className="text-xs font-bold text-blue-600 mb-1">إجمالي الإيراد</p>
                            <p className="text-3xl font-black text-blue-900">{Math.round(totalRevenue).toLocaleString()}</p>
                            <p className="text-xs text-gray-400 mt-1">ج.م</p>
                        </div>
                        <div className={clsx("p-5 rounded-2xl border shadow-sm text-center", totalGrossProfit >= 0 ? "bg-white border-emerald-100" : "bg-white border-rose-100")}>
                            <div className="flex justify-center mb-2">
                                <div className={clsx("p-2 rounded-xl", totalGrossProfit >= 0 ? "bg-emerald-50" : "bg-rose-50")}>
                                    {totalGrossProfit >= 0 ? <TrendingUp size={20} className="text-emerald-600" /> : <TrendingDown size={20} className="text-rose-600" />}
                                </div>
                            </div>
                            <p className={clsx("text-xs font-bold mb-1", totalGrossProfit >= 0 ? "text-emerald-600" : "text-rose-600")}>إجمالي الربح</p>
                            <p className={clsx("text-3xl font-black", totalGrossProfit >= 0 ? "text-emerald-900" : "text-rose-900")}>{Math.round(totalGrossProfit).toLocaleString()}</p>
                            <p className="text-xs text-gray-400 mt-1">ج.م</p>
                        </div>
                        <div className={clsx("p-5 rounded-2xl border shadow-sm text-center",
                            overallMargin >= 40 ? "bg-white border-emerald-200" : overallMargin >= 20 ? "bg-white border-blue-200" : "bg-white border-amber-200")}>
                            <div className="flex justify-center mb-2">
                                <div className={clsx("p-2 rounded-xl",
                                    overallMargin >= 40 ? "bg-emerald-50" : overallMargin >= 20 ? "bg-blue-50" : "bg-amber-50")}>
                                    <BarChart3 size={20} className={overallMargin >= 40 ? "text-emerald-600" : overallMargin >= 20 ? "text-blue-600" : "text-amber-600"} />
                                </div>
                            </div>
                            <p className={clsx("text-xs font-bold mb-1", overallMargin >= 40 ? "text-emerald-600" : overallMargin >= 20 ? "text-blue-600" : "text-amber-600")}>هامش الربح الكلي</p>
                            <p className={clsx("text-3xl font-black", overallMargin >= 40 ? "text-emerald-900" : overallMargin >= 20 ? "text-blue-900" : "text-amber-900")}>{overallMargin.toFixed(1)}%</p>
                            <p className={clsx("text-xs font-medium mt-1", overallMargin >= 40 ? "text-emerald-600" : overallMargin >= 20 ? "text-blue-600" : "text-amber-600")}>
                                {overallMargin >= 40 ? 'ممتاز' : overallMargin >= 20 ? 'جيد' : 'يحتاج مراجعة'}
                            </p>
                        </div>
                    </div>

                    {/* Service Mix Visual */}
                    {serviceAnalytics.length > 1 && totalRevenue > 0 && (
                        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                                <BarChart3 size={16} className="text-teal-600" />
                                <h3 className="font-bold text-gray-800 text-sm">توزيع الإيراد بين الخدمات</h3>
                                <span className="text-xs text-gray-400">(Service Mix)</span>
                            </div>
                            {(() => {
                                const COLORS = ['bg-teal-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-400', 'bg-cyan-400', 'bg-indigo-400'];
                                const top = serviceAnalytics.slice(0, 8);
                                const otherShare = serviceAnalytics.slice(8).reduce((s, x) => s + x.totalRevenue, 0);
                                return (
                                    <>
                                        <div className="w-full h-7 rounded-full flex overflow-hidden gap-0.5 mb-3 bg-slate-100">
                                            {top.map((svc, i) => {
                                                const pct = (svc.totalRevenue / totalRevenue) * 100;
                                                if (pct < 0.5) return null;
                                                return (
                                                     
                                                    <div key={svc.serviceName} className={clsx(COLORS[i % COLORS.length], 'transition-all hover:opacity-80')}
                                                        style={{ width: `${pct}%` }}
                                                        title={`${svc.serviceName}: ${pct.toFixed(1)}%`} />
                                                );
                                            })}
                                            {otherShare > 0 && (
                                                 
                                                <div className="bg-slate-400"
                                                    style={{ width: `${(otherShare / totalRevenue) * 100}%` }}
                                                    title={`أخرى: ${((otherShare / totalRevenue) * 100).toFixed(1)}%`} />
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-3 text-xs">
                                            {top.map((svc, i) => {
                                                const pct = (svc.totalRevenue / totalRevenue) * 100;
                                                return (
                                                    <div key={svc.serviceName} className="flex items-center gap-1.5">
                                                        <div className={clsx('w-3 h-3 rounded-sm', COLORS[i % COLORS.length])} />
                                                        <span className="text-slate-600 font-medium">{svc.serviceName}</span>
                                                        <span className="text-slate-400 font-bold">{pct.toFixed(1)}%</span>
                                                    </div>
                                                );
                                            })}
                                            {otherShare > 0 && (
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-3 h-3 rounded-sm bg-slate-400" />
                                                    <span className="text-slate-600 font-medium">أخرى</span>
                                                    <span className="text-slate-400 font-bold">{((otherShare / totalRevenue) * 100).toFixed(1)}%</span>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}

                    {/* Mode Selector Header */}
                    <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">طريقة تجميع التحليلات:</span>
                            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                                <button
                                    onClick={() => setGroupMode('service')}
                                    className={clsx(
                                        'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                                        groupMode === 'service' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                                    )}
                                >
                                    📊 حسب الخدمة (تفصيلي)
                                </button>
                                <button
                                    onClick={() => setGroupMode('family')}
                                    className={clsx(
                                        'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                                        groupMode === 'family' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'
                                    )}
                                >
                                    🔷 حسب العائلة (تجميعي)
                                </button>
                            </div>
                        </div>
                        <span className="text-xs text-slate-400">
                            {groupMode === 'family' ? `عرض ${familyAnalytics.length} عائلة مجمعة` : `عرض ${serviceAnalytics.length} خدمة تفصيلية`}
                        </span>
                    </div>

                    {/* Family Comparison Table */}
                    {groupMode === 'family' && (
                        <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
                            <div className="p-4 border-b border-indigo-100 bg-indigo-50/40 flex justify-between items-center">
                                <h3 className="font-bold text-indigo-950 flex items-center gap-2 text-sm">
                                    <Layers size={18} className="text-indigo-600" />
                                    جدول مقارنة العوائل
                                    <span className="bg-indigo-100 text-indigo-800 py-0.5 px-2.5 rounded-full text-xs font-bold">{familyAnalytics.length} عائلة</span>
                                </h3>
                                <button onClick={handleExportExcel}
                                    className="bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer">
                                    <Download size={14} /> تصدير Excel
                                </button>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-right">
                                    <thead className="bg-indigo-900 text-white font-bold">
                                        <tr>
                                            <th className="p-3 w-8 text-center">#</th>
                                            <th className="p-3">عائلة الخدمة</th>
                                            <th className="p-3 text-center">الحالات</th>
                                            <th className="p-3 text-center">الوحدات</th>
                                            <th className="p-3 text-center">إجمالي الإيراد</th>
                                            <th className="p-3 text-center">متوسط البيع</th>
                                            <th className="p-3 text-center">متوسط التكلفة</th>
                                            <th className="p-3 text-center">هامش الربح</th>
                                            <th className="p-3 text-center">الربح (ج.م)</th>
                                            <th className="p-3 text-center">التفاصيل</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {familyAnalytics.map((fam, idx) => {
                                            const isExpanded = expandedFamily === fam.familyName;
                                            return (
                                                <>
                                                    <tr key={fam.familyName} className="hover:bg-indigo-50/30 transition-colors font-semibold">
                                                        <td className="p-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                                                        <td className="p-3 font-bold text-slate-800">
                                                            <div className="flex items-center gap-2">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shrink-0"></span>
                                                                <span>{fam.familyName}</span>
                                                                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{fam.services.length} خدمات</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-3 text-center text-slate-700 font-bold">{fam.totalCases}</td>
                                                        <td className="p-3 text-center font-bold">
                                                            <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md">{fam.totalUnits}</span>
                                                        </td>
                                                        <td className="p-3 text-center font-black text-slate-900 font-mono">{Math.round(fam.totalRevenue).toLocaleString()} ج.م</td>
                                                        <td className="p-3 text-center font-mono text-slate-600">{Math.round(fam.avgSalePrice).toLocaleString()} ج.م</td>
                                                        <td className="p-3 text-center font-mono text-rose-600">{Math.round(fam.avgCostPrice).toLocaleString()} ج.م</td>
                                                        <td className="p-3 text-center">
                                                            <span className={clsx(
                                                                'px-2 py-0.5 rounded-md font-bold text-[11px]',
                                                                fam.grossMargin >= 40 ? 'bg-emerald-100 text-emerald-800' : fam.grossMargin >= 20 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                                                            )}>
                                                                {fam.grossMargin.toFixed(1)}%
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-center font-black text-emerald-600 font-mono">
                                                            +{Math.round(fam.grossProfit).toLocaleString()} ج.م
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <button
                                                                onClick={() => setExpandedFamily(isExpanded ? null : fam.familyName)}
                                                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                                                            >
                                                                {isExpanded ? 'إخفاء ▲' : 'عرض الخدمات ▼'}
                                                            </button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded Sub-services */}
                                                    {isExpanded && (
                                                        <tr className="bg-slate-50/80 border-y border-indigo-100">
                                                            <td colSpan={10} className="p-3 pr-8">
                                                                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                                                                    <span className="text-xs font-bold text-slate-700 block">الخدمات التابعة لعائلة {fam.familyName}:</span>
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                                        {fam.services.map((subSvc) => (
                                                                            <div key={subSvc.serviceName} className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs flex justify-between items-center">
                                                                                <span className="font-bold text-slate-800">{subSvc.serviceName}</span>
                                                                                <div className="text-left font-mono">
                                                                                    <span className="text-slate-600 font-bold block">{subSvc.totalUnits} وحدة</span>
                                                                                    <span className="text-emerald-600 font-bold block">{Math.round(subSvc.totalRevenue).toLocaleString()} ج.م</span>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Services Table */}
                    {groupMode === 'service' && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <Package size={18} className="text-teal-600" />
                                مقارنة الخدمات
                                <span className="bg-teal-100 text-teal-700 py-0.5 px-2 rounded-full text-xs">{serviceAnalytics.length} خدمة</span>
                            </h3>
                            <button onClick={handleExportExcel}
                                className="bg-white border border-gray-200 text-gray-700 hover:bg-green-50 hover:text-green-700 hover:border-green-200 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">
                                <Download size={16} /> تصدير Excel
                            </button>
                        </div>

                        {serviceAnalytics.length === 0 ? (
                            <div className="p-16 text-center text-gray-400">
                                <Package size={40} className="mx-auto mb-3 opacity-30" />
                                <p className="font-medium">لا توجد بيانات للفترة المحددة</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-right">
                                    <thead className="bg-slate-800 text-white text-xs">
                                        <tr>
                                            <th className="p-3 font-semibold text-right w-8">#</th>
                                            <th className="p-3 font-semibold text-right">الخدمة</th>
                                            <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-700 whitespace-nowrap" onClick={() => toggleSort('cases')}>الحالات <SortIcon k="cases" /></th>
                                            <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-700 whitespace-nowrap" onClick={() => toggleSort('units')}>الوحدات <SortIcon k="units" /></th>
                                            <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-700 whitespace-nowrap" onClick={() => toggleSort('revenue')}>الإيراد <SortIcon k="revenue" /></th>
                                            <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-700 whitespace-nowrap" onClick={() => toggleSort('avgSalePrice')}>متوسط سعر البيع <SortIcon k="avgSalePrice" /></th>
                                            <th className="p-3 font-semibold text-center whitespace-nowrap">متوسط تكلفة الشراء</th>
                                            <th className="p-3 font-semibold text-center cursor-pointer hover:bg-slate-700 whitespace-nowrap" onClick={() => toggleSort('margin')}>هامش الربح <SortIcon k="margin" /></th>
                                            <th className="p-3 font-semibold text-center whitespace-nowrap">الربح (ج.م)</th>
                                            <th className="p-3 font-semibold text-center whitespace-nowrap">% الإيراد</th>
                                            <th className="p-3 font-semibold text-center whitespace-nowrap">أكثر طبيب</th>
                                            <th className="p-3 font-semibold text-center">تفاصيل</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {serviceAnalytics.map((svc, idx) => {
                                            const isExpanded = expandedService === svc.serviceName;
                                            const revenueShare = totalRevenue > 0 ? (svc.totalRevenue / totalRevenue) * 100 : 0;
                                            const isTop = idx === 0 && !serviceSortAsc;

                                            return (
                                                <>
                                                    <tr key={svc.serviceName} className={clsx("hover:bg-teal-50/30 transition-colors", isTop && "bg-amber-50/30")}>
                                                        <td className="p-3 text-gray-400 text-xs font-bold">
                                                            {isTop ? <Star size={14} className="text-amber-500 fill-amber-400" /> : idx + 1}
                                                        </td>
                                                        <td className="p-3">
                                                            <p className="font-bold text-slate-800 text-sm">{svc.serviceName}</p>
                                                        </td>
                                                        <td className="p-3 text-center font-bold text-slate-700">{svc.totalCases}</td>
                                                        <td className="p-3 text-center">
                                                            <span className="bg-teal-50 text-teal-700 font-bold px-2.5 py-1 rounded-lg text-sm">{svc.totalUnits}</span>
                                                        </td>
                                                        <td className="p-3 text-center font-black text-slate-800 text-sm">
                                                            {Math.round(svc.totalRevenue).toLocaleString()} <span className="text-[10px] font-normal text-gray-400">ج.م</span>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <span className="bg-blue-50 text-blue-700 font-bold px-2 py-1 rounded-lg text-sm">
                                                                {Math.round(svc.avgSalePrice).toLocaleString()} ج.م
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {svc.avgCostPrice > 0
                                                                ? <span className="bg-rose-50 text-rose-700 font-bold px-2 py-1 rounded-lg text-sm">{Math.round(svc.avgCostPrice).toLocaleString()} ج.م</span>
                                                                : <span className="text-gray-300 text-xs">—</span>}
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {svc.avgCostPrice > 0 ? (
                                                                <div className={clsx(
                                                                    "inline-flex flex-col items-center px-2.5 py-1.5 rounded-xl border font-bold text-sm",
                                                                    svc.grossMargin >= 40 ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                                                        : svc.grossMargin >= 20 ? "bg-blue-50 border-blue-200 text-blue-700"
                                                                            : svc.grossMargin >= 0 ? "bg-amber-50 border-amber-200 text-amber-700"
                                                                                : "bg-rose-50 border-rose-200 text-rose-700"
                                                                )}>
                                                                    <span>{svc.grossMargin.toFixed(1)}%</span>
                                                                    <span className="text-[9px] font-medium opacity-70">
                                                                        {svc.grossMargin >= 40 ? 'ممتاز' : svc.grossMargin >= 20 ? 'جيد' : svc.grossMargin >= 0 ? 'ضعيف' : 'خسارة'}
                                                                    </span>
                                                                </div>
                                                            ) : <span className="text-gray-300 text-xs">لا تكلفة</span>}
                                                        </td>
                                                        {/* Gross Profit (number) */}
                                                        <td className="p-3 text-center">
                                                            <span className={clsx(
                                                                "font-black text-sm",
                                                                svc.grossProfit > 0 ? "text-emerald-600" : svc.grossProfit < 0 ? "text-rose-600" : "text-gray-400"
                                                            )}>
                                                                {svc.grossProfit > 0 ? '+' : ''}{Math.round(svc.grossProfit).toLocaleString()} <span className="text-[10px] font-normal">ج.م</span>
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="font-bold text-slate-600 text-xs">{revenueShare.toFixed(1)}%</span>
                                                                <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-teal-500 rounded-full" style={{ width: `${revenueShare}%` }} />
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            {svc.topDoctor ? (
                                                                <div>
                                                                    <p className="font-bold text-slate-700 text-xs">{svc.topDoctor}</p>
                                                                    <p className="text-[10px] text-gray-400">{svc.topDoctorCases} حالة</p>
                                                                </div>
                                                            ) : <span className="text-gray-300 text-xs">—</span>}
                                                            {svc.rejectedCases > 0 ? (
                                                                <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                                                                    <span className={clsx(
                                                                        "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                                                                        svc.rejectionRate > 10 ? "bg-rose-100 text-rose-700" : "bg-amber-50 text-amber-600"
                                                                    )} title={`تكلفة الرفض: ${Math.round(svc.rejectedCost).toLocaleString()} ج.م`}>
                                                                        رفض {svc.rejectionRate.toFixed(1)}% ({svc.rejectedCases})
                                                                    </span>
                                                                </div>
                                                            ) : null}
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <button onClick={() => setExpandedService(isExpanded ? null : svc.serviceName)}
                                                                className={clsx("px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                                                                    isExpanded ? "bg-teal-600 text-white border-teal-600" : "bg-white border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600")}>
                                                                {isExpanded ? <ChevronUp size={13} className="inline" /> : <ChevronDown size={13} className="inline" />} تفصيل
                                                            </button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded detail rows */}
                                                    {isExpanded && (
                                                        <tr key={`exp-${svc.serviceName}`}>
                                                            <td colSpan={10} className="bg-slate-50 border-t-2 border-teal-200 p-0">
                                                                <div className="p-5">
                                                                    <p className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2">
                                                                        <FileText size={14} className="text-teal-600" />
                                                                        تفاصيل "{svc.serviceName}"
                                                                        <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{expandedItems.length} حركة</span>
                                                                    </p>
                                                                    <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
                                                                        <table className="w-full text-xs text-right">
                                                                            <thead className="bg-slate-700 text-white">
                                                                                <tr>
                                                                                    <th className="px-3 py-2.5 font-semibold">تاريخ الاستحقاق</th>
                                                                                    <th className="px-3 py-2.5 font-semibold">رقم الحالة</th>
                                                                                    <th className="px-3 py-2.5 font-semibold">الخدمة</th>
                                                                                    <th className="px-3 py-2.5 font-semibold">الطبيب</th>
                                                                                    <th className="px-3 py-2.5 font-semibold">المريض</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">الأسنان</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">الوحدات</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">سعر البيع/وحدة</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">تكلفة الشراء/وحدة</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">الإجمالي</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">حالة الطلب</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-gray-100">
                                                                                {expandedItems.length === 0
                                                                                    ? <tr><td colSpan={11} className="p-6 text-center text-gray-400">لا توجد بيانات</td></tr>
                                                                                    : expandedItems.map((item: any) => {
                                                                                        const priceColor = item.priceSource === 'actual' ? 'text-blue-600'
                                                                                            : item.priceSource === 'derived' ? 'text-teal-600'
                                                                                                : 'text-amber-500';
                                                                                        const priceLabel = item.priceSource === 'actual' ? null
                                                                                            : item.priceSource === 'derived' ? <span className="block text-[9px] text-teal-400">محسوب</span>
                                                                                                : <span className="block text-[9px] text-amber-400">تقديري</span>;
                                                                                        const statusBadge = getStatusBadgeStyle(item.status, item.issueState);
                                                                                        return (
                                                                                            <tr key={item.id} className="hover:bg-teal-50/20">
                                                                                                <td className="px-3 py-2.5 text-gray-500">{new Date(item.date).toLocaleDateString('ar-EG')}</td>
                                                                                                <td className="px-3 py-2.5 font-bold text-gray-700">#{item.caseId}</td>
                                                                                                <td className="px-3 py-2.5 font-bold text-slate-800">
                                                                                                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs border border-slate-200">{item.serviceType}</span>
                                                                                                </td>
                                                                                                <td className="px-3 py-2.5 text-gray-800 font-medium">{item.doctorName}</td>
                                                                                                <td className="px-3 py-2.5 text-gray-600">{item.patientName}</td>
                                                                                                <td className="px-3 py-2.5 text-center text-gray-400 max-w-[90px] truncate">{item.teeth}</td>
                                                                                                <td className="px-3 py-2.5 text-center font-bold text-teal-700">{item.count}</td>
                                                                                                <td className="px-3 py-2.5 text-center">
                                                                                                    <span className={clsx("font-medium", priceColor)}>
                                                                                                        {Math.round(item.unitPrice).toLocaleString()} ج.م
                                                                                                    </span>
                                                                                                    {priceLabel}
                                                                                                </td>
                                                                                                <td className="px-3 py-2.5 text-center">
                                                                                                    {item.costPerUnit > 0
                                                                                                        ? <span className="font-medium text-rose-500">{Math.round(item.costPerUnit).toLocaleString()} ج.م</span>
                                                                                                        : <span className="text-gray-300">—</span>
                                                                                                    }
                                                                                                </td>
                                                                                                <td className="px-3 py-2.5 text-center font-black text-slate-900">
                                                                                                    {Math.round(item.totalPrice).toLocaleString()} ج.م
                                                                                                    {priceLabel}
                                                                                                </td>
                                                                                                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                                                                                    <span className={clsx(
                                                                                                        "px-2.5 py-1 rounded-full text-[11px] font-extrabold border inline-block shadow-2xs",
                                                                                                        statusBadge.color
                                                                                                    )}>
                                                                                                        {statusBadge.label}
                                                                                                    </span>
                                                                                                </td>
                                                                                            </tr>
                                                                                        );
                                                                                    })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            );
                                        })}
                                    </tbody>

                                    {/* Footer totals */}
                                    <tfoot className="bg-slate-900 text-white text-sm">
                                        <tr>
                                            <td colSpan={2} className="p-4 font-bold">الإجمالي الكلي</td>
                                            <td className="p-4 text-center font-bold">—</td>
                                            <td className="p-4 text-center font-black text-teal-300">{totalUnits.toLocaleString()}</td>
                                            <td className="p-4 text-center font-black text-emerald-300">{Math.round(totalRevenue).toLocaleString()} ج.م</td>
                                            <td className="p-4 text-center font-bold text-blue-300">
                                                {totalUnits > 0 ? Math.round(totalRevenue / totalUnits).toLocaleString() : '—'} ج.م
                                            </td>
                                            <td className="p-4 text-center font-bold text-rose-300">
                                                {totalUnits > 0 ? Math.round(totalCost / totalUnits).toLocaleString() : '—'} ج.م
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={clsx("px-2.5 py-1 rounded-lg text-sm font-black",
                                                    overallMargin >= 20 ? "bg-emerald-500" : "bg-amber-500")}>
                                                    {overallMargin.toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">100%</td>
                                            <td colSpan={2} className="p-4"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                    )}

                    {/* Doctor × Service Matrix */}
                    {doctorServiceMatrix && doctorServiceMatrix.rows.length > 0 && doctorServiceMatrix.services.length > 0 && (
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
                                <Users size={18} className="text-teal-600" />
                                <h3 className="font-bold text-gray-800">مصفوفة الأطباء × الخدمات</h3>
                                <span className="text-xs text-gray-400">— عدد الوحدات لكل تقاطع</span>
                            </div>
                            <div className="overflow-x-auto p-4">
                                <table className="w-full text-sm text-right border-collapse">
                                    <thead>
                                        <tr className="text-xs">
                                            <th className="p-2 font-semibold text-slate-600 text-right border-b-2 border-slate-200 sticky right-0 bg-white">الطبيب</th>
                                            {doctorServiceMatrix.services.map(svc => (
                                                <th key={svc} className="p-2 font-semibold text-slate-600 text-center border-b-2 border-slate-200 min-w-[80px]">{svc}</th>
                                            ))}
                                            <th className="p-2 font-semibold text-slate-700 text-center border-b-2 border-slate-200 min-w-[100px]">إجمالي الإيراد</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {doctorServiceMatrix.rows.map(row => (
                                            <tr key={row.doctorId} className="hover:bg-teal-50/20 border-b border-gray-50">
                                                <td className="p-2 font-bold text-slate-700 text-xs sticky right-0 bg-white">{row.doctorName}</td>
                                                {row.cells.map((cellVal, ci) => {
                                                    const intensity = doctorServiceMatrix.maxCell > 0 ? cellVal / doctorServiceMatrix.maxCell : 0;
                                                    const colorClass = cellVal === 0
                                                        ? 'bg-gray-50 text-gray-300'
                                                        : intensity > 0.66 ? 'bg-teal-500 text-white font-bold'
                                                            : intensity > 0.33 ? 'bg-teal-200 text-teal-900 font-bold'
                                                                : 'bg-teal-50 text-teal-700';
                                                    return (
                                                        <td key={ci} className={clsx("p-2 text-center text-sm transition-all", colorClass)}>
                                                            {cellVal > 0 ? cellVal : '—'}
                                                        </td>
                                                    );
                                                })}
                                                <td className="p-2 text-center font-black text-emerald-700 text-sm">
                                                    {Math.round(row.totalRev).toLocaleString()} <span className="text-[10px] text-gray-400 font-normal">ج.م</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <p className="text-[10px] text-gray-400 mt-2 px-2">
                                    اللون الأغمق يدل على إقبال أعلى من الطبيب على الخدمة. أعلى 6 أطباء × أعلى 6 خدمات.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Best performing service insight */}
                    {serviceAnalytics.length > 1 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-4">
                                <div className="p-2.5 bg-amber-100 rounded-xl flex-shrink-0"><Star size={20} className="text-amber-600" /></div>
                                <div>
                                    <p className="font-bold text-amber-800 text-sm mb-1">🏆 أعلى إيراد</p>
                                    {(() => {
                                        const best = serviceAnalytics[0];
                                        return best ? (
                                            <>
                                                <p className="text-amber-900 font-black text-lg">{best.serviceName}</p>
                                                <p className="text-amber-700 text-sm">{Math.round(best.totalRevenue).toLocaleString()} ج.م · {best.totalUnits} وحدة · متوسط {Math.round(best.avgSalePrice).toLocaleString()} ج.م/وحدة</p>
                                            </>
                                        ) : null;
                                    })()}
                                </div>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-start gap-4">
                                <div className="p-2.5 bg-blue-100 rounded-xl flex-shrink-0"><Users size={20} className="text-blue-600" /></div>
                                <div>
                                    <p className="font-bold text-blue-800 text-sm mb-1">💡 أغلى خدمة (متوسط سعر)</p>
                                    {(() => {
                                        const mostExpensive = [...serviceAnalytics].sort((a, b) => b.avgSalePrice - a.avgSalePrice)[0];
                                        return mostExpensive ? (
                                            <>
                                                <p className="text-blue-900 font-black text-lg">{mostExpensive.serviceName}</p>
                                                <p className="text-blue-700 text-sm">متوسط {Math.round(mostExpensive.avgSalePrice).toLocaleString()} ج.م للوحدة</p>
                                            </>
                                        ) : null;
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ===== EXPENSE TAB ===== */}
            {targetType === 'expense' && (
                <>
                    {/* KPI Cards — same gradient-card language as the Overview tab */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-gradient-to-br from-rose-50 to-white p-5 rounded-2xl border border-rose-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all">
                            <div className="p-3 bg-rose-100 rounded-xl">
                                <TrendingDown size={22} className="text-rose-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-rose-600 text-xs font-bold mb-1">إجمالي المصروفات</p>
                                <p className="text-xl sm:text-2xl font-black text-rose-900 truncate">
                                    {Math.round(expenseData.totalAmount).toLocaleString()}
                                    <span className="text-xs font-normal text-rose-400 mr-1">ج.م</span>
                                </p>
                            </div>
                        </div>

                        {/* Expense vs. cash collections in the period */}
                        {(() => {
                            const ratio = totalIncomeForRatio > 0 ? (expenseData.totalAmount / totalIncomeForRatio) * 100 : 0;
                            const isHigh = ratio > 30;
                            return (
                                <div className={clsx(
                                    "p-5 rounded-2xl border shadow-sm flex items-center gap-4 hover:shadow-md transition-all",
                                    isHigh ? "bg-gradient-to-br from-rose-50 to-white border-rose-100" : "bg-gradient-to-br from-emerald-50 to-white border-emerald-100"
                                )}
                                    title="نسبة المصروفات إلى التحصيلات النقدية (مش المبيعات المحاسبية) خلال نفس الفترة">
                                    <div className={clsx("p-3 rounded-xl", isHigh ? "bg-rose-100" : "bg-emerald-100")}>
                                        <BarChart3 size={22} className={isHigh ? "text-rose-600" : "text-emerald-600"} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={clsx("text-xs font-bold mb-1", isHigh ? "text-rose-600" : "text-emerald-600")}>% من التحصيلات</p>
                                        <p className={clsx("text-xl sm:text-2xl font-black truncate", isHigh ? "text-rose-900" : "text-emerald-900")}>
                                            {totalIncomeForRatio > 0 ? `${ratio.toFixed(1)}%` : '—'}
                                        </p>
                                    </div>
                                </div>
                            );
                        })()}

                        <div className="bg-gradient-to-br from-slate-50 to-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all">
                            <div className="p-3 bg-slate-100 rounded-xl">
                                <FileText size={22} className="text-slate-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-slate-600 text-xs font-bold mb-1">عدد الحركات</p>
                                <p className="text-xl sm:text-2xl font-black text-slate-900">{expenseData.items.length}</p>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-amber-50 to-white p-5 rounded-2xl border border-amber-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all">
                            <div className="p-3 bg-amber-100 rounded-xl">
                                <BarChart3 size={22} className="text-amber-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-amber-600 text-xs font-bold mb-1">عدد الفئات</p>
                                <p className="text-xl sm:text-2xl font-black text-amber-900">{expenseCategoryStats.length}</p>
                            </div>
                        </div>
                    </div>

                    {/* Category Analytics Table */}
                    {expenseCategoryStats.length === 0 ? (
                        <div className="bg-white rounded-2xl p-12 text-center text-gray-400 border border-gray-100">
                            <FileText size={40} className="mx-auto mb-3 opacity-30" />
                            <p className="font-medium">لا توجد بيانات للفترة المحددة</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <BarChart3 size={16} className="text-rose-500" />
                                    تحليل المصروفات بالفئة
                                    <span className="bg-gray-200 text-gray-600 py-0.5 px-2 rounded-full text-xs">{expenseCategoryStats.length} فئة</span>
                                </h3>
                                <button onClick={handleExportExcel}
                                    className="bg-white border border-gray-200 text-gray-700 hover:bg-green-50 hover:text-green-700 hover:border-green-200 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all">
                                    <Download size={16} /> تصدير Excel
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-right">
                                    <thead className="bg-slate-800 text-white text-xs">
                                        <tr>
                                            <th className="p-3 font-semibold text-right w-8">#</th>
                                            <th className="p-3 font-semibold text-right">الفئة</th>
                                            <th className="p-3 font-semibold text-center">إجمالي المصروف</th>
                                            <th className="p-3 font-semibold text-center">% من الإجمالي</th>
                                            <th className="p-3 font-semibold text-center">عدد الحركات</th>
                                            <th className="p-3 font-semibold text-center">تفاصيل</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {expenseCategoryStats.map((cat: any, idx: number) => {
                                            const isExpanded = expandedExpenseCategory === cat.category;
                                            const isTop = idx === 0;
                                            return (
                                                <>
                                                    <tr key={cat.category} className={clsx("hover:bg-rose-50/20 transition-colors", isTop && "bg-rose-50/10")}>
                                                        <td className="p-3 text-gray-400 text-xs font-bold">
                                                            {isTop ? <Star size={14} className="text-rose-400 fill-rose-300" /> : idx + 1}
                                                        </td>
                                                        <td className="p-3">
                                                            <p className="font-bold text-slate-800 text-sm">{cat.category}</p>
                                                        </td>
                                                        <td className="p-3 text-center font-black text-rose-600">
                                                            {Math.round(cat.total).toLocaleString()} <span className="text-[10px] font-normal text-gray-400">ج.م</span>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="font-bold text-slate-700 text-xs">{cat.share.toFixed(1)}%</span>
                                                                <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-rose-400 rounded-full" style={{ width: `${cat.share}%` }} />
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <span className="bg-slate-50 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-sm">{cat.count}</span>
                                                        </td>
                                                        <td className="p-3 text-center">
                                                            <button onClick={() => setExpandedExpenseCategory(isExpanded ? null : cat.category)}
                                                                className={clsx("px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                                                                    isExpanded ? "bg-rose-600 text-white border-rose-600" : "bg-white border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600")}>
                                                                {isExpanded ? <ChevronUp size={13} className="inline" /> : <ChevronDown size={13} className="inline" />} تفصيل
                                                            </button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded detail rows for this category */}
                                                    {isExpanded && (
                                                        <tr key={`exp-${cat.category}`}>
                                                            <td colSpan={6} className="bg-slate-50 border-t-2 border-rose-200 p-0">
                                                                <div className="p-5">
                                                                    <p className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2">
                                                                        <FileText size={14} className="text-rose-500" />
                                                                        تفاصيل "{cat.category}"
                                                                        <span className="bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded-full">{cat.items.length} حركة</span>
                                                                    </p>
                                                                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                                                                        <table className="w-full text-xs text-right">
                                                                            <thead className="bg-slate-700 text-white">
                                                                                <tr>
                                                                                    <th className="px-3 py-2.5 font-semibold">التاريخ</th>
                                                                                    <th className="px-3 py-2.5 font-semibold">البيان</th>
                                                                                    <th className="px-3 py-2.5 font-semibold text-center">المبلغ</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-gray-100">
                                                                                {cat.items.map((item: any) => (
                                                                                    <tr key={item.id} className="hover:bg-rose-50/20">
                                                                                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                                                                                            <span className="block">{new Date(item.date).toLocaleDateString('ar-EG')}</span>
                                                                                            {item.transactionDate && item.transactionDate !== item.date && (
                                                                                                <span className="block text-[10px] text-gray-400 mt-0.5">
                                                                                                    تاريخ الدفع: {new Date(item.transactionDate).toLocaleDateString('ar-EG')}
                                                                                                </span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="px-3 py-2.5 text-gray-700">{item.description || '—'}</td>
                                                                                        <td className="px-3 py-2.5 text-center font-black text-rose-600">{item.amount.toLocaleString()} ج.م</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                            <tfoot className="bg-slate-100">
                                                                                <tr>
                                                                                    <td colSpan={2} className="px-3 py-2 font-bold text-slate-700">الإجمالي</td>
                                                                                    <td className="px-3 py-2 text-center font-black text-rose-700">{Math.round(cat.total).toLocaleString()} ج.م</td>
                                                                                </tr>
                                                                            </tfoot>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-900 text-white text-sm">
                                        <tr>
                                            <td colSpan={2} className="p-4 font-bold">الإجمالي الكلي</td>
                                            <td className="p-4 text-center font-black text-rose-300">{Math.round(expenseData.totalAmount).toLocaleString()} ج.م</td>
                                            <td className="p-4 text-center font-bold">100%</td>
                                            <td className="p-4 text-center font-bold text-slate-300">{expenseData.items.length} حركة</td>
                                            <td className="p-4"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Biggest spending category */}
                    {expenseCategoryStats.length > 1 && (
                        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex items-start gap-4">
                            <div className="p-2.5 bg-rose-100 rounded-xl flex-shrink-0"><TrendingDown size={20} className="text-rose-600" /></div>
                            <div>
                                <p className="font-bold text-rose-800 text-sm mb-1">أكبر فئة إنفاق</p>
                                <p className="text-rose-900 font-black text-lg">{expenseCategoryStats[0].category}</p>
                                <p className="text-rose-700 text-sm">
                                    {Math.round(expenseCategoryStats[0].total).toLocaleString()} ج.م
                                    · {expenseCategoryStats[0].share.toFixed(1)}% من الإجمالي
                                    · {expenseCategoryStats[0].count} حركة
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Non-operational payments (Suppliers + Designers) */}
                    {(nonOperationalPayments.supplierTotal > 0 || nonOperationalPayments.designerTotal > 0) && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                                <DollarSign size={18} className="text-slate-500" />
                                <h4 className="font-bold text-slate-700">المدفوعات للموردين والمصممين</h4>
                                <span className="text-xs text-slate-400">(غير تشغيلية — مستبعدة من الجدول أعلاه)</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">مدفوعات الموردين</p>
                                        <p className="text-xl font-black text-slate-800">{Math.round(nonOperationalPayments.supplierTotal).toLocaleString()} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
                                    </div>
                                    <span className="bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-xs">{nonOperationalPayments.supplierCount} حركة</span>
                                </div>
                                <div className="bg-gradient-to-br from-slate-50 to-white p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">مدفوعات المصممين</p>
                                        <p className="text-xl font-black text-slate-800">{Math.round(nonOperationalPayments.designerTotal).toLocaleString()} <span className="text-xs font-normal text-slate-400">ج.م</span></p>
                                    </div>
                                    <span className="bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-xs">{nonOperationalPayments.designerCount} حركة</span>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
