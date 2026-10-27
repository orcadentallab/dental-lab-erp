import type { Doctor, Order, Service, Transaction } from '../db';
import type { Adjustment } from '../financeService';
import type { AnalyticsSummary, TopDoctor, TopFamiliesResult, TopService } from '../supabase/analyticsService';
import { contributesProductiveUnits, getDoctorReceivableAmount, getLabCostAmount, getOfficialStatementDate, isClosedCaseInPeriod, isDoctorStatementIncluded, isNonProductiveOrder } from '../../constants/orderLifecycle';
import { normalizeExpenseCategory } from '../../constants/expenseCategories';
import { getDoctorServicePrice } from '../../lib/pricingUtils';
import { isDateInOpenRange } from '../../utils/dateRange';
import { isLedgerTransaction } from '../../utils/transactions';

export interface ReportIssue {
    id: string;
    orderId: string;
    type: string;
    cause: string;
    date: string;
    isVoided: boolean;
}

/** Complete datasets, shared by all months in a batch. Never pass a page of orders. */
export interface ReportDatasets {
    orders: Order[];
    transactions: Transaction[];
    doctors: Doctor[];
    services: Service[];
    adjustments: Adjustment[];
    issues: ReportIssue[];
}

export interface ReportPeriod { start?: string; end?: string }
export interface ServicePerformanceRow {
    name: string;
    cases: number;
    units: number;
    revenue: number;
    cost: number;
    profit: number;
    margin: number | null;
    share: number | null;
    topDoctor: string;
    isReconciliation?: boolean;
}

export function cairoToday(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function reportDay(value: string): string {
    if (!value) return '';
    // Date columns are already civil dates. Timestamps must use the report timezone.
    return value.includes('T') ? cairoToday(new Date(value)) : value.slice(0, 10);
}

/** Only full calendar months get a "previous month" comparison. */
export function previousCalendarMonth(period: ReportPeriod): Required<ReportPeriod> | null {
    if (!period.start || !period.end || !/^\d{4}-\d{2}-01$/.test(period.start)) return null;
    const [year, month] = period.start.split('-').map(Number);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (end !== period.end) return null;
    return {
        start: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
        end: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10)
    };
}

export function percentage(numerator: number, denominator: number): number | null {
    return denominator > 0 ? numerator / denominator * 100 : null;
}

export function comparisonChange(current: number, previous: number): number | null {
    return previous !== 0 ? (current - previous) / Math.abs(previous) * 100 : current === 0 ? 0 : null;
}

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/**
 * Reconstructed closing receivables: no cash or adjustments after period.end.
 * Uses today's recorded order settlement amounts, not an immutable past close.
 * Dated debits (including charges) consume credits in FIFO order; advances stay separate.
 */
export function closingReceivables(data: ReportDatasets, period: ReportPeriod) {
    const cutoff = period.end || cairoToday();
    const doctors = new Map(data.doctors.map(doctor => [doctor.id, doctor]));
    const billingId = (id: string) => doctors.get(id)?.parentId || id;
    const accounts = new Map<string, { credits: number; debits: { date: string; key: string; amount: number; periodSale: boolean }[] }>();
    const account = (id: string) => {
        const key = billingId(id);
        if (!accounts.has(key)) accounts.set(key, { credits: 0, debits: [] });
        return accounts.get(key)!;
    };
    for (const order of data.orders) {
        if (!isDoctorStatementIncluded(order)) continue;
        const date = getOfficialStatementDate(order);
        if (!isDateInOpenRange(date, { end: cutoff })) continue;
        const amount = getDoctorReceivableAmount(order);
        if (amount > 0) account(order.doctorId).debits.push({ date, key: `${order.createdAt}_${order.id}`, amount, periodSale: isDateInOpenRange(date, period) });
    }
    for (const tx of data.transactions) {
        if (tx.type !== 'income' || !tx.entityId || (tx.entityType && tx.entityType !== 'doctor')) continue;
        if (tx.status === 'rejected' || tx.isSystemGeneratedFee || !isLedgerTransaction(tx)) continue;
        if (!isDateInOpenRange(tx.date, { end: cutoff })) continue;
        const target = account(tx.entityId);
        if (tx.amount < 0) target.debits.push({ date: tx.date.slice(0, 10), key: tx.id, amount: -tx.amount, periodSale: false });
        else target.credits += tx.amount;
    }
    for (const adjustment of data.adjustments) {
        if (adjustment.entity_type !== 'doctor' || !isDateInOpenRange(adjustment.date, { end: cutoff })) continue;
        const target = account(adjustment.entity_id);
        if (adjustment.type === 'credit') target.credits += adjustment.amount;
        else target.debits.push({ date: adjustment.date, key: adjustment.id, amount: adjustment.amount, periodSale: false });
    }
    const result = { cutoff, total: 0, periodUnpaid: 0, aging90: 0, advances: 0, aging: [0, 0, 0, 0] };
    for (const target of accounts.values()) {
        let available = target.credits;
        target.debits.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
        for (const debit of target.debits) {
            const applied = Math.min(debit.amount, Math.max(0, available));
            available -= applied;
            const remaining = debit.amount - applied;
            const days = Math.floor((Date.parse(cutoff) - Date.parse(debit.date)) / 86_400_000);
            const bucket = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
            result.aging[bucket] += remaining;
            result.total += remaining;
            if (debit.periodSale) result.periodUnpaid += remaining;
            if (days > 90) result.aging90 += remaining;
        }
        // Negative cash movements increase debt; do not quietly drop them.
        if (available < 0) {
            result.total -= available;
            result.aging[0] -= available;
        } else result.advances += available;
    }
    return { ...result, total: roundMoney(result.total), periodUnpaid: roundMoney(result.periodUnpaid), aging90: roundMoney(result.aging90), advances: roundMoney(result.advances), aging: result.aging.map(roundMoney) };
}

export function buildPeriodDetails(data: ReportDatasets, period: ReportPeriod, summary: AnalyticsSummary) {
    const orders = data.orders.filter(order => isDoctorStatementIncluded(order) && isDateInOpenRange(getOfficialStatementDate(order), period));
    const closed = orders.filter(isClosedCaseInPeriod);
    const closedIds = new Set(closed.map(order => order.id));
    const validOrderIds = new Set(data.orders.filter(order => !order.isDeleted).map(order => order.id));
    const issues = data.issues.filter(issue => !issue.isVoided && validOrderIds.has(issue.orderId) && isDateInOpenRange(issue.date, period));
    const affected = new Set(issues.map(issue => issue.orderId));
    const closedAffected = new Set(issues.filter(issue => closedIds.has(issue.orderId)).map(issue => issue.orderId));
    const rejectionIds = new Set(issues.filter(issue => ['doctor_rejected', 'rejected', 'redo'].includes(issue.type) && closedIds.has(issue.orderId)).map(issue => issue.orderId));
    const issueTypes = new Map<string, number>();
    const issueCauses = new Map<string, number>();
    for (const issue of issues) {
        issueTypes.set(issue.type, (issueTypes.get(issue.type) || 0) + 1);
        issueCauses.set(issue.cause, (issueCauses.get(issue.cause) || 0) + 1);
    }

    const serviceMap = new Map<string, { cases: Set<string>; units: number; revenue: number; cost: number; doctors: Map<string, number> }>();
    const doctorById = new Map(data.doctors.map(doctor => [doctor.id, doctor]));
    const serviceByName = new Map(data.services.map(service => [service.name, service]));
    let units = 0;
    let manualOrders = 0;
    for (const order of orders) {
        const productive = contributesProductiveUnits(order);
        const items = order.items || [];
        const doctor = doctorById.get(order.doctorId);
        const weights = items.map(item => {
            const count = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;
            return Math.max(0, item.price || getDoctorServicePrice(item.serviceType, serviceByName.get(item.serviceType), doctor, data.doctors)) * count;
        });
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        const fallbackTotal = items.reduce((sum, item) => sum + (Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1), 0);
        const revenue = getDoctorReceivableAmount(order);
        const cost = getLabCostAmount(order);
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const count = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;
            if (productive) units += count;
            if (!productive && revenue === 0 && cost === 0) continue;
            const name = item.serviceType || 'خدمة غير محددة';
            if (!serviceMap.has(name)) serviceMap.set(name, { cases: new Set(), units: 0, revenue: 0, cost: 0, doctors: new Map() });
            const row = serviceMap.get(name)!;
            const proportion = totalWeight > 0 ? weights[index] / totalWeight : fallbackTotal > 0 ? count / fallbackTotal : items.length > 0 ? 1 / items.length : 0;
            const itemRevenue = revenue * proportion;
            row.cases.add(order.id);
            row.units += productive ? count : 0;
            row.revenue += itemRevenue;
            row.cost += cost * proportion;
            const doctorName = doctor?.name || 'غير محدد';
            row.doctors.set(doctorName, (row.doctors.get(doctorName) || 0) + itemRevenue);
        }
        if (!isNonProductiveOrder(order) && (order.manualCost != null || order.manualDesignPrice != null || order.discount > 0 || items.some(item => {
            const price = getDoctorServicePrice(item.serviceType, serviceByName.get(item.serviceType), doctor, data.doctors);
            return item.price > 0 && price > 0 && Math.abs(item.price - price) > 0.01;
        }))) manualOrders++;
    }
    const services: ServicePerformanceRow[] = Array.from(serviceMap, ([name, row]) => ({
        name, cases: row.cases.size, units: row.units, revenue: row.revenue, cost: row.cost, profit: row.revenue - row.cost,
        margin: percentage(row.revenue - row.cost, row.revenue), share: percentage(row.revenue, summary.total_sales_value),
        topDoctor: [...row.doctors].sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
    })).sort((a, b) => b.revenue - a.revenue);
    const allocatedRevenue = services.reduce((sum, row) => sum + row.revenue, 0);
    const allocatedCost = services.reduce((sum, row) => sum + row.cost, 0);
    const revenueDifference = roundMoney(summary.total_sales_value - allocatedRevenue);
    const costDifference = roundMoney(summary.total_cost_of_goods - allocatedCost);
    if (Math.abs(revenueDifference) >= 0.01 || Math.abs(costDifference) >= 0.01) {
        services.push({ name: 'غير موزع / فرق نطاق التسوية', cases: 0, units: 0, revenue: revenueDifference, cost: costDifference, profit: revenueDifference - costDifference, margin: percentage(revenueDifference - costDifference, revenueDifference), share: percentage(revenueDifference, summary.total_sales_value), topDoctor: '-', isReconciliation: true });
    }

    const expenses = data.transactions.filter(tx => tx.type === 'expense' && isLedgerTransaction(tx) && !['supplier', 'designer', 'representative'].includes(tx.entityType || '') && !['supplier_payment', 'designer_payment'].includes(tx.category || '') && tx.amount > 0 && tx.status !== 'rejected' && !(tx.category || '').startsWith('#') && isDateInOpenRange(tx.effectiveDate || tx.date, period));
    const expenseMap = new Map<string, { amount: number; count: number }>();
    for (const tx of expenses) {
        const category = normalizeExpenseCategory(tx.category);
        const row = expenseMap.get(category) || { amount: 0, count: 0 };
        row.amount += tx.amount;
        row.count++;
        expenseMap.set(category, row);
    }
    const expenseRows = [...expenseMap].map(([category, row]) => ({ category, ...row })).sort((a, b) => b.amount - a.amount);
    const expenseTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
    return {
        closedCases: closed.length, units, manualOrders, services, serviceCount: serviceMap.size,
        revenueDifference, costDifference,
        expenses: expenseRows, expenseCount: expenses.length, expenseTotal,
        expenseDifference: roundMoney(summary.operating_expenses - expenseTotal),
        issues: { events: issues.length, affectedCases: affected.size, closedAffectedCases: closedAffected.size, rejectionCases: rejectionIds.size, rate: percentage(closedAffected.size, closed.length), rejectionRate: percentage(rejectionIds.size, closed.length), byType: [...issueTypes], byCause: [...issueCauses] },
        closing: closingReceivables(data, period)
    };
}

export interface MonthlyReportModel {
    period: ReportPeriod;
    label: string;
    generatedAt: string;
    summary: AnalyticsSummary;
    details: ReturnType<typeof buildPeriodDetails>;
    topDoctors: TopDoctor[];
    topServices: TopService[];
    families: TopFamiliesResult;
    previous: { period: Required<ReportPeriod>; summary: AnalyticsSummary; details: ReturnType<typeof buildPeriodDetails> } | null;
    previewNotice?: string;
}
