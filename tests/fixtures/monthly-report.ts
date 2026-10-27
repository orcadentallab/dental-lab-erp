import type { AnalyticsSummary } from '../../src/services/supabase/analyticsService';
import type { Order, Transaction } from '../../src/services/db';
import { buildPeriodDetails, type MonthlyReportModel, type ReportDatasets } from '../../src/services/reports/monthlyReportModel';

export function emptyReportSummary(): AnalyticsSummary {
    return {
        total_sales_value: 0, total_cost_of_goods: 0, total_cost_of_goods_suppliers: 0, total_cost_of_goods_designers: 0,
        completed_order_count: 0, active_order_count: 0, doctor_rejected_count: 0, lab_rejected_count: 0, returned_count: 0,
        redo_count: 0, redo_cost: 0, urgent_count: 0, total_order_count: 0, total_income: 0, total_expenses: 0,
        production_costs: 0, operating_expenses: 0, doctor_collections: 0, supplier_payments: 0, designer_payments: 0,
        cash_total_income: 0, cash_doctor_collections: 0, cash_total_expenses: 0, cash_supplier_payments: 0, cash_designer_payments: 0,
        cash_other_expenses: 0, total_receivables: 0, aging_0_30: 0, aging_31_60: 0, aging_61_90: 0, aging_90_plus: 0,
        pending_revenue_period: 0, total_payables: 0, total_payables_suppliers: 0, total_payables_designers: 0
    };
}

export function reportOrder(overrides: Partial<Order> = {}): Order {
    return { id: 'o1', caseId: 'C01', doctorId: 'd1', patientName: 'Test', items: [{ serviceType: 'Zr Preshade', teethNumbers: [11], price: 100 }], discount: 0, totalPrice: 100, shade: 'A1', status: 'Delivered', deliveryDate: '2026-08-10', actualDeliveryDate: '2026-08-10', productionStatus: 'final_delivered', issueState: 'none', cost: 60, createdAt: '2026-08-01T10:00:00Z', priority: 'Normal', ...overrides };
}

export function reportTransaction(overrides: Partial<Transaction> = {}): Transaction {
    return { id: 'tx1', type: 'income', entityType: 'doctor', entityId: 'd1', amount: 100, date: '2026-08-20', category: 'collection', description: 'Test', status: 'approved', ...overrides };
}

export function emptyReportDatasets(): ReportDatasets {
    return { orders: [], transactions: [], doctors: [], services: [], adjustments: [], issues: [] };
}

/** Explicitly synthetic fixture: never described as a regeneration of the owner's accounts. */
export function monthlyReportFixture(count = 18): MonthlyReportModel {
    const data = emptyReportDatasets();
    data.doctors = [
        { id: 'd1', name: 'دكتور تجريبي - أحمد إبراهيم', phone: '01000000000', address: 'القاهرة', doctorCode: 'TEST', representativeName: '' },
        { id: 'd2', name: 'مركز أسنان تجريبي طويل الاسم', phone: '01000000001', address: 'القاهرة', doctorCode: 'TEST2', representativeName: '' }
    ];
    const names = ['Zr Preshade', 'Emax CAD', 'PFM vm13', 'PMMA Printed', 'Orthodontic Retainer & Night Guard', 'خدمة تجريبية بتسمية عربية طويلة', 'Scanner Rent'];
    for (let index = 0; index < count; index++) {
        const name = `${names[index % names.length]} ${String(index + 1).padStart(2, '0')}`;
        data.orders.push(reportOrder({ id: `o${index}`, doctorId: index % 2 ? 'd1' : 'd2', totalPrice: 5000 + index * 250, cost: 2500 + index * 130, items: [{ serviceType: name, teethNumbers: [11, 12], price: (5000 + index * 250) / 2 }] }));
        data.orders.push(reportOrder({ id: `p${index}`, deliveryDate: '2026-07-10', actualDeliveryDate: '2026-07-10', createdAt: '2026-07-01T10:00:00Z', totalPrice: 4000 + index * 220, cost: 2500 + index * 100, items: [{ serviceType: name, teethNumbers: [11], price: 4000 + index * 220 }] }));
    }
    data.transactions = [reportTransaction({ amount: 145000 }), reportTransaction({ id: 'prior-cash', amount: 50000, date: '2026-07-20' }), reportTransaction({ id: 'future-cash', amount: 900000, date: '2026-09-20' }), ...[48475, 15629, 1185, 250, 123].map((amount, index) => reportTransaction({ id: `exp${index}`, type: 'expense', entityId: undefined, entityType: 'general', amount, category: ['مرتبات وأجور', 'شحن وتوصيل', 'انتقالات ووقود', 'مصروفات أخرى', 'عمولات ورسوم بنكية'][index] }))];
    data.issues = [
        { id: 'i1', orderId: 'o1', type: 'doctor_rejected', cause: 'fit', date: '2026-08-12', isVoided: false },
        { id: 'i2', orderId: 'o1', type: 'redo', cause: 'fit', date: '2026-08-13', isVoided: false },
        { id: 'i3', orderId: 'o2', type: 'returned', cause: 'shade', date: '2026-08-17', isVoided: false }
    ];
    const period = { start: '2026-08-01', end: '2026-08-31' };
    const prevPeriod = { start: '2026-07-01', end: '2026-07-31' };
    const summaryFor = (prefix: string) => {
        const orders = data.orders.filter(order => order.id.startsWith(prefix));
        const cost = orders.reduce((sum, order) => sum + order.cost, 0);
        const summary = { ...emptyReportSummary(), total_sales_value: orders.reduce((sum, order) => sum + order.totalPrice, 0), total_cost_of_goods: cost, total_cost_of_goods_suppliers: cost, operating_expenses: prefix === 'o' ? 65662 : 60000, cash_total_income: prefix === 'o' ? 176500 : 135000, cash_doctor_collections: prefix === 'o' ? 176500 : 135000, cash_total_expenses: prefix === 'o' ? 147012 : 120000, cash_supplier_payments: prefix === 'o' ? 72865 : 60000, cash_designer_payments: prefix === 'o' ? 1420 : 1000, cash_other_expenses: prefix === 'o' ? 72727 : 59000 };
        return summary;
    };
    const summary = summaryFor('o');
    const previousSummary = summaryFor('p');
    return {
        period, label: 'أغسطس 2026', generatedAt: '2026-10-07T12:00:00Z', summary,
        details: buildPeriodDetails(data, period, summary),
        previous: { period: prevPeriod, summary: previousSummary, details: buildPeriodDetails(data, prevPeriod, previousSummary) },
        topDoctors: data.doctors.map((doctor, index) => ({ name: doctor.name, revenue: summary.total_sales_value * (index === 0 ? 0.55 : 0.45), count: Math.floor(count / 2) })),
        topServices: data.orders.filter(order => order.id.startsWith('o')).slice(0, 5).map(order => ({ name: order.items[0].serviceType, count: 2, revenue: order.totalPrice })),
        families: { familyCount: 2, totalRevenue: summary.total_sales_value, allocatedRevenue: summary.total_sales_value, itemlessRevenue: 0, families: [{ name: 'Zirconia', color: 'blue', count, revenue: summary.total_sales_value * 0.6, isFamily: true }, { name: 'PFM', color: 'green', count, revenue: summary.total_sales_value * 0.4, isFamily: true }] },
        previewNotice: 'معاينة تصميم ببيانات اختبار تجريبية - لا تمثل حسابات المعمل الفعلية.'
    };
}
