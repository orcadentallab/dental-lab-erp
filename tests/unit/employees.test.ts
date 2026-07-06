import { describe, it, expect } from 'vitest';
import { getEmployeeFinanceStats } from '../../src/utils/employeeFinance';
import type { User, EmployeeAdvance, EmployeeCustody, EmployeeCommission, Transaction } from '../../src/services/db';

describe('Employee Financial Calculations - Consolidated & Isolated Tests', () => {
    const mockUser: User = {
        id: 'user-123',
        username: 'sales_rep_1',
        name: 'مندوب مبيعات تجريبي',
        role: 'representative',
        employeeType: 'sales_rep',
        baseSalary: 5000,
        isActive: true
    };

    const selectedMonth = '2026-07';

    // 1. Basic Unpaid Salary
    it('calculates standard unpaid salary with base salary only', () => {
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, [], [], [], []);
        expect(stats.salaryPaid).toBe(false);
        expect(stats.salaryDue).toBe(mockUser.baseSalary);
        expect(stats.netBalance).toBe(mockUser.baseSalary);
    });

    // 2. Salary Paid
    it('verifies that salaryPaid is true and salaryDue is 0 when a payout transaction exists', () => {
        const transactions: Transaction[] = [
            {
                id: 'tx-payout',
                type: 'expense',
                amount: 5000,
                category: 'مرتبات وأجور',
                date: '2026-07-28',
                description: 'صرف راتب شهر 2026-07',
                entityId: 'user-123',
                entityType: 'general',
                isRegistered: true,
                effectiveDate: '2026-07-01'
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, [], [], [], transactions);
        expect(stats.salaryPaid).toBe(true);
        expect(stats.salaryDue).toBe(0);
        expect(stats.netBalance).toBe(0); // salaryDue (0) - advances (0) - custody (0)
    });

    // 3. Outstanding Advances Subtraction
    it('subtracts outstanding (pending) advances from net balance', () => {
        const advances: EmployeeAdvance[] = [
            {
                id: 'adv-1',
                employeeId: 'user-123',
                amount: 1200,
                reason: 'سلفة أولى',
                date: '2026-07-10',
                status: 'pending'
            },
            {
                id: 'adv-2',
                employeeId: 'user-123',
                amount: 500,
                reason: 'سلفة ثانية مسواة',
                date: '2026-07-12',
                status: 'settled' // should not be subtracted
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, advances, [], [], []);
        expect(stats.outstandingAdvances).toBe(1200);
        // Net Balance = 5000 (salary due) - 1200 (pending advance) = 3800
        expect(stats.netBalance).toBe(3800);
    });

    // 4. Monetary Custody Subtraction
    it('subtracts outstanding open monetary custody from net balance', () => {
        const custodies: EmployeeCustody[] = [
            {
                id: 'cust-1',
                employeeId: 'user-123',
                description: 'عهدة نقدية مفتوحة',
                amount: 900,
                dateGiven: '2026-07-05',
                status: 'open'
            },
            {
                id: 'cust-2',
                employeeId: 'user-123',
                description: 'عهدة نقدية مغلقة',
                amount: 1500,
                dateGiven: '2026-07-01',
                status: 'closed' // should not be subtracted
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, [], custodies, [], []);
        expect(stats.outstandingCustody).toBe(900);
        // Net Balance = 5000 (salary due) - 900 (open monetary custody) = 4100
        expect(stats.netBalance).toBe(4100);
    });

    // 5. Exclude Non-Monetary (Item-Only) Custody
    it('excludes item-only custody (amount is null or undefined) from financial calculations', () => {
        const custodies: EmployeeCustody[] = [
            {
                id: 'cust-item',
                employeeId: 'user-123',
                description: 'عهدة عينية لابتوب',
                item: 'MacBook Pro',
                amount: null,
                dateGiven: '2026-07-06',
                status: 'open'
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, [], custodies, [], []);
        expect(stats.outstandingCustody).toBe(0);
        expect(stats.netBalance).toBe(5000); // 5000 - 0 = 5000
    });

    // 6. Manual Commissions Addition
    it('adds manual commissions to salary due', () => {
        const commissions: EmployeeCommission[] = [
            {
                id: 'comm-1',
                employeeId: 'user-123',
                amount: 1500,
                date: '2026-07-15',
                period: '2026-07',
                note: 'عمولة يوليو'
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, [], [], commissions, []);
        // Salary Due = 5000 (base) + 1500 (commission) = 6500
        expect(stats.salaryDue).toBe(6500);
        expect(stats.netBalance).toBe(6500);
    });

    // 7. Overdue Advance Warning
    it('sets hasOverdueItems to true if a pending advance is older than 30 days', () => {
        const advances: EmployeeAdvance[] = [
            {
                id: 'adv-old',
                employeeId: 'user-123',
                amount: 300,
                reason: 'سلفة قديمة',
                date: '2026-05-01', // Older than 30 days (compared to mock test time)
                status: 'pending'
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, advances, [], [], []);
        expect(stats.hasOverdueItems).toBe(true);
    });

    // 8. Overdue Custody Warning
    it('sets hasOverdueItems to true if an open custody is older than 30 days', () => {
        const custodies: EmployeeCustody[] = [
            {
                id: 'cust-old',
                employeeId: 'user-123',
                description: 'عهدة قديمة',
                item: 'سخان معمل',
                amount: null,
                dateGiven: '2026-04-15', // Older than 30 days
                status: 'open'
            }
        ];
        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, [], custodies, [], []);
        expect(stats.hasOverdueItems).toBe(true);
    });

    // 9. All parameters working together
    it('calculates net balance and overdue warning with all parameters present', () => {
        const advances: EmployeeAdvance[] = [
            { id: 'a1', employeeId: 'user-123', amount: 500, reason: 'سلفة', date: '2026-07-10', status: 'pending' }
        ];
        const custodies: EmployeeCustody[] = [
            { id: 'c1', employeeId: 'user-123', description: 'عهدة عادية', amount: 400, dateGiven: '2026-07-05', status: 'open' },
            { id: 'c2', employeeId: 'user-123', description: 'لابتوب عهدة عينية', item: 'Laptop', amount: null, dateGiven: '2026-07-05', status: 'open' },
            { id: 'c3', employeeId: 'user-123', description: 'عهدة متأخرة عينية', item: 'Scanner', amount: null, dateGiven: '2026-05-01', status: 'open' }
        ];
        const commissions: EmployeeCommission[] = [
            { id: 'comm1', employeeId: 'user-123', amount: 1000, date: '2026-07-15', period: '2026-07', note: 'عمولة' }
        ];
        const transactions: Transaction[] = [
            { id: 't1', type: 'expense', amount: 300, category: 'bonus', date: '2026-07-01', description: 'مكافأة', entityId: 'user-123', entityType: 'general' },
            { id: 't2', type: 'expense', amount: 100, category: 'deduction', date: '2026-07-01', description: 'خصم', entityId: 'user-123', entityType: 'general' }
        ];

        const stats = getEmployeeFinanceStats(mockUser, selectedMonth, advances, custodies, commissions, transactions);

        // Salary Due = 5000 (base) + 1000 (commission) + 300 (bonus) - 100 (deduction) = 6200
        expect(stats.salaryDue).toBe(6200);
        // Outstanding Advances = 500
        expect(stats.outstandingAdvances).toBe(500);
        // Outstanding Custody = 400 (ignores c2 and c3 item-only custodies)
        expect(stats.outstandingCustody).toBe(400);
        // Net Balance = 6200 - 500 - 400 = 5300
        expect(stats.netBalance).toBe(5300);
        // Overdue Items = true (because c3 dateGiven is 2026-05-01, > 30 days ago)
        expect(stats.hasOverdueItems).toBe(true);
    });
});
