import type { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import type { LabInfo } from '../utils/finance';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import { analyticsService, type AnalyticsSummary } from './supabase/analyticsService';
import { db, type Order, type Transaction, type Doctor, type Supplier, type Service } from './db';
import { fetchMonthlyReportAdjustments, fetchMonthlyReportIssues } from './supabase/monthlyReportData';
import { buildPeriodDetails, cairoToday, previousCalendarMonth, type MonthlyReportModel, type ReportDatasets, type ReportPeriod } from './reports/monthlyReportModel';
import { loadReportFonts, renderMonthlyReportPdf } from './reports/monthlyReportPdf';

export interface ComprehensiveReportInput {
    startDate?: string;
    endDate?: string;
    dateRangeLabel: string;
    labInfo?: LabInfo;
    /** Only supply complete datasets, never a filtered tab's data. */
    preloadedOrders?: Order[];
    preloadedTransactions?: Transaction[];
    preloadedDoctors?: Doctor[];
    preloadedSuppliers?: Supplier[];
    preloadedServices?: Service[];
    datasets?: ReportDatasets;
    returnDoc?: boolean;
    customFileName?: string;
}

async function loadDatasets(input: ComprehensiveReportInput): Promise<ReportDatasets> {
    if (input.datasets) return input.datasets;
    const [orders, transactions, doctors, services, adjustments, issues] = await Promise.all([
        input.preloadedOrders !== undefined ? Promise.resolve(input.preloadedOrders) : db.getAllOrdersUnpaginated(),
        input.preloadedTransactions !== undefined ? Promise.resolve(input.preloadedTransactions) : db.getTransactions(),
        input.preloadedDoctors !== undefined ? Promise.resolve(input.preloadedDoctors) : db.getDoctors(),
        input.preloadedServices !== undefined ? Promise.resolve(input.preloadedServices) : db.getServices(),
        fetchMonthlyReportAdjustments(), fetchMonthlyReportIssues()
    ]);
    return { orders, transactions, doctors, services, adjustments, issues };
}

type SummaryCache = Map<string, Promise<AnalyticsSummary>>;
async function buildModel(input: ComprehensiveReportInput, data: ReportDatasets, cache: SummaryCache): Promise<MonthlyReportModel> {
    const period = { start: input.startDate || undefined, end: input.endDate || undefined };
    if (period.start && period.end && period.start > period.end) throw new Error('Invalid report period');
    const previousPeriod = previousCalendarMonth(period);
    const summaryFor = (range: ReportPeriod) => {
        const key = `${range.start || ''}:${range.end || ''}`;
        if (!cache.has(key)) cache.set(key, analyticsService.getSummary(range.start, range.end));
        return cache.get(key)!;
    };
    const [summary, topDoctors, topServices, families, previousSummary] = await Promise.all([
        summaryFor(period), analyticsService.getTopDoctors(period.start, period.end, 5),
        analyticsService.getTopServices(period.start, period.end, 5), analyticsService.getTopFamilies(period.start, period.end, 5),
        previousPeriod ? summaryFor(previousPeriod) : Promise.resolve(null)
    ]);
    return {
        period, label: previousPeriod && period.start ? `${MONTH_NAMES[Number(period.start.slice(5, 7)) - 1]} ${period.start.slice(0, 4)}` : input.dateRangeLabel,
        generatedAt: new Date().toISOString(), summary,
        details: buildPeriodDetails(data, period, summary), topDoctors, topServices, families,
        previous: previousPeriod && previousSummary ? { period: previousPeriod, summary: previousSummary, details: buildPeriodDetails(data, previousPeriod, previousSummary) } : null
    };
}

export async function generateComprehensiveAnalyticsPDF(input: ComprehensiveReportInput & { returnDoc: true }): Promise<jsPDF>;
export async function generateComprehensiveAnalyticsPDF(input: ComprehensiveReportInput): Promise<jsPDF | void>;
export async function generateComprehensiveAnalyticsPDF(input: ComprehensiveReportInput): Promise<jsPDF | void> {
    const [data, fonts] = await Promise.all([loadDatasets(input), loadReportFonts()]);
    const model = await buildModel(input, data, new Map());
    const doc = renderMonthlyReportPdf(model, input.labInfo || DEFAULT_LAB_INFO, fonts);
    if (input.returnDoc) return doc;
    const cleanPeriod = (input.customFileName || input.dateRangeLabel || 'report').replace(/[/\\?%*:|"<>]/g, '-').trim();
    doc.save(`Comprehensive_Analytics_Report_${cleanPeriod}_${cairoToday()}.pdf`);
}

export interface BatchMonthConfig {
    year: number;
    month: number;
    nameAr: string;
    startDate: string;
    endDate: string;
}

const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const TARGET_BATCH_MONTHS: BatchMonthConfig[] = Array.from({ length: 15 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 6 + index, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return { year, month, nameAr: `${MONTH_NAMES[month - 1]} ${year}`, startDate: date.toISOString().slice(0, 10), endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
});

export async function generateBulkMonthlyComprehensiveReports(options: {
    preloadedOrders?: Order[];
    preloadedTransactions?: Transaction[];
    preloadedDoctors?: Doctor[];
    preloadedSuppliers?: Supplier[];
    preloadedServices?: Service[];
    onProgress?: (current: number, total: number, monthName: string) => void;
    downloadSeparateFiles?: boolean;
} = {}): Promise<void> {
    const [data, fonts] = await Promise.all([loadDatasets({ ...options, dateRangeLabel: '' }), loadReportFonts()]);
    const zip = new JSZip();
    const cache: SummaryCache = new Map();
    const total = TARGET_BATCH_MONTHS.length;
    for (let index = 0; index < total; index++) {
        const month = TARGET_BATCH_MONTHS[index];
        options.onProgress?.(index + 1, total, month.nameAr);
        const model = await buildModel({ startDate: month.startDate, endDate: month.endDate, dateRangeLabel: month.nameAr }, data, cache);
        const doc = renderMonthlyReportPdf(model, DEFAULT_LAB_INFO, fonts);
        const fileName = `${String(index + 1).padStart(2, '0')}_تقرير_شامل_${month.year}_${String(month.month).padStart(2, '0')}_${month.nameAr.replace(/\s+/g, '_')}.pdf`;
        zip.file(fileName, doc.output('arraybuffer'));
        if (options.downloadSeparateFiles) doc.save(fileName);
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    options.onProgress?.(total, total, 'ضغط التقارير وتجهيز التنزيل...');
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'تقارير_شاملة_شهرياً_2025_07_إلى_2026_09.zip';
    document.body.appendChild(link);
    try { link.click(); }
    finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}
