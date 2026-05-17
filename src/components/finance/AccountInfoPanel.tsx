import { ArrowDownLeft, ArrowUpRight, History, Wallet } from 'lucide-react';
import clsx from 'clsx';
import type { Transaction, Order, Doctor } from '../../services/db';
import type { Adjustment } from '../../services/financeService';
import { getDoctorReceivableAmount, isDoctorStatementIncluded } from '../../constants/orderLifecycle';

interface AccountInfoPanelProps {
    entityId: string;
    entityName: string;
    entityType: 'doctor' | 'supplier' | 'designer';
    transactions: Transaction[];
    orders: Order[]; // For doctors (revenue) and suppliers/designers (cost)
    adjustments?: Adjustment[];
    doctors?: Doctor[];
    className?: string;
}

export function AccountInfoPanel({
    entityId,
    entityName,
    entityType,
    transactions,
    orders,
    adjustments = [],
    doctors = [],
    className,
}: AccountInfoPanelProps) {
    if (!entityId) {
        return (
            <div className={clsx("bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-8 text-center h-full min-h-[300px]", className)}>
                <div className="bg-gray-100 p-4 rounded-full mb-4">
                    <Wallet className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-gray-900 font-medium mb-1">تفاصيل الحساب</h3>
                <p className="text-sm text-gray-500 max-w-[200px]">
                    اختر {entityType === 'doctor' ? 'طبيباً' : entityType === 'supplier' ? 'مورداً' : 'مسمماً'} لعرض كشف الحساب والرصيد الحالي
                </p>
            </div>
        );
    }

    // Calculate Metrics
    let totalWork = 0;
    let totalPaid = 0;
    let balance = 0;
    const currencyLabel = 'ج.م';

    const entityIds = entityType === 'doctor'
        ? [entityId, ...doctors.filter(d => d.parentId === entityId).map(d => d.id)]
        : [entityId];
    const entityIdSet = new Set(entityIds);

    // Filter Transactions for this entity
    const entityTransactions = transactions.filter(
        (t) => (t.entityType === entityType || !t.entityType) && !!t.entityId && entityIdSet.has(t.entityId)
    );

    // Filter Adjustments
    const entityAdjustments = adjustments.filter(
        (a) => a.entity_type === entityType && entityIdSet.has(a.entity_id)
    );

    const totalCharges = entityAdjustments.filter(a => a.type === 'charge').reduce((sum, a) => sum + a.amount, 0);
    const totalCredits = entityAdjustments.filter(a => a.type === 'credit').reduce((sum, a) => sum + a.amount, 0);

    // Filter Orders/Work for this entity
    // Doctor: Orders where he is the doctor. Sum(totalPrice)
    // Supplier: Orders where he is the supplier. Sum(cost)
    // Designer: Orders where he is the designer. Sum(designPrice)

    if (entityType === 'doctor') {
        const entityOrders = orders.filter((o) => {
            if (!entityIdSet.has(o.doctorId)) return false;
            return isDoctorStatementIncluded(o);
        });
        totalWork = entityOrders.reduce((sum, o) => sum + getDoctorReceivableAmount(o), 0) + totalCharges;
        // Income from doctor
        totalPaid = entityTransactions
            .filter((t) => t.type === 'income')
            .reduce((sum, t) => sum + t.amount, 0) + totalCredits;
        // Balance = Work Done - Paid (Positive means he owes us)
        balance = totalWork - totalPaid;

    } else if (entityType === 'supplier') {
        const entityOrders = orders.filter((o) => o.supplierId === entityId);
        
        let calculatedWork = 0;
        entityOrders.forEach(o => {
            const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
            const isRelevant = (o.status || '').toLowerCase() === 'delivered' || hasRejectionCost;
            
            if (isRelevant) {
                let cost = o.cost || 0;
                if (hasRejectionCost) cost = o.rejectedLabCost!;
                if (o.workflowType === 'split' && o.designPrice && !hasRejectionCost) cost -= o.designPrice;
                calculatedWork += cost;
            }
        });
        totalWork = calculatedWork + totalCharges;

        // Expenses to supplier
        totalPaid = entityTransactions
            .filter((t) => t.type === 'expense')
            .reduce((sum, t) => sum + t.amount, 0) + totalCredits;
        // Balance = Work Done (Debt) - Paid (Negative means we overpaid, Positive means we owe)
        balance = totalWork - totalPaid;

    } else if (entityType === 'designer') {
        const entityOrders = orders.filter((o) => o.designerId === entityId);
        
        let calculatedWork = 0;
        entityOrders.forEach(o => {
            const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
            const isRelevant = o.workflowType === 'split' && ((o.status || '').toLowerCase() === 'delivered' || hasRejectionCost);

            if (isRelevant) {
                let price = hasRejectionCost ? o.rejectedLabCost! : (o.designPrice || 0);
                calculatedWork += price;
            }
        });
        totalWork = calculatedWork + totalCharges;

        // Expenses to designer
        totalPaid = entityTransactions
            .filter((t) => t.type === 'expense')
            .reduce((sum, t) => sum + t.amount, 0) + totalCredits;
        balance = totalWork - totalPaid;
    }

    // Initial dummy or fetched history (using transactions mixed with orders would be complex, just showing transactions for now)
    const recentTransactions = [...entityTransactions]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5);


    // Let's standardise: 
    // Doctor: Positive = He owes us. 
    // Supplier/Designer: Positive = We owe them.

    let balanceColor = 'text-gray-900';
    let balanceLabel = 'الرصيد الحالي';

    if (entityType === 'doctor') {
        if (balance > 0) {
            balanceColor = 'text-red-600'; // He owes us Money (Bad for him, Good for us? Usually Red in accounting means debt)
            // Actually for AR (Accounts Receivable), positive is an asset. But visually, 'Red' often implies 'Outstanding/Due'.
            balanceLabel = 'عليه (مدين)';
        } else if (balance < 0) {
            balanceColor = 'text-green-600'; // We owe him (Credit)
            balanceLabel = 'له (دائن)';
        } else {
            balanceLabel = 'خالص';
        }
    } else {
        // Supplier/Designer (Accounts Payable)
        if (balance > 0) {
            balanceColor = 'text-red-600'; // We owe them money (Liability)
            balanceLabel = 'له (دائن)';
        } else if (balance < 0) {
            balanceColor = 'text-green-600'; // We overpaid
            balanceLabel = 'عليه (مدين)';
        } else {
            balanceLabel = 'خالص';
        }
    }

    return (
        <div className={clsx("bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full", className)}>
            {/* Header */}
            <div className="bg-gradient-to-br from-gray-50 to-white p-6 border-b border-gray-100">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="font-bold text-lg text-gray-900">{entityName}</h3>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full border border-gray-200">
                            {entityType === 'doctor' ? 'طبيب' : entityType === 'supplier' ? 'مورد' : 'مصمم'}
                        </span>
                    </div>
                    <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center", balance > 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600")}>
                        <Wallet size={20} />
                    </div>
                </div>

                <div className="space-y-1">
                    <p className="text-sm text-gray-500 font-medium">{balanceLabel}</p>
                    <div className="flex items-baseline gap-1">
                        <span className={clsx("text-3xl font-bold tracking-tight", balanceColor)}>
                            {Math.abs(balance).toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-400 font-medium">{currencyLabel}</span>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 divide-x divide-x-reverse divide-gray-100 border-b border-gray-100">
                <div className="p-4 bg-gray-50/50">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                        <ArrowUpRight size={14} className="text-blue-500" />
                        إجمالي العمل
                    </p>
                    <p className="font-bold text-gray-900">{totalWork.toLocaleString()}</p>
                </div>
                <div className="p-4 bg-gray-50/50">
                    <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                        <ArrowDownLeft size={14} className="text-green-500" />
                        المدفوعات
                    </p>
                    <p className="font-bold text-gray-900">{totalPaid.toLocaleString()}</p>
                </div>
            </div>

            {/* Recent Transactions */}
            <div className="p-4 flex-1 bg-white">
                <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <History size={16} className="text-gray-400" />
                    آخر المعاملات
                </h4>

                <div className="space-y-3">
                    {recentTransactions.length > 0 ? (
                        recentTransactions.map((tx) => (
                            <div key={tx.id} className="flex items-center justify-between text-sm p-2 hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-100">
                                <div className="flex flex-col">
                                    <span className="font-medium text-gray-900">{tx.description}</span>
                                    <span className="text-xs text-gray-400">{new Date(tx.date).toLocaleDateString()}</span>
                                </div>
                                <span className={clsx("font-bold font-mono", tx.type === 'income' ? "text-green-600" : "text-red-600")}>
                                    {tx.type === 'income' ? '+' : '-'}{tx.amount.toLocaleString()}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-gray-400 text-sm">
                            لا توجد معاملات سابقة
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* aria-label placeholder */
