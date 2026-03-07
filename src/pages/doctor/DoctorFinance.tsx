/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { db, type Transaction, type Doctor } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui/Card';
import { Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

export default function DoctorFinance() {
    const { user } = useAuth();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [doctor, setDoctor] = useState<Doctor | null>(null);

    const [totalOrderCost, setTotalOrderCost] = useState(0);

    const [adjustments, setAdjustments] = useState<any[]>([]);

    useEffect(() => {
        const loadData = async () => {
            if (!user?.entityId) return;
            setLoading(true);
            try {
                const [txs, doc, cost, adjs] = await Promise.all([
                    db.getTransactions(),
                    db.getDoctor(user.entityId),
                    db.getDoctorTotalCost(user.entityId),
                    import('../../services/financeService').then(m => m.financeService.getAdjustments('doctor', user.entityId!))
                ]);

                // Filter for this doctor (Income Only from Transactions)
                const myTxs = txs.filter(t => t.entityId === user.entityId && t.entityType === 'doctor');
                // Sort by date desc
                myTxs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                setTransactions(myTxs);
                setDoctor(doc);
                setTotalOrderCost(cost);
                setAdjustments(adjs);
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [user?.entityId]);

    const calculateBalance = () => {
        const totalIncome = transactions
            .filter(t => t.type === 'income')
            .reduce((acc, curr) => acc + curr.amount, 0);

        const manualExpenses = transactions
            .filter(t => t.type === 'expense') // Should represent "Other Charges" if any exist in transactions? Usually transactions for doctor are income (payments). If there are expense transactions linked to doctor, they reduce his balance (charge).
            .reduce((acc, curr) => acc + curr.amount, 0);

        const totalCredits = adjustments
            .filter(a => a.type === 'credit')
            .reduce((acc, current) => acc + current.amount, 0);

        const totalCharges = adjustments
            .filter(a => a.type === 'charge')
            .reduce((acc, current) => acc + current.amount, 0);

        // Balance = (Income + Credits) - (Order Cost + Manual Expenses + Charges)
        return (totalIncome + totalCredits) - (totalOrderCost + manualExpenses + totalCharges);
    };

    const balance = calculateBalance();

    // Derived values for UI
    const manualExpenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = totalOrderCost + manualExpenses;

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">حسابي المالي</h1>
                {doctor && (
                    <div className="text-sm text-gray-500 font-bold bg-white px-3 py-1 rounded-full shadow-sm border border-gray-100">
                        {doctor.name} ({doctor.doctorCode})
                    </div>
                )}
            </div>

            {/* Balance Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-gradient-to-br from-blue-600 to-blue-800 text-white p-6 shadow-xl shadow-blue-500/20 border-none relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2 text-blue-100">
                            <Wallet size={20} />
                            <span className="font-bold">الرصيد الحالي</span>
                        </div>
                        <div className="text-4xl font-black tracking-tight mb-2 dir-ltr">
                            {Math.abs(balance).toLocaleString()} <span className="text-lg">EGP</span>
                        </div>
                        <div className={`text-sm font-bold px-2 py-1 rounded-lg inline-block ${balance >= 0 ? 'bg-green-500/20 text-green-100' : 'bg-red-500/20 text-red-100'}`}>
                            {balance >= 0 ? 'رصيد دائن (مدفوع مقدم)' : 'رصيد مدين (عليك)'}
                        </div>
                    </div>
                </Card>

                {/* Quick Stats */}
                <Card className="p-6 flex flex-col justify-center">
                    <span className="text-gray-500 text-sm font-bold flex items-center gap-2">
                        <ArrowUpRight size={16} className="text-green-500" /> إجمالي المدفوعات
                    </span>
                    <span className="text-2xl font-bold text-gray-800 mt-2">
                        {transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0).toLocaleString()} <span className="text-xs text-gray-400">EGP</span>
                    </span>
                </Card>

                <Card className="p-6 flex flex-col justify-center">
                    <span className="text-gray-500 text-sm font-bold flex items-center gap-2">
                        <ArrowDownLeft size={16} className="text-red-500" /> إجمالي التكلفة
                    </span>
                    <span className="text-2xl font-bold text-gray-800 mt-2">
                        {totalExpenses.toLocaleString()} <span className="text-xs text-gray-400">EGP</span>
                    </span>
                    {totalOrderCost > 0 && (
                        <div className="text-xs text-gray-400 mt-1 flex flex-col">
                            <span>أوردرات: {totalOrderCost.toLocaleString()}</span>
                            {manualExpenses > 0 && <span>أخرى: {manualExpenses.toLocaleString()}</span>}
                        </div>
                    )}
                </Card>
            </div>

            {/* Transactions List */}
            <Card className="overflow-hidden border border-gray-100 shadow-sm">
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <h3 className="font-bold text-gray-700">سجل المعاملات</h3>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-right">
                        <thead className="bg-white text-gray-500 text-xs uppercase font-bold sticky top-0 shadow-sm z-10">
                            <tr>
                                <th className="p-4 bg-gray-50">التاريخ</th>
                                <th className="p-4 bg-gray-50">النوع</th>
                                <th className="p-4 bg-gray-50">البيان</th>
                                <th className="p-4 bg-gray-50">القيمة</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
                            ) : transactions.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">لا توجد معاملات</td></tr>
                            ) : (
                                transactions.map(tx => (
                                    <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-4 text-sm text-gray-600 font-mono">{tx.date}</td>
                                        <td className="p-4">
                                            {tx.type === 'income' ? (
                                                <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">دفعة مالية</span>
                                            ) : (
                                                <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">تكلفة أوردر</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-sm text-gray-800 font-medium">
                                            {tx.description}
                                        </td>
                                        <td className={`p-4 font-bold ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                                            {tx.type === 'income' ? '+' : '-'}{tx.amount.toLocaleString()}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
