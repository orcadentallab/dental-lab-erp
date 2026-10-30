import { describe, expect, it } from 'vitest';
import { buildPeriodDetails, closingReceivables, comparisonChange, previousCalendarMonth, reportDay } from '../../src/services/reports/monthlyReportModel';
import { emptyReportDatasets, emptyReportSummary, reportOrder, reportTransaction, monthlyReportFixture } from '../fixtures/monthly-report';

const august = { start: '2026-08-01', end: '2026-08-31' };

describe('historical monthly report facts', () => {
    it('excludes future collections and adjustments from closing receivables and ages at month end', () => {
        const data = emptyReportDatasets();
        data.orders = [reportOrder({ totalPrice: 1000, actualDeliveryDate: '2026-05-01' }), reportOrder({ id: 'o2', totalPrice: 2000 })];
        data.transactions = [reportTransaction({ amount: 500 }), reportTransaction({ id: 'future', date: '2026-09-01', amount: 2500 })];
        data.adjustments = [
            { id: 'a1', entity_type: 'doctor', entity_id: 'd1', type: 'credit', amount: 100, date: '2026-08-31', created_at: '' },
            { id: 'a2', entity_type: 'doctor', entity_id: 'd1', type: 'credit', amount: 2000, date: '2026-09-01', created_at: '' }
        ];
        expect(closingReceivables(data, august)).toMatchObject({ total: 2400, aging90: 400, periodUnpaid: 2000, advances: 0 });
    });

    it('consolidates branch collections with parent orders and keeps advances separate from other doctors debt', () => {
        const data = emptyReportDatasets();
        data.doctors = [{ id: 'branch', parentId: 'parent', name: '', phone: '', address: '', doctorCode: '', representativeName: '' }];
        data.orders = [reportOrder({ doctorId: 'branch', totalPrice: 200 }), reportOrder({ id: 'o2', doctorId: 'other', totalPrice: 300 })];
        data.transactions = [reportTransaction({ entityId: 'parent', amount: 250 })];
        expect(closingReceivables(data, august)).toMatchObject({ total: 300, advances: 50 });
    });

    it('ages charge adjustments from their own date instead of attributing them to an older invoice', () => {
        const data = emptyReportDatasets();
        data.orders = [reportOrder({ totalPrice: 100, actualDeliveryDate: '2026-01-01' })];
        data.transactions = [reportTransaction({ amount: 100 })];
        data.adjustments = [{ id: 'a', entity_type: 'doctor', entity_id: 'd1', type: 'charge', amount: 80, date: '2026-08-30', created_at: '' }];
        expect(closingReceivables(data, august)).toMatchObject({ total: 80, aging90: 0, periodUnpaid: 0, aging: [80, 0, 0, 0] });
    });

    it('ages reversed collections from the reversal date and ignores rejected and future collections', () => {
        const data = emptyReportDatasets();
        data.transactions = [
            reportTransaction({ amount: -80, date: '2026-01-01' }),
            reportTransaction({ id: 'rejected', amount: 80, status: 'rejected' }),
            reportTransaction({ id: 'future', amount: 80, date: '2026-09-01' })
        ];
        expect(closingReceivables(data, august)).toMatchObject({ total: 80, aging90: 80, advances: 0 });
    });

    it('deduplicates rejection plus redo, excludes voided and deleted cases, and separates event and cohort counts', () => {
        const data = emptyReportDatasets();
        data.orders = [
            reportOrder(),
            reportOrder({ id: 'open', status: 'Under Production', productionStatus: 'in_production' }),
            reportOrder({ id: 'deleted', isDeleted: true }),
        ];
        const issue = { id: 'i1', orderId: 'o1', type: 'doctor_rejected', cause: 'fit', date: '2026-08-10', isVoided: false };
        data.issues = [issue, { ...issue, id: 'i2', type: 'redo' }, { ...issue, id: 'i3', orderId: 'open' }, { ...issue, id: 'i4', isVoided: true }, { ...issue, id: 'i5', orderId: 'deleted' }];
        expect(buildPeriodDetails(data, august, emptyReportSummary()).issues).toMatchObject({ events: 3, affectedCases: 2, closedAffectedCases: 1, rejectionCases: 1, rate: 100, rejectionRate: 100 });
    });

    it('does not count returned work as a closed case or invent a rate when no cases closed', () => {
        const data = emptyReportDatasets();
        data.orders = [reportOrder({ status: 'Returned for Adjustments', issueState: 'returned' })];
        const details = buildPeriodDetails(data, august, emptyReportSummary());
        expect(details.closedCases).toBe(0);
        expect(details.issues.rate).toBeNull();
    });

    it('includes all 18 services and reconciles their revenue and cost exactly with the summary', () => {
        const model = monthlyReportFixture();
        expect(model.details.services).toHaveLength(18);
        expect(model.details.services.reduce((sum, row) => sum + row.revenue, 0)).toBe(model.summary.total_sales_value);
        expect(model.details.services.reduce((sum, row) => sum + row.cost, 0)).toBe(model.summary.total_cost_of_goods);
    });

    it('exposes itemless revenue and settlement scope differences as an explicit reconciliation row', () => {
        const data = emptyReportDatasets();
        data.orders = [reportOrder({ items: [] })];
        const details = buildPeriodDetails(data, august, { ...emptyReportSummary(), total_sales_value: 100, total_cost_of_goods: 60 });
        expect(details.services).toEqual([expect.objectContaining({ isReconciliation: true, revenue: 100, cost: 60 })]);
    });

    it('allocates zero-priced multi-service orders proportionally by units without losing money', () => {
        const data = emptyReportDatasets();
        data.orders = [reportOrder({ items: [{ serviceType: 'A', price: 0, teethNumbers: [11] }, { serviceType: 'B', price: 0, teethNumbers: [12, 13] }] })];
        const details = buildPeriodDetails(data, august, { ...emptyReportSummary(), total_sales_value: 100, total_cost_of_goods: 60 });
        expect(details.services.find(row => row.name === 'B')?.revenue).toBeCloseTo(200 / 3);
        expect(details.services.reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(60);
        expect(details.services.some(row => row.isReconciliation)).toBe(false);
    });

    it('compares only complete calendar months and handles year and leap-year boundaries', () => {
        expect(previousCalendarMonth({ start: '2026-01-01', end: '2026-01-31' })).toEqual({ start: '2025-12-01', end: '2025-12-31' });
        expect(previousCalendarMonth({ start: '2024-03-01', end: '2024-03-31' })).toEqual({ start: '2024-02-01', end: '2024-02-29' });
        expect(previousCalendarMonth({ start: '2026-08-01', end: '2026-08-30' })).toBeNull();
        expect(previousCalendarMonth({})).toBeNull();
    });

    it('does not fabricate growth from a zero base and shows an improvement from a previous loss', () => {
        expect(comparisonChange(200, 0)).toBeNull();
        expect(comparisonChange(0, 0)).toBe(0);
        expect(comparisonChange(100, -100)).toBe(200);
    });

    it('uses Cairo dates for issue timestamps on the final day of a month', () => {
        expect(reportDay('2026-08-31T21:30:00Z')).toBe('2026-09-01');
        expect(reportDay('2026-08-31')).toBe('2026-08-31');
    });
});
