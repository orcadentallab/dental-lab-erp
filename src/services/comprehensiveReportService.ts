/* eslint-disable @typescript-eslint/no-explicit-any */
import { htmlToPdfPage, createPdf } from './pdfService';
import type { LabInfo } from '../utils/finance';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import { analyticsService } from './supabase/analyticsService';
import {
    db,
    type Order,
    type Transaction,
    type Doctor,
    type Supplier,
    type Service
} from './db';
import {
    isDoctorStatementIncluded,
    getDoctorReceivableAmount,
    getLabCostAmount,
    getOfficialStatementDate
} from '../constants/orderLifecycle';
import { isDateInOpenRange } from '../utils/dateRange';
import { getDoctorServicePrice } from '../lib/pricingUtils';
import { normalizeExpenseCategory } from '../constants/expenseCategories';
import { isLedgerTransaction } from '../utils/transactions';

export interface ComprehensiveReportInput {
    startDate?: string;
    endDate?: string;
    dateRangeLabel: string;
    labInfo?: LabInfo;
    // Optional pre-fetched datasets from Analytics page
    preloadedOrders?: Order[];
    preloadedTransactions?: Transaction[];
    preloadedDoctors?: Doctor[];
    preloadedSuppliers?: Supplier[];
    preloadedServices?: Service[];
}

const fmt = (num: number | null | undefined, decimals = 0): string => {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return Number(num).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};

const fmtPct = (num: number | null | undefined): string => {
    if (num === null || num === undefined || isNaN(num)) return '0.0%';
    return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`;
};

export async function generateComprehensiveAnalyticsPDF(input: ComprehensiveReportInput): Promise<void> {
    const {
        startDate,
        endDate,
        dateRangeLabel,
        labInfo = DEFAULT_LAB_INFO
    } = input;

    const rpcStart = startDate || undefined;
    const rpcEnd = endDate || undefined;

    // 1. Parallel fetch server-side aggregates & detailed data if needed
    const [
        summary,
        topDoctors,
        topServices,
        allServicesData,
        topExpenseCategories,
        issues,
        topFamiliesData,
        orders,
        transactions,
        doctors,
        services
    ] = await Promise.all([
        analyticsService.getSummary(rpcStart, rpcEnd),
        analyticsService.getTopDoctors(rpcStart, rpcEnd),
        analyticsService.getTopServices(rpcStart, rpcEnd, 5),
        analyticsService.getTopServices(rpcStart, rpcEnd, 5000),
        analyticsService.getTopExpenseCategories(rpcStart, rpcEnd, 100),
        analyticsService.getIssuesSummary(rpcStart, rpcEnd),
        analyticsService.getTopFamilies(rpcStart, rpcEnd, 10),
        input.preloadedOrders && input.preloadedOrders.length > 0 ? Promise.resolve(input.preloadedOrders) : db.getAllOrdersUnpaginated(),
        input.preloadedTransactions && input.preloadedTransactions.length > 0 ? Promise.resolve(input.preloadedTransactions) : db.getTransactions(),
        input.preloadedDoctors && input.preloadedDoctors.length > 0 ? Promise.resolve(input.preloadedDoctors) : db.getDoctors(),
        input.preloadedServices && input.preloadedServices.length > 0 ? Promise.resolve(input.preloadedServices) : db.getServices()
    ]);

    // Derived Financial & Overview KPIs
    const deliveredRevenue = summary.total_sales_value;
    const productionCost = summary.total_cost_of_goods;
    const grossProfit = deliveredRevenue - productionCost;
    const grossMargin = deliveredRevenue > 0 ? (grossProfit / deliveredRevenue) * 100 : 0;
    const operatingExpenses = summary.operating_expenses;
    const netProfit = grossProfit - operatingExpenses;
    const netMargin = deliveredRevenue > 0 ? (netProfit / deliveredRevenue) * 100 : 0;
    const opexRatio = deliveredRevenue > 0 ? (operatingExpenses / deliveredRevenue) * 100 : 0;

    // Unit & Case Metrics
    const totalUnits = allServicesData.reduce((sum, s) => sum + Number(s.count || 0), 0);
    const avgUnitPrice = totalUnits > 0 ? deliveredRevenue / totalUnits : 0;

    // Filter orders for the selected period
    const filteredOrders = orders.filter(o => {
        if (!isDoctorStatementIncluded(o)) return false;
        const orderDate = getOfficialStatementDate(o);
        return isDateInOpenRange(orderDate, { start: startDate || '', end: endDate || '' });
    });

    const totalPeriodOrders = filteredOrders.length;

    // Count manual orders in period
    let manualOrdersCount = 0;
    filteredOrders.forEach(o => {
        const items = o.items || [];
        const doctor = doctors.find(d => d.id === o.doctorId);
        const hasManualCost = o.manualCost !== null && o.manualCost !== undefined;
        const hasManualDesignPrice = o.manualDesignPrice !== null && o.manualDesignPrice !== undefined;
        const hasDiscount = Boolean(o.discount && o.discount > 0);
        const hasItemPriceOverride = items.some(it => {
            if (!it.price || it.price <= 0) return false;
            const sv = services.find(s => s.name === it.serviceType);
            const catalogPrice = getDoctorServicePrice(it.serviceType, sv, doctor, doctors);
            return catalogPrice > 0 && Math.abs(it.price - catalogPrice) > 0.01;
        });
        if (hasDiscount || hasItemPriceOverride || hasManualCost || hasManualDesignPrice) {
            manualOrdersCount++;
        }
    });

    const manualOrdersRatio = totalPeriodOrders > 0 ? (manualOrdersCount / totalPeriodOrders) * 100 : 0;

    // Issues & Returns Metrics
    const doctorRejectedCount = issues.by_type?.doctor_rejected ?? 0;
    const labRejectedCount = issues.by_type?.lab_rejected ?? 0;
    const returnedCount = issues.by_type?.returned ?? 0;
    const redoCount = issues.by_type?.redo ?? 0;
    const cancelledCount = issues.by_type?.cancelled ?? 0;
    const totalProblemOrders = issues.distinct_orders_with_issues ?? 0;
    const problemRate = totalPeriodOrders > 0 ? (totalProblemOrders / totalPeriodOrders) * 100 : 0;
    const returnRejectionCount = doctorRejectedCount + redoCount;
    const returnRate = totalPeriodOrders > 0 ? (returnRejectionCount / totalPeriodOrders) * 100 : 0;

    // Cash Flow & P&L
    const cashCollections = summary.cash_total_income;
    const cashPayments = summary.cash_total_expenses;
    const cashNetFlow = cashCollections - cashPayments;

    const collectionPerformance = deliveredRevenue > 0 ? (cashCollections / deliveredRevenue) * 100 : 0;

    // Top Expense Category
    const topExpense = topExpenseCategories[0];

    // Build Detailed Services Performance Table
    const serviceMap = new Map<string, {
        cases: Set<string>;
        units: number;
        revenue: number;
        cost: number;
        doctorStats: Map<string, { rev: number; count: number }>;
    }>();

    filteredOrders.forEach(o => {
        const items = o.items as any[];
        if (!items || items.length === 0) return;
        const orderDoctor = doctors.find(d => d.id === o.doctorId);
        const effectiveTotalPrice = getDoctorReceivableAmount(o);
        const effectiveCost = getLabCostAmount(o);

        const itemWeights: number[] = items.map((it: any) => {
            const cnt = Array.isArray(it.teethNumbers) ? it.teethNumbers.length : 1;
            if (it.price > 0) return it.price * cnt;
            const sv = services.find(s => s.name === it.serviceType as string);
            const catalogUnitPrice = getDoctorServicePrice(it.serviceType as string, sv, orderDoctor, doctors);
            return catalogUnitPrice > 0 ? catalogUnitPrice * cnt : cnt;
        });
        const totalWeight = itemWeights.reduce((s, w) => s + w, 0);

        items.forEach((item: any, idx: number) => {
            const svcName = item.serviceType as string;
            if (!svcName) return;
            const count = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;
            const itemRevenue = totalWeight > 0 ? (effectiveTotalPrice * itemWeights[idx]) / totalWeight : 0;
            const itemCost = totalWeight > 0 ? (effectiveCost * itemWeights[idx]) / totalWeight : 0;

            if (!serviceMap.has(svcName)) {
                serviceMap.set(svcName, { cases: new Set(), units: 0, revenue: 0, cost: 0, doctorStats: new Map() });
            }
            const entry = serviceMap.get(svcName)!;
            if (o.id) entry.cases.add(o.id);
            entry.units += count;
            entry.revenue += itemRevenue;
            entry.cost += itemCost;

            const drName = orderDoctor?.name || 'غير معروف';
            if (!entry.doctorStats.has(drName)) entry.doctorStats.set(drName, { rev: 0, count: 0 });
            const drEntry = entry.doctorStats.get(drName)!;
            drEntry.rev += itemRevenue;
            drEntry.count += count;
        });
    });

    const detailedServices = Array.from(serviceMap.entries()).map(([svcName, data]) => {
        let topDoctorName = '-';
        let maxDrRev = 0;
        data.doctorStats.forEach((d, name) => {
            if (d.rev > maxDrRev) {
                maxDrRev = d.rev;
                topDoctorName = name;
            }
        });
        const svcProfit = data.revenue - data.cost;
        const svcMargin = data.revenue > 0 ? (svcProfit / data.revenue) * 100 : 0;
        const shareOfRevenue = deliveredRevenue > 0 ? (data.revenue / deliveredRevenue) * 100 : 0;

        return {
            name: svcName,
            cases: data.cases.size,
            units: data.units,
            revenue: data.revenue,
            cost: data.cost,
            profit: svcProfit,
            margin: svcMargin,
            share: shareOfRevenue,
            topDoctor: topDoctorName
        };
    }).sort((a, b) => b.revenue - a.revenue);

    // Build Detailed Expenses Table
    const filteredExpenseTxs = transactions.filter(t => {
        if (t.type !== 'expense') return false;
        if (!isLedgerTransaction(t)) return false;
        if (t.entityType === 'supplier' || t.entityType === 'designer' || t.entityType === 'representative') return false;
        if (['supplier_payment', 'designer_payment'].includes(t.category || '')) return false;
        if (!t.amount || t.amount <= 0) return false;
        if ((t as any).status === 'rejected') return false;
        if ((t.category || '').startsWith('#')) return false;
        const txDate = ((t as any).effectiveDate || t.date || '').split('T')[0];
        return isDateInOpenRange(txDate, { start: startDate || '', end: endDate || '' });
    });

    const expMap = new Map<string, { total: number; count: number }>();
    let totalDetailedExpenses = 0;
    filteredExpenseTxs.forEach(t => {
        const cat = normalizeExpenseCategory(t.category);
        if (!expMap.has(cat)) expMap.set(cat, { total: 0, count: 0 });
        const entry = expMap.get(cat)!;
        entry.total += (t.amount || 0);
        entry.count++;
        totalDetailedExpenses += (t.amount || 0);
    });

    const detailedExpenses = Array.from(expMap.entries()).map(([cat, d]) => ({
        category: cat,
        total: d.total,
        count: d.count,
        share: totalDetailedExpenses > 0 ? (d.total / totalDetailedExpenses) * 100 : 0
    })).sort((a, b) => b.total - a.total);

    // Top Service Families
    const displayFamilies = topFamiliesData.families.slice(0, 5);

    // Generate Report HTML with strict RTL shaping & unbroken containers
    const reportHtml = `
    <div class="doc">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                letter-spacing: normal !important;
                font-variant-ligatures: normal !important;
                text-rendering: optimizeLegibility !important;
            }
            .doc {
                direction: rtl;
                font-family: 'Cairo', 'Tahoma', 'Arial', sans-serif;
                color: #0f172a;
                background: #ffffff;
                font-size: 10px;
                line-height: 1.4;
                width: 794px;
                padding-bottom: 15px;
            }

            /* ===== HEADER ===== */
            .header-bar {
                background: #0f172a;
                color: #ffffff;
                padding: 20px 28px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 4px solid #0284c7;
                position: relative;
            }
            .header-right {
                display: flex;
                flex-direction: column;
                gap: 4px;
                text-align: right;
                direction: rtl;
            }
            .report-main-title {
                font-size: 20px;
                font-weight: 800;
                color: #ffffff;
                line-height: 1.2;
            }
            .report-subtitle {
                font-size: 10.5px;
                color: #94a3b8;
                font-weight: 600;
            }
            .header-left {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 4px;
            }
            .lab-badge {
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(255, 255, 255, 0.08);
                padding: 6px 12px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.12);
            }
            .lab-logo { height: 34px; width: auto; object-fit: contain; }
            .lab-name-text { font-size: 13px; font-weight: 800; color: #38bdf8; }
            .lab-contact-text { font-size: 8.5px; color: #cbd5e1; font-weight: 600; }

            .period-banner {
                background: #f0fdf4;
                border: 1px solid #bbf7d0;
                color: #166534;
                padding: 6px 14px;
                border-radius: 6px;
                font-weight: 700;
                font-size: 11px;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-top: 5px;
            }

            /* ===== BODY CONTAINER ===== */
            .content-body { padding: 18px 28px; display: flex; flex-direction: column; gap: 16px; }

            /* ===== SECTION HEADINGS ===== */
            .section-title {
                font-size: 12px;
                font-weight: 800;
                color: #0f172a;
                display: flex;
                align-items: center;
                gap: 6px;
                padding-bottom: 4px;
                border-bottom: 2px solid #e2e8f0;
                margin-bottom: 8px;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .section-title .pill {
                width: 4px;
                height: 14px;
                background: #0284c7;
                border-radius: 2px;
                display: inline-block;
            }

            .report-section {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .unbroken-block {
                page-break-inside: avoid;
                break-inside: avoid;
            }

            /* ===== KPI GRIDS ===== */
            .kpi-grid-4 {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .kpi-grid-3 {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .kpi-grid-2 {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                page-break-inside: avoid;
                break-inside: avoid;
            }

            .kpi-card-pdf {
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 8px 10px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                position: relative;
                overflow: hidden;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .kpi-card-pdf.blue { border-top: 3px solid #2563eb; background: #f8fafc; }
            .kpi-card-pdf.emerald { border-top: 3px solid #10b981; background: #f0fdf4; }
            .kpi-card-pdf.rose { border-top: 3px solid #f43f5e; background: #fff1f2; }
            .kpi-card-pdf.amber { border-top: 3px solid #f59e0b; background: #fffbeb; }
            .kpi-card-pdf.purple { border-top: 3px solid #8b5cf6; background: #faf5ff; }

            .kpi-top-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2px; }
            .kpi-label { font-size: 9.5px; font-weight: 700; color: #475569; }
            .kpi-badge {
                font-size: 8.5px;
                font-weight: 800;
                padding: 1px 5px;
                border-radius: 4px;
            }
            .kpi-badge.positive { background: #dcfce7; color: #15803d; }
            .kpi-badge.negative { background: #ffe4e6; color: #be123c; }
            .kpi-badge.neutral { background: #e0f2fe; color: #0369a1; }

            .kpi-val {
                font-size: 15px;
                font-weight: 800;
                color: #0f172a;
                font-family: 'Cairo', sans-serif;
                margin: 2px 0;
            }
            .kpi-unit { font-size: 9px; font-weight: 600; color: #64748b; margin-right: 2px; }
            .kpi-sub { font-size: 8px; color: #64748b; font-weight: 600; }

            /* ===== TABLES ===== */
            table.pdf-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 9px;
                margin-top: 2px;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            table.pdf-table th {
                background: #1e293b;
                color: #ffffff;
                padding: 6px 8px;
                font-weight: 700;
                text-align: right;
                font-size: 8.5px;
                border: 1px solid #1e293b;
            }
            table.pdf-table th.center, table.pdf-table td.center { text-align: center; }
            table.pdf-table th.num, table.pdf-table td.num { text-align: left; direction: ltr; font-family: 'Courier New', monospace; font-weight: 700; }
            table.pdf-table td {
                padding: 5px 8px;
                border: 1px solid #e2e8f0;
                color: #334155;
                font-size: 9px;
            }
            table.pdf-table tr:nth-child(even) td { background: #f8fafc; }
            table.pdf-table tr.total-row td {
                background: #f1f5f9;
                font-weight: 800;
                color: #0f172a;
                border-top: 2px solid #cbd5e1;
            }

            /* ===== P&L & CASH FLOW BLOCKS ===== */
            .finance-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 5px 8px;
                border-bottom: 1px dashed #e2e8f0;
                font-size: 9.5px;
            }
            .finance-row.bold {
                font-weight: 800;
                background: #f8fafc;
                border-bottom: 1px solid #cbd5e1;
            }
            .finance-row.grand {
                font-weight: 800;
                font-size: 10.5px;
                border-bottom: none;
                border-radius: 6px;
                margin-top: 4px;
                padding: 7px 8px;
            }
            .finance-val {
                font-family: 'Courier New', monospace;
                direction: ltr;
                font-weight: 800;
            }

            /* ===== FOOTER ===== */
            .doc-footer {
                background: #0f172a;
                color: #94a3b8;
                padding: 8px 28px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 8px;
                font-weight: 600;
                width: 794px;
                border-top: 2px solid #0284c7;
            }
        </style>

        <!-- ===== HEADER ===== -->
        <div class="header-bar">
            <div class="header-right">
                <div class="report-main-title">التقرير الشامل للأداء المالي والتشغيلي</div>
                <div class="report-subtitle">متابعة تحليلية شاملة ومطابقة لكافة العمليات والتدفقات المالية والمبيعات</div>
                <div class="period-banner">
                    📅 فترة التقرير: <strong>${dateRangeLabel}</strong>
                    ${startDate && endDate ? `<span style="font-family:'Courier New',monospace; font-size:10px; margin-right:4px">(${startDate} → ${endDate})</span>` : ''}
                </div>
            </div>
            <div class="header-left">
                <div class="lab-badge">
                    <img src="${window.location.origin}/orca-logo.png" class="lab-logo" alt="Logo" onerror="this.style.display='none'" />
                    <div>
                        <div class="lab-name-text">${labInfo.name}</div>
                        <div class="lab-contact-text">${labInfo.address} · ${labInfo.phone}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ===== CONTENT ===== -->
        <div class="content-body">

            <!-- 1. ملخص مؤشرات الأداء العامة (Overview KPIs) -->
            <div class="report-section unbroken-block" data-avoid-break="true">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>1. المؤشرات المالية والتشغيلية الرئيسية (Overview KPIs)</span>
                </div>
                <div class="kpi-grid-4">
                    <div class="kpi-card-pdf blue">
                        <div class="kpi-top-row">
                            <span class="kpi-label">المبيعات المسلمة</span>
                            <span class="kpi-badge neutral">${fmt(avgUnitPrice)} ج.م/وحدة</span>
                        </div>
                        <div class="kpi-val">${fmt(deliveredRevenue)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">قيمة الأعمال المسلمة رسمياً للفترة</div>
                    </div>

                    <div class="kpi-card-pdf emerald">
                        <div class="kpi-top-row">
                            <span class="kpi-label">مجمل الربح</span>
                            <span class="kpi-badge positive">${fmtPct(grossMargin)} هامش</span>
                        </div>
                        <div class="kpi-val">${fmt(grossProfit)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">المبيعات - تكلفة الإنتاج الكلية</div>
                    </div>

                    <div class="kpi-card-pdf rose">
                        <div class="kpi-top-row">
                            <span class="kpi-label">مصروفات التشغيل</span>
                            <span class="kpi-badge negative">${fmtPct(-opexRatio)} من المبيعات</span>
                        </div>
                        <div class="kpi-val">${fmt(operatingExpenses)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">إيجار، مرتبات، شحن، نثريات...</div>
                    </div>

                    <div class="kpi-card-pdf ${netProfit >= 0 ? 'emerald' : 'rose'}">
                        <div class="kpi-top-row">
                            <span class="kpi-label">صافي الربح التشغيلي</span>
                            <span class="kpi-badge ${netProfit >= 0 ? 'positive' : 'negative'}">${fmtPct(netMargin)} صافي</span>
                        </div>
                        <div class="kpi-val" style="color: ${netProfit >= 0 ? '#15803d' : '#be123c'}">${fmt(netProfit)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">مجمل الربح - مصروفات التشغيل</div>
                    </div>

                    <div class="kpi-card-pdf amber">
                        <div class="kpi-top-row">
                            <span class="kpi-label">إيراد معلق</span>
                        </div>
                        <div class="kpi-val">${fmt(summary.pending_revenue_period)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">غير محصل من مبيعات هذه الفترة</div>
                    </div>

                    <div class="kpi-card-pdf purple">
                        <div class="kpi-top-row">
                            <span class="kpi-label">مدفوعات الموردين والمصممين</span>
                        </div>
                        <div class="kpi-val">${fmt(summary.supplier_payments + summary.designer_payments)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">مدفوعات فعلية خلال الفترة</div>
                    </div>

                    <div class="kpi-card-pdf amber">
                        <div class="kpi-top-row">
                            <span class="kpi-label">حالات بمشاكل</span>
                            <span class="kpi-badge negative">${fmtPct(problemRate)}</span>
                        </div>
                        <div class="kpi-val">${totalProblemOrders} <span class="kpi-unit">حالة</span></div>
                        <div class="kpi-sub">${redoCount} إعادة · ${doctorRejectedCount} رفض دكتور · ${labRejectedCount} معمل · ${returnedCount} تعديل · ${cancelledCount} ملغية</div>
                    </div>

                    <div class="kpi-card-pdf rose">
                        <div class="kpi-top-row">
                            <span class="kpi-label">نسبة الإرجاع والرفض</span>
                        </div>
                        <div class="kpi-val" style="color:#be123c">${fmtPct(returnRate)}</div>
                        <div class="kpi-sub">${returnRejectionCount} حالة رفض دكتور + إعادة</div>
                    </div>
                </div>
            </div>

            <!-- 2. ملخص تشغيلي وتحليل سريع -->
            <div class="report-section unbroken-block" data-avoid-break="true">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>2. الملخص التشغيلي وكفاءة الأداء</span>
                </div>
                <div class="kpi-grid-4">
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">إجمالي الحالات (Cases)</span>
                        <div class="kpi-val">${fmt(totalPeriodOrders)} <span class="kpi-unit">حالة</span></div>
                        <div class="kpi-sub">الحالات المسلمة والمحسوبة بالفترة</div>
                    </div>
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">إجمالي الوحدات (Units)</span>
                        <div class="kpi-val">${fmt(totalUnits)} <span class="kpi-unit">وحدة</span></div>
                        <div class="kpi-sub">إجمالي الأسنان والتركيبات المنفذة</div>
                    </div>
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">متوسط سعر الوحدة</span>
                        <div class="kpi-val">${fmt(avgUnitPrice)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">متوسط الإيراد المحقق لكل وحدة</div>
                    </div>
                    <div class="kpi-card-pdf amber">
                        <span class="kpi-label">ذمم متأخرة +90 يوم</span>
                        <div class="kpi-val" style="color:#b45309">${fmt(summary.aging_90_plus)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">${summary.total_receivables > 0 ? ((summary.aging_90_plus / summary.total_receivables) * 100).toFixed(1) : 0}% من إجمالي الذمم</div>
                    </div>
                </div>

                <!-- التحليل السريع -->
                <div class="kpi-grid-3" style="margin-top:8px;">
                    <div class="kpi-card-pdf">
                        <div class="kpi-top-row">
                            <span class="kpi-label">أداء التحصيل</span>
                            <span class="kpi-badge neutral">${fmtPct(collectionPerformance)}</span>
                        </div>
                        <div class="kpi-sub" style="margin-top:3px">نسبة إجمالي التحصيل النقدي مقارنة بمبيعات الفترة</div>
                    </div>
                    <div class="kpi-card-pdf">
                        <div class="kpi-top-row">
                            <span class="kpi-label">كفاءة المصروفات</span>
                            <span class="kpi-badge negative">${fmtPct(opexRatio)}</span>
                        </div>
                        <div class="kpi-sub" style="margin-top:3px">الأعلى استهلاكاً: ${topExpense ? `${topExpense.category} (${fmt(topExpense.total)} ج.م)` : 'لا يوجد'}</div>
                    </div>
                    <div class="kpi-card-pdf">
                        <div class="kpi-top-row">
                            <span class="kpi-label">أوردرات بمحددات يدوية</span>
                            <span class="kpi-badge neutral">${fmtPct(manualOrdersRatio)}</span>
                        </div>
                        <div class="kpi-sub" style="margin-top:3px">${manualOrdersCount} أوردر يحمل سعراً أو تكلفة محددة يدوياً</div>
                    </div>
                </div>
            </div>

            <!-- 3. التحليل المالي (التدفقات النقدية وقائمة الدخل) -->
            <div class="report-section unbroken-block" data-avoid-break="true">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>3. التحليل المالي (Financial Analysis)</span>
                </div>
                <div class="kpi-grid-2">
                    <!-- التدفقات النقدية (أساس نقدي) -->
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
                        <div style="font-weight:800; font-size:10px; color:#0f172a; margin-bottom:6px; display:flex; justify-content:space-between;">
                            <span>التدفقات النقدية (Cash Flow)</span>
                            <span style="font-size:8.5px; color:#64748b; font-weight:600">أساس نقدي — حركة الخزينة الفعلية</span>
                        </div>
                        <div class="finance-row bold" style="color:#15803d">
                            <span>↗ المقبوضات (تحصيلات الأطباء)</span>
                            <span class="finance-val">${fmt(cashCollections)} ج.م</span>
                        </div>
                        <div class="finance-row" style="color:#b91c1c">
                            <span>↳ مدفوعات الموردين</span>
                            <span class="finance-val">${fmt(summary.cash_supplier_payments)} ج.م</span>
                        </div>
                        <div class="finance-row" style="color:#b91c1c">
                            <span>↳ مدفوعات المصممين</span>
                            <span class="finance-val">${fmt(summary.cash_designer_payments)} ج.م</span>
                        </div>
                        <div class="finance-row" style="color:#b91c1c">
                            <span>↳ مصروفات ونثريات تشغيلية</span>
                            <span class="finance-val">${fmt(summary.cash_other_expenses)} ج.م</span>
                        </div>
                        <div class="finance-row bold" style="color:#be123c">
                            <span>↘ إجمالي المدفوعات النقدية</span>
                            <span class="finance-val">${fmt(cashPayments)} ج.م</span>
                        </div>
                        <div class="finance-row grand" style="background:${cashNetFlow >= 0 ? '#f0fdf4' : '#fff1f2'}; color:${cashNetFlow >= 0 ? '#166534' : '#9f1239'}">
                            <span>صافي التدفق النقدي للفترة</span>
                            <span class="finance-val">${fmt(cashNetFlow)} ج.م</span>
                        </div>
                    </div>

                    <!-- قائمة الدخل (أساس استحقاق) -->
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
                        <div style="font-weight:800; font-size:10px; color:#0f172a; margin-bottom:6px; display:flex; justify-content:space-between;">
                            <span>قائمة الدخل والأرباح (P&L)</span>
                            <span style="font-size:8.5px; color:#64748b; font-weight:600">أساس استحقاق — تكلفة وإيراد الأعمال</span>
                        </div>
                        <div class="finance-row bold">
                            <span>إجمالي المبيعات (Sales Revenue)</span>
                            <span class="finance-val">${fmt(deliveredRevenue)} ج.م</span>
                        </div>
                        <div class="finance-row" style="color:#be123c">
                            <span>↳ تكلفة معامل الموردين</span>
                            <span class="finance-val">(${fmt(summary.total_cost_of_goods_suppliers)}) ج.م</span>
                        </div>
                        <div class="finance-row" style="color:#be123c">
                            <span>↳ تكلفة المصممين</span>
                            <span class="finance-val">(${fmt(summary.total_cost_of_goods_designers)}) ج.م</span>
                        </div>
                        <div class="finance-row bold" style="color:#b91c1c">
                            <span>(-) تكلفة البضائع المباعة (COGS)</span>
                            <span class="finance-val">(${fmt(productionCost)}) ج.م</span>
                        </div>
                        <div class="finance-row bold" style="color:#15803d; background:#f0fdf4">
                            <span>(=) مجمل الربح (الهامش: ${fmtPct(grossMargin)})</span>
                            <span class="finance-val">${fmt(grossProfit)} ج.م</span>
                        </div>
                        <div class="finance-row" style="color:#be123c">
                            <span>(-) مصروفات التشغيل (Opex)</span>
                            <span class="finance-val">(${fmt(operatingExpenses)}) ج.م</span>
                        </div>
                        <div class="finance-row grand" style="background:${netProfit >= 0 ? '#f0fdf4' : '#fff1f2'}; color:${netProfit >= 0 ? '#166534' : '#9f1239'}">
                            <span>(=) صافي الربح التشغيلي (الهامش: ${fmtPct(netMargin)})</span>
                            <span class="finance-val">${fmt(netProfit)} ج.م</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 4. تحليل الأوردرات والإنتاج (Order Analysis) - تم نقله هنا حسب طلب المستخدم -->
            <div class="report-section unbroken-block" data-avoid-break="true">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>4. ملخص تحليل الأوردرات (Order Analysis)</span>
                </div>
                <div class="kpi-grid-4">
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">إجمالي الأوردرات</span>
                        <div class="kpi-val">${fmt(totalPeriodOrders)} <span class="kpi-unit">أوردر</span></div>
                        <div class="kpi-sub">${totalUnits} وحدة إجمالاً</div>
                    </div>
                    <div class="kpi-card-pdf blue">
                        <span class="kpi-label">إجمالي المبيعات</span>
                        <div class="kpi-val">${fmt(deliveredRevenue)} <span class="kpi-unit">ج.م</span></div>
                    </div>
                    <div class="kpi-card-pdf rose">
                        <span class="kpi-label">تكلفة الإنتاج الكلية</span>
                        <div class="kpi-val" style="color:#be123c">${fmt(productionCost)} <span class="kpi-unit">ج.م</span></div>
                    </div>
                    <div class="kpi-card-pdf emerald">
                        <span class="kpi-label">مجمل الربح</span>
                        <div class="kpi-val" style="color:#15803d">${fmt(grossProfit)} <span class="kpi-unit">ج.م</span></div>
                        <div class="kpi-sub">هامش ${grossMargin.toFixed(1)}%</div>
                    </div>
                </div>
            </div>

            <!-- 5. أعلى العملاء نشاطاً وعوائل الخدمات والخدمات الأكثر طلباً -->
            <div class="report-section unbroken-block" data-avoid-break="true">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>5. تحليل العملاء والعوائل والخدمات الأكثر طلباً</span>
                </div>
                <div class="kpi-grid-3">
                    <!-- أكثر العملاء نشاطاً -->
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 8px;">
                        <div style="font-weight:700; font-size:9.5px; color:#475569; margin-bottom:4px">أكثر 5 أطباء نشاطاً وإيراداً</div>
                        <table class="pdf-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>اسم الطبيب</th>
                                    <th class="center">الحالات</th>
                                    <th class="num">الإيراد</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${topDoctors.slice(0, 5).map((doc, idx) => `
                                    <tr>
                                        <td>${idx + 1}</td>
                                        <td style="font-weight:700">${doc.name}</td>
                                        <td class="center">${doc.count}</td>
                                        <td class="num">${fmt(doc.revenue)} ج.م</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <!-- أكثر العوائل طلباً -->
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 8px;">
                        <div style="font-weight:700; font-size:9.5px; color:#475569; margin-bottom:4px">أكثر عوائل الخدمات طلباً (Families)</div>
                        <table class="pdf-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>عائلة الخدمة</th>
                                    <th class="center">الوحدات</th>
                                    <th class="num">الإيراد</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${displayFamilies.map((fam, idx) => `
                                    <tr>
                                        <td>${idx + 1}</td>
                                        <td style="font-weight:700">${fam.name}</td>
                                        <td class="center" style="font-weight:700">${fam.count}</td>
                                        <td class="num">${fmt(fam.revenue)} ج.م</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <!-- أكثر الخدمات طلباً -->
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:6px 8px;">
                        <div style="font-weight:700; font-size:9.5px; color:#475569; margin-bottom:4px">أكثر 5 خدمات طلباً (Top Services)</div>
                        <table class="pdf-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>اسم الخدمة</th>
                                    <th class="center">الوحدات</th>
                                    <th class="num">الإيراد</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${topServices.slice(0, 5).map((svc, idx) => `
                                    <tr>
                                        <td>${idx + 1}</td>
                                        <td style="font-weight:700">${svc.name}</td>
                                        <td class="center">${svc.count}</td>
                                        <td class="num">${fmt(svc.revenue)} ج.م</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- 6. تحليل أداء الخدمات وتوزيع الإيراد -->
            <div class="report-section" data-avoid-break="false">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>6. تحليل أداء وتوزيع الخدمات (Service Performance & Mix)</span>
                </div>
                <div class="kpi-grid-4" style="margin-bottom:6px;">
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">عدد الخدمات المباعة</span>
                        <div class="kpi-val">${detailedServices.length} <span class="kpi-unit">خدمة</span></div>
                    </div>
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">إجمالي الوحدات</span>
                        <div class="kpi-val">${fmt(totalUnits)} <span class="kpi-unit">وحدة</span></div>
                    </div>
                    <div class="kpi-card-pdf emerald">
                        <span class="kpi-label">إجمالي إيراد الخدمات</span>
                        <div class="kpi-val">${fmt(deliveredRevenue)} <span class="kpi-unit">ج.م</span></div>
                    </div>
                    <div class="kpi-card-pdf emerald">
                        <span class="kpi-label">إجمالي ربح الخدمات</span>
                        <div class="kpi-val">${fmt(grossProfit)} <span class="kpi-unit">ج.م</span></div>
                    </div>
                </div>

                <table class="pdf-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>اسم الخدمة</th>
                            <th class="center">الحالات</th>
                            <th class="center">الوحدات</th>
                            <th class="num">الإيراد</th>
                            <th class="num">التكلفة</th>
                            <th class="num">مجمل الربح</th>
                            <th class="center">الهامش %</th>
                            <th class="center">المساهمة %</th>
                            <th>أكثر طبيب طالب</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detailedServices.slice(0, 15).map((svc, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td style="font-weight:700">${svc.name}</td>
                                <td class="center">${svc.cases}</td>
                                <td class="center" style="font-weight:700">${svc.units}</td>
                                <td class="num">${fmt(svc.revenue)}</td>
                                <td class="num">${fmt(svc.cost)}</td>
                                <td class="num" style="color:${svc.profit >= 0 ? '#15803d' : '#be123c'}">${fmt(svc.profit)}</td>
                                <td class="center" style="font-weight:700; color:${svc.margin >= 30 ? '#15803d' : svc.margin >= 0 ? '#0284c7' : '#be123c'}">${svc.margin.toFixed(1)}%</td>
                                <td class="center" style="font-weight:700; color:#2563eb">${svc.share.toFixed(1)}%</td>
                                <td style="font-size:8px">${svc.topDoctor}</td>
                            </tr>
                        `).join('')}
                        <tr class="total-row">
                            <td colspan="2">الإجمالي</td>
                            <td class="center">${totalPeriodOrders}</td>
                            <td class="center">${totalUnits}</td>
                            <td class="num">${fmt(deliveredRevenue)} ج.م</td>
                            <td class="num">${fmt(productionCost)} ج.م</td>
                            <td class="num">${fmt(grossProfit)} ج.م</td>
                            <td class="center">${grossMargin.toFixed(1)}%</td>
                            <td class="center">100%</td>
                            <td>-</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- 7. تحليل المصروفات التشغيلية بالفئة -->
            <div class="report-section unbroken-block" data-avoid-break="true">
                <div class="section-title">
                    <span class="pill"></span>
                    <span>7. تحليل المصروفات التشغيلية بالفئة (Expense Breakdown)</span>
                </div>
                <div class="kpi-grid-4" style="margin-bottom:6px;">
                    <div class="kpi-card-pdf rose">
                        <span class="kpi-label">إجمالي المصروفات</span>
                        <div class="kpi-val" style="color:#be123c">${fmt(totalDetailedExpenses)} <span class="kpi-unit">ج.م</span></div>
                    </div>
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">% من التحصيلات</span>
                        <div class="kpi-val">${cashCollections > 0 ? ((totalDetailedExpenses / cashCollections) * 100).toFixed(1) : 0}%</div>
                    </div>
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">عدد الحركات</span>
                        <div class="kpi-val">${filteredExpenseTxs.length} <span class="kpi-unit">حركة</span></div>
                    </div>
                    <div class="kpi-card-pdf">
                        <span class="kpi-label">عدد الفئات</span>
                        <div class="kpi-val">${detailedExpenses.length} <span class="kpi-unit">فئة</span></div>
                    </div>
                </div>

                <table class="pdf-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>فئة المصروف</th>
                            <th class="num">إجمالي المبلغ</th>
                            <th class="center">النسبة من المصروفات</th>
                            <th class="center">عدد الحركات</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detailedExpenses.map((exp, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td style="font-weight:700">${exp.category}</td>
                                <td class="num" style="font-weight:800; color:#b91c1c">${fmt(exp.total)} ج.م</td>
                                <td class="center" style="font-weight:800; color:#2563eb">${exp.share.toFixed(1)}%</td>
                                <td class="center">${exp.count}</td>
                            </tr>
                        `).join('')}
                        <tr class="total-row">
                            <td colspan="2">الإجمالي الكلي</td>
                            <td class="num" style="color:#be123c">${fmt(totalDetailedExpenses)} ج.م</td>
                            <td class="center">100%</td>
                            <td class="center">${filteredExpenseTxs.length}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

        </div>

        <!-- ===== FOOTER BAR ===== -->
        <div class="doc-footer">
            <div>تم استخراج هذا التقرير الشامل آلياً من نظام ORCA لإدارة معامل الأسنان</div>
            <div>تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</div>
        </div>
    </div>
    `;

    const doc = createPdf();
    await htmlToPdfPage(doc, reportHtml);
    const cleanPeriod = (dateRangeLabel || 'report').replace(/[/\\?%*:|"<>]/g, '-').trim();
    doc.save(`Comprehensive_Analytics_Report_${cleanPeriod}_${new Date().toISOString().split('T')[0]}.pdf`);
}
