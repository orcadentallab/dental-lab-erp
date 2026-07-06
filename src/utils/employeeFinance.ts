import type { User, EmployeeAdvance, EmployeeCustody, EmployeeCommission, Transaction } from '../services/db';

export interface EmployeeFinanceStats {
    outstandingAdvances: number;
    outstandingCustody: number;
    approvedExpenses: number;
    salaryPaid: boolean;
    salaryDue: number;
    netBalance: number;
    hasOverdueItems: boolean; // Overdue if pending advance or open custody > 30 days
}

export function getEmployeeFinanceStats(
    user: User,
    selectedMonth: string, // YYYY-MM
    advances: EmployeeAdvance[],
    custodies: EmployeeCustody[],
    commissions: EmployeeCommission[],
    transactions: Transaction[]
): EmployeeFinanceStats {
    // 1. Outstanding advances (pending)
    const userAdvances = advances.filter(a => a.employeeId === user.id && a.status === 'pending');
    const outstandingAdvances = userAdvances.reduce((sum, a) => sum + a.amount, 0);

    // 2. Outstanding monetary custody (open & amount != null)
    const userCustodies = custodies.filter(c => c.employeeId === user.id && c.status === 'open');
    const outstandingCustody = userCustodies
        .filter(c => c.amount !== null && c.amount !== undefined)
        .reduce((sum, c) => sum + Number(c.amount), 0);

    // 3. Approved daily expenses pending payout
    const userApprovedExpenses = transactions.filter(t =>
        t.entityId === user.id &&
        t.type === 'expense' &&
        (t.status === 'approved' || (t.isApproved && t.status !== 'settled')) &&
        !t.isRegistered &&
        !['bonus', 'deduction', 'مرتبات وأجور'].includes(t.category)
    );
    const approvedExpenses = userApprovedExpenses.reduce((sum, t) => sum + t.amount, 0);

    // 4. Commissions for selected month
    const userCommissions = commissions.filter(c => c.employeeId === user.id && c.period === selectedMonth);
    const monthlyCommissions = userCommissions.reduce((sum, c) => sum + c.amount, 0);

    // 5. Monthly adjustments from transactions (bonus/deduction)
    // Same effectiveDate-first rule: use the financial month, not the calendar date.
    const monthlyTransactions = transactions.filter(t =>
        t.entityId === user.id &&
        (
            t.effectiveDate
                ? t.effectiveDate.startsWith(selectedMonth)
                : t.date.startsWith(selectedMonth)
        )
    );

    const totalBonuses = monthlyTransactions
        .filter(t => t.category === 'bonus')
        .reduce((sum, t) => sum + t.amount, 0);

    const totalDeductions = monthlyTransactions
        .filter(t => t.category === 'deduction')
        .reduce((sum, t) => sum + t.amount, 0);

    // 6. Check if salary is already paid
    // Use effectiveDate (financial month) as the authoritative month.
    // Fall back to t.date ONLY when effectiveDate is absent, so a salary
    // paid on Jun-04 for May (effectiveDate=2026-05-01) does NOT mark June as paid.
    const salaryPaid = transactions.some(t =>
        t.entityId === user.id &&
        t.category === 'مرتبات وأجور' &&
        (
            t.effectiveDate
                ? t.effectiveDate.startsWith(selectedMonth)      // ✅ prefer financial month
                : t.date.startsWith(selectedMonth)               // fallback only if no effectiveDate
        )
    );

    // 7. Calculate current month's salary due
    let salaryDue = 0;
    if (!salaryPaid && user.isActive !== false) {
        const baseSalary = user.baseSalary || 0;
        salaryDue = Math.max(0, baseSalary + totalBonuses - totalDeductions + monthlyCommissions);
    }

    // 8. Calculate Net Balance
    const netBalance = salaryDue - outstandingAdvances - outstandingCustody;

    // 9. Check for overdue items (> 30 days old)
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const hasOverdueAdvance = userAdvances.some(a => new Date(a.date) < thirtyDaysAgo);
    const hasOverdueCustody = userCustodies.some(c => new Date(c.dateGiven) < thirtyDaysAgo);
    const hasOverdueItems = hasOverdueAdvance || hasOverdueCustody;

    return {
        outstandingAdvances,
        outstandingCustody,
        approvedExpenses,
        salaryPaid,
        salaryDue,
        netBalance,
        hasOverdueItems
    };
}
