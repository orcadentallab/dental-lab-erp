import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Doctor, type Supplier, type Order, type Transaction, type User } from '../services/db';
import { Printer, ArrowRight, Search, FileSpreadsheet, Filter, Building2, User as UserIcon, Truck } from 'lucide-react';
import clsx from 'clsx';
import { exportToExcel, exportToExcelWithHeaders } from '../lib/exportUtils';

interface StatementItem {
    id: string;
    date: string;
    description: string;
    type: 'debit' | 'credit';
    amount: number;
    details?: string;
    status?: string;
}

interface EntitySummary {
    id: string;
    name: string;
    totalOrders: number;   // Count
    totalDebit: number;    // Money owed (Work)
    totalCredit: number;   // Money paid
    balance: number;
    code?: string; // Doctor Code
    lastTransaction?: string;
}

export default function Accounts() {
    const { user } = useAuth();
    const isLab = user?.role === 'lab';
    const isDesigner = user?.role === 'designer';

    const [viewMode, setViewMode] = useState<'summary' | 'detail'>(() => {
        if (isLab && user?.entityId) return 'detail';
        if (isDesigner && user?.id) return 'detail';
        return 'summary';
    });
    const [activeTab, setActiveTab] = useState<'doctors' | 'suppliers' | 'designers'>(() => {
        if (isLab && user?.entityId) return 'suppliers';
        if (isDesigner && user?.id) return 'designers';
        return 'doctors';
    });
    const [selectedEntityId, setSelectedEntityId] = useState<string>(() => {
        if (isLab && user?.entityId) return user.entityId;
        if (isDesigner && user?.id) return user.id;
        return '';
    });
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

    // Options
    const [showAllOrders] = useState(false);
    const [hideZeroBalance, setHideZeroBalance] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Data
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            // 1. Load Entities (Critical)
            try {
                const [docs, sups, users] = await Promise.all([
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers()
                ]);
                setDoctors(docs);
                setSuppliers(sups);
                setDesigners(users.filter(u => u.role === 'designer'));
            } catch (error: any) {
                console.error('Error loading entities:', error);
                setError(`فشل تحميل البيانات الأساسية: ${error.message || 'خطأ غير معروف'}`);
            }

            // 2. Load Financial Data (Heavy)
            try {
                const [ords, txs] = await Promise.all([
                    db.getAllOrdersUnpaginated(),
                    db.getTransactions()
                ]);
                setOrders(ords);
                setTransactions(txs);
            } catch (error: any) {
                console.error('Error loading financial data:', error);
                setError(`فشل تحميل البيانات المالية: ${error.message || 'خطأ غير معروف'}`);
            }
        };
        loadData();
    }, []);



    // Helper: Calculate Summary (Optimized O(N))
    const summaryData = useMemo(() => {
        if (viewMode !== 'summary') return [];

        const allOrders = orders;
        const allTransactions = transactions;

        // 1. Pre-aggregate Orders by Entity ID (O(Orders))
        const orderStats = new Map<string, { totalDebit: number; totalCredit: number; count: number; lastDate: string }>();
        const getStats = (id: string) => {
            if (!orderStats.has(id)) orderStats.set(id, { totalDebit: 0, totalCredit: 0, count: 0, lastDate: '' });
            return orderStats.get(id)!;
        };

        for (const o of allOrders) {
            if (activeTab === 'doctors' && o.doctorId) {
                if (o.status === 'Rejected') continue;
                // For doctors, we only care about delivered/completed for debit, but logic says:
                // debit = totalPrice if not rejected.
                // Actually original logic: if (activeTab === 'doctors') ... filter: (showAllOrders || status != Rejected) AND (showAll || ['Delivered'...].includes(status))
                // Then totalDebit = sum(totalPrice)

                // Let's match original logic EXACTLY but optimized.
                const isRelevant = (showAllOrders || o.status !== 'Rejected') &&
                    (showAllOrders || ['delivered', 'completed', 'ready'].includes((o.status || '').toLowerCase()));

                if (isRelevant) {
                    const stats = getStats(o.doctorId);
                    stats.count++;
                    stats.totalDebit += o.totalPrice || 0;
                    if (o.createdAt > stats.lastDate) stats.lastDate = o.createdAt;
                }
            } else if (activeTab === 'suppliers' && o.supplierId) {
                // Logic: status != Rejected AND (showAll || status == Delivered)
                const isRelevant = o.status !== 'Rejected' &&
                    (showAllOrders || (o.status || '').toLowerCase() === 'delivered');

                if (isRelevant) {
                    const stats = getStats(o.supplierId);
                    stats.count++;
                    let cost = o.cost || 0;
                    if (o.workflowType === 'split' && o.designPrice) cost -= o.designPrice;
                    stats.totalCredit += cost;
                    // Note: No date tracking in original supplier logic? Original code had lastTransaction: '' for suppliers.
                }
            } else if (activeTab === 'designers' && o.designerId) {
                // Logic: workflowType=split AND status!=Rejected AND (showAll || status == Delivered)
                const isRelevant = o.workflowType === 'split' &&
                    o.status !== 'Rejected' &&
                    (showAllOrders || (o.status || '').toLowerCase() === 'delivered');

                if (isRelevant) {
                    const stats = getStats(o.designerId);
                    stats.count++;
                    stats.totalCredit += (o.designPrice || 0);
                }
            }
        }

        // 2. Pre-aggregate Transactions by Entity ID (O(Transactions))
        const txStats = new Map<string, { totalDebit: number; totalCredit: number; lastDate: string }>();
        const getTxStats = (id: string) => {
            if (!txStats.has(id)) txStats.set(id, { totalDebit: 0, totalCredit: 0, lastDate: '' });
            return txStats.get(id)!;
        };

        for (const t of allTransactions) {
            if (activeTab === 'doctors' && t.entityType === 'doctor' && t.entityId && t.type === 'income') {
                const stats = getTxStats(t.entityId);
                stats.totalCredit += t.amount;
                if (t.date > stats.lastDate) stats.lastDate = t.date;
            } else if (activeTab === 'suppliers' && t.entityType === 'supplier' && t.entityId && t.type === 'expense') {
                const stats = getTxStats(t.entityId);
                stats.totalDebit += t.amount;
            } else if (activeTab === 'designers' && t.entityType === 'designer' && t.entityId && t.type === 'expense') {
                const stats = getTxStats(t.entityId);
                stats.totalDebit += t.amount;
            }
        }

        // 3. Map to Summaries (O(Entities))
        let entities: { id: string; name: string; code?: string }[] = [];
        if (activeTab === 'doctors') entities = doctors;
        else if (activeTab === 'suppliers') entities = suppliers;
        else if (activeTab === 'designers') entities = designers;

        return entities.map(entity => {
            const oStats = orderStats.get(entity.id) || { totalDebit: 0, totalCredit: 0, count: 0, lastDate: '' };
            const tStats = txStats.get(entity.id) || { totalDebit: 0, totalCredit: 0, lastDate: '' };

            let totalDebit = 0;
            let totalCredit = 0;
            let balance = 0;
            let lastTransaction = '';

            if (activeTab === 'doctors') {
                totalDebit = oStats.totalDebit;
                totalCredit = tStats.totalCredit;
                balance = totalDebit - totalCredit;
                lastTransaction = oStats.lastDate > tStats.lastDate ? oStats.lastDate : tStats.lastDate;
            } else if (activeTab === 'suppliers') {
                totalDebit = tStats.totalDebit; // We paid them
                totalCredit = oStats.totalCredit; // Cost of work
                // Balance = Credit (Work Cost) - Debit (Paid) -> If +, we owe them
                balance = totalCredit - totalDebit;
            } else if (activeTab === 'designers') {
                totalDebit = tStats.totalDebit; // We paid them
                totalCredit = oStats.totalCredit; // Work done
                balance = totalCredit - totalDebit;
            }

            return {
                id: entity.id,
                name: entity.name,
                code: entity.code,
                totalOrders: oStats.count,
                totalDebit,
                totalCredit,
                balance,
                lastTransaction
            };
        });

    }, [viewMode, activeTab, doctors, suppliers, designers, orders, transactions, showAllOrders]);

    // -- FETCH FULL DETAIL DATA ON SELECTION --
    // This ensures that when we print/view a statement, we have EVERYTHING, not just the truncated list.
    const [detailOrders, setDetailOrders] = useState<Order[]>([]);
    const [detailTransactions, setDetailTransactions] = useState<Transaction[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);

    useEffect(() => {
        if (viewMode === 'detail' && selectedEntityId) {
            setLoadingDetails(true);
            const typeMap: Record<string, 'doctor' | 'supplier' | 'designer'> = {
                doctors: 'doctor',
                suppliers: 'supplier',
                designers: 'designer'
            };

            db.fetchFullEntityStatement(selectedEntityId, typeMap[activeTab])
                .then(({ orders, transactions }) => {
                    setDetailOrders(orders);
                    setDetailTransactions(transactions);
                })
                .catch(err => console.error("Failed to load full statement:", err))
                .finally(() => setLoadingDetails(false));
        }
    }, [viewMode, selectedEntityId, activeTab]);

    // Helper: Logic for Individual Statement (Uses detail state if available, else falls back to global)
    const individualStatement = useMemo(() => {
        if (viewMode !== 'detail' || !selectedEntityId) return { items: [], totals: { totalDebit: 0, totalCredit: 0, balance: 0 } };

        // Use the dedicated Detail arrays if loaded, otherwise fallback to the global truncated list (temporary display)
        const relevantOrders = detailOrders.length > 0 ? detailOrders : orders;
        const relevantTransactions = detailTransactions.length > 0 ? detailTransactions : transactions;

        let items: StatementItem[] = [];

        if (activeTab === 'doctors') {
            const docOrders = relevantOrders.filter(o => {
                if (o.doctorId !== selectedEntityId) return false;
                if (o.status === 'Rejected') return true;
                if (showAllOrders) return true;
                return ['Delivered', 'Completed', 'Ready'].map(s => s.toLowerCase()).includes((o.status || '').toLowerCase());
            });

            items = docOrders.map(o => ({
                id: o.id,
                date: o.deliveryDate || o.createdAt.split('T')[0],
                description: `حالة #${o.caseId} - المريض: ${o.patientName}`,
                details: o.items.map((i: { serviceType: string; teethNumbers: string[] }) => `${i.serviceType} (${i.teethNumbers.join(',')})`).join(' + '),
                type: 'debit' as const,
                amount: o.status === 'Rejected' ? 0 : o.totalPrice,
                status: o.status
            }));

            const docTx = relevantTransactions.filter(t => t.entityType === 'doctor' && t.entityId === selectedEntityId && t.type === 'income');
            items = [...items, ...docTx.map(t => ({
                id: t.id,
                date: t.date.split('T')[0],
                description: `دفعة نقدية - ${t.description || ''}`,
                type: 'credit' as const,
                amount: t.amount
            }))];
        } else if (activeTab === 'suppliers') {
            const supOrders = relevantOrders.filter(o => o.supplierId === selectedEntityId && o.status !== 'Rejected' && (showAllOrders || o.status === 'Delivered'));
            items = supOrders.map(o => {
                let cost = o.cost || 0;
                if (o.workflowType === 'split' && o.designPrice) cost -= o.designPrice;
                return {
                    id: o.id,
                    date: o.deliveryDate || o.createdAt.split('T')[0],
                    description: `طلب خارجي #${o.caseId} - ${o.patientName} ${o.workflowType === 'split' ? '(خراطة فقط)' : ''}`,
                    type: 'credit' as const,
                    amount: cost
                };
            });

            const supTx = relevantTransactions.filter(t => t.entityType === 'supplier' && t.entityId === selectedEntityId && t.type === 'expense');
            items = [...items, ...supTx.map(t => ({
                id: t.id,
                date: t.date.split('T')[0],
                description: `سداد للمورد - ${t.description || ''}`,
                type: 'debit' as const,
                amount: t.amount
            }))];
        } else if (activeTab === 'designers') {
            const desOrders = relevantOrders.filter(o => o.designerId === selectedEntityId && o.workflowType === 'split' && o.status !== 'Rejected' && (showAllOrders || o.status === 'Delivered'));
            items = desOrders.map(o => ({
                id: o.id,
                date: o.deliveryDate || o.createdAt.split('T')[0],
                description: `تصميم #${o.caseId} - ${o.patientName}`,
                type: 'credit' as const,
                amount: o.designPrice || 0
            }));

            const desTx = relevantTransactions.filter(t => t.entityType === 'designer' && t.entityId === selectedEntityId && t.type === 'expense');
            items = [...items, ...desTx.map(t => ({
                id: t.id,
                date: t.date.split('T')[0],
                description: `سداد للمصمم - ${t.description || ''}`,
                type: 'debit' as const,
                amount: t.amount
            }))];
        }

        if (dateRange.start) items = items.filter(i => i.date >= dateRange.start);
        if (dateRange.end) items = items.filter(i => i.date <= dateRange.end);

        items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const totalDebit = items.filter(i => i.type === 'debit').reduce((sum, i) => sum + i.amount, 0);
        const totalCredit = items.filter(i => i.type === 'credit').reduce((sum, i) => sum + i.amount, 0);
        const balance = activeTab === 'doctors' ? totalDebit - totalCredit : totalCredit - totalDebit;

        return { items, totals: { totalDebit, totalCredit, balance } };
    }, [viewMode, selectedEntityId, activeTab, showAllOrders, dateRange, orders, transactions, detailOrders, detailTransactions]);


    const handlePrint = () => window.print();

    // -- RENDER HELPERS --

    const filteredSummary = summaryData.filter(item => {
        if (hideZeroBalance && item.balance === 0) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return item.name.toLowerCase().includes(q) || item.code?.toLowerCase().includes(q);
        }
        return true;
    });

    const totalEquity = filteredSummary.reduce((sum, item) => sum + item.balance, 0);

    // -- VIEW: SUMMARY GRID --
    if (viewMode === 'summary') {
        return (
            <div className="space-y-6">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative" role="alert">
                        <strong className="font-bold">تنبيه! </strong>
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}
                {/* Modern Pill Navigation */}
                <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
                    <nav className="flex bg-gray-100/50 p-1.5 rounded-xl w-full md:w-auto overflow-x-auto">
                        {([
                            { id: 'doctors', label: 'العملاء', icon: UserIcon },
                            { id: 'suppliers', label: 'الموردين', icon: Truck },
                            { id: 'designers', label: 'المصممين', icon: Building2 },
                        ] as const).filter(t => !(['suppliers', 'designers'].includes(t.id) && user?.role === 'representative')).map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={clsx(
                                    "px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-200 whitespace-nowrap",
                                    activeTab === tab.id
                                        ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5 scale-[1.02]"
                                        : "text-gray-500 hover:text-gray-900 hover:bg-white/50"
                                )}
                            >
                                <tab.icon size={18} />
                                {tab.label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="relative flex-1 md:flex-initial">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="بحث..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-4 pr-10 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 text-sm font-medium"
                            />
                        </div>
                        <button
                            onClick={() => setHideZeroBalance(!hideZeroBalance)}
                            className={clsx(
                                "p-2.5 rounded-xl border transition-all",
                                hideZeroBalance ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50"
                            )}
                            title="إخفاء الرصيد الصفري"
                            aria-label="Toggle zero balance visibility"
                        >
                            <Filter size={20} />
                        </button>
                        {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                            <button
                                onClick={() => {
                                    exportToExcel(
                                        filteredSummary.map(item => ({ 'الاسم': item.name, 'الرصيد': item.balance })),
                                        `accounts_${activeTab}`,
                                        activeTab
                                    );
                                }}
                                className="p-2.5 bg-green-50 text-green-600 border border-green-100 rounded-xl hover:bg-green-100 transition-colors"
                                title="تصدير إلى Excel"
                                aria-label="Export to Excel"
                            >
                                <FileSpreadsheet size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Dashboard Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-2xl text-white shadow-lg">
                        <p className="text-slate-400 text-sm font-medium mb-1">إجمالي الأرصدة ({activeTab === 'doctors' ? 'لنا' : 'علينا'})</p>
                        <h3 className="text-3xl font-bold tracking-tight">{Math.abs(totalEquity).toLocaleString()} <span className="text-sm font-normal text-slate-400">ج.م</span></h3>
                        <div className="mt-4 flex gap-2">
                            <span className={clsx("text-xs px-2 py-1 rounded-lg", totalEquity > 0 ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300")}>
                                {totalEquity > 0 ? (activeTab === 'doctors' ? 'مستحقات لنا' : 'ديون علينا') : 'رصيد إيجابي'}
                            </span>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                        <p className="text-gray-500 text-sm font-medium mb-1">عدد الحسابات النشطة</p>
                        <h3 className="text-3xl font-bold text-gray-800">{filteredSummary.filter(s => s.balance !== 0).length}</h3>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                        <p className="text-gray-500 text-sm font-medium mb-1">إجمالي الحركات</p>
                        <h3 className="text-3xl font-bold text-gray-800">{filteredSummary.reduce((sum, item) => sum + item.totalOrders, 0)}</h3>
                    </div>
                </div>

                {/* Modern Table View (Requested by User) */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-right">
                        <thead className="bg-gray-50/50 text-gray-500 font-medium text-xs uppercase tracking-wider border-b border-gray-100">
                            <tr>
                                <th className="p-4 w-16">#</th>
                                <th className="p-4">الاسم</th>
                                <th className="p-4">كود</th>
                                <th className="p-4">آخر نشاط</th>
                                <th className="p-4">إجمالي الحركات</th>
                                <th className="p-4">الرصيد الحالي</th>
                                <th className="p-4">الحالة</th>
                                <th className="p-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredSummary.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-gray-400">لا توجد حسابات مطابقة للبحث</td>
                                </tr>
                            ) : (
                                filteredSummary.map((item, idx) => (
                                    <tr
                                        key={item.id}
                                        onClick={() => { setSelectedEntityId(item.id); setViewMode('detail'); }}
                                        className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                                    >
                                        <td className="p-4 text-gray-400 font-mono text-sm">{idx + 1}</td>
                                        <td className="p-4 font-bold text-gray-800 flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                                                {item.name.charAt(0)}
                                            </div>
                                            {item.name}
                                        </td>
                                        <td className="p-4 text-gray-500 text-sm font-mono">{item.code || '-'}</td>
                                        <td className="p-4 text-gray-500 text-sm">
                                            {item.lastTransaction ? new Date(item.lastTransaction).toLocaleDateString('en-GB') : '-'}
                                        </td>
                                        <td className="p-4 text-gray-600 font-medium">{item.totalOrders}</td>
                                        <td className="p-4">
                                            <span className={clsx("font-bold font-mono tracking-tight", item.balance > 0 ? "text-rose-600" : (item.balance < 0 ? "text-emerald-600" : "text-gray-400"))}>
                                                {Math.abs(item.balance).toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={clsx("text-xs font-bold px-2 py-1 rounded-md", item.balance > 0 ? "bg-rose-50 text-rose-600" : (item.balance < 0 ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"))}>
                                                {item.balance === 0 ? 'خالص' : (item.balance > 0 ? (activeTab === 'doctors' ? 'مدين' : 'مستحق') : (activeTab === 'doctors' ? 'دائن' : 'مدفوع'))}
                                            </span>
                                        </td>
                                        <td className="p-4 text-left">
                                            <button className="text-gray-400 group-hover:text-blue-600 transition-colors" aria-label="View Details" title="عرض التفاصيل">
                                                <ArrowRight size={18} className="rtl:rotate-180" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    // -- VIEW: DETAIL STATEMENT --
    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Action Header */}
            <div className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-gray-100 print:hidden">
                <button onClick={() => setViewMode('summary')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 font-bold px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                    <ArrowRight size={20} />
                    <span>عودة للحسابات</span>
                </button>
                <div className="flex gap-2">
                    {/* Date Filters */}
                    <input
                        type="date"
                        value={dateRange.start}
                        onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="bg-gray-50 border-none rounded-xl text-sm"
                        aria-label="Start Date"
                        title="تاريخ البداية"
                    />
                    <input
                        type="date"
                        value={dateRange.end}
                        onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="bg-gray-50 border-none rounded-xl text-sm"
                        aria-label="End Date"
                        title="تاريخ النهاية"
                    />
                    <button
                        onClick={() => {
                            const fileName = `statement_${activeTab}_${selectedEntityId}_${new Date().toISOString().split('T')[0]}`;
                            exportToExcelWithHeaders(
                                individualStatement.items.map(i => ({
                                    date: i.date,
                                    description: i.description,
                                    debit: i.type === 'debit' ? i.amount : 0,
                                    credit: i.type === 'credit' ? i.amount : 0,
                                    details: i.details || ''
                                })),
                                {
                                    date: 'التاريخ',
                                    description: 'البيان',
                                    debit: 'مدين',
                                    credit: 'دائن',
                                    details: 'التفاصيل'
                                },
                                fileName
                            );
                        }}
                        className="bg-green-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-green-700 shadow-lg shadow-green-200"
                    >
                        <FileSpreadsheet size={18} /> تصدير
                    </button>
                    <button onClick={handlePrint} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 shadow-lg shadow-slate-200">
                        <Printer size={18} /> الطباعة
                    </button>

                    {/* Print Styles Fix */}
                    <style>{`
                        @media print {
                            @page { size: auto; margin: 10mm; }
                            
                            /* Reset Page Constraints */
                            html, body, #root {
                                height: auto !important;
                                min-height: 100% !important;
                                overflow: visible !important;
                                position: static !important;
                            }

                            /* Hide UI Elements */
                            body > *:not(#root) { display: none !important; } /* Hide ambient background */
                            nav, aside, .print\\:hidden { display: none !important; }

                            /* Reset Layout Containers (DashboardLayout) */
                            div[class*="flex h-screen"], 
                            div[class*="flex-1 flex flex-col"],
                            main {
                                display: block !important;
                                height: auto !important;
                                overflow: visible !important;
                                padding: 0 !important;
                                margin: 0 !important;
                            }

                            /* Ensure Content Visibility */
                            .max-w-5xl {
                                max-width: none !important;
                                margin: 0 !important;
                            }
                        }
                    `}</style>
                </div>
            </div>

            {/* Invoice/Statement Paper */}
            <div className="bg-white p-10 rounded-3xl shadow-xl border border-gray-100 min-h-[800px] print:shadow-none print:border-none print:p-0">
                {/* Letterhead */}
                <div className="flex justify-between items-start border-b-2 border-slate-100 pb-8 mb-8">
                    <div>
                        <img src="/orca-logo.png" alt="ORCA" className="h-16 mb-4" />
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">كشف حساب</h1>
                        <p className="text-slate-500 mt-1 font-medium bg-slate-50 inline-block px-3 py-1 rounded-lg">رقم مرجعي: #{selectedEntityId.slice(0, 8)}</p>
                    </div>
                    <div className="text-left space-y-1">
                        <h2 className="text-xl font-bold text-slate-800">
                            {activeTab === 'doctors'
                                ? doctors.find(d => d.id === selectedEntityId)?.name
                                : (activeTab === 'suppliers'
                                    ? suppliers.find(s => s.id === selectedEntityId)?.name
                                    : designers.find(u => u.id === selectedEntityId)?.name)
                            }
                        </h2>
                        <p className="text-slate-500 text-sm">
                            {activeTab === 'doctors' ? 'عميل (طبيب)' : (activeTab === 'suppliers' ? 'مورد خارجي' : 'مصمم')}
                        </p>
                        <div className="pt-4">
                            <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">تاريخ التقرير</p>
                            <p className="font-mono font-bold text-slate-700">{new Date().toLocaleDateString('ar-EG')}</p>
                        </div>
                    </div>
                </div>

                {/* Balance Hero */}
                <div className="bg-slate-50 rounded-2xl p-6 mb-8 flex justify-between items-center border border-slate-100">
                    <div>
                        <p className="text-slate-500 font-medium mb-1">الرصيد الحالي المستحق</p>
                        <p className="text-xs text-slate-400">حتى تاريخ اليوم</p>
                    </div>
                    <div className="text-right">
                        <h2 className={clsx("text-4xl font-black tracking-tight dir-ltr", individualStatement.totals.balance > 0 ? "text-rose-600" : "text-emerald-600")}>
                            {Math.abs(individualStatement.totals.balance).toLocaleString()} <span className="text-lg text-slate-400 font-normal">EGP</span>
                        </h2>
                        <p className="text-sm font-bold text-slate-500 mt-1">
                            {individualStatement.totals.balance > 0
                                ? (activeTab === 'doctors' ? 'مطلوب سداده' : 'مستحق له')
                                : (activeTab === 'doctors' ? 'دفعة مقدمة / له' : 'مدفوع مقدم')}
                        </p>
                    </div>
                </div>

                {/* Statement Table */}
                <table className="w-full text-right">
                    <thead className="bg-slate-900 text-white">
                        <tr>
                            <th className="p-4 rounded-tr-xl font-bold">المعاملة</th>
                            <th className="p-4 font-bold">التاريخ</th>
                            <th className="p-4 font-bold">مدين (Debit)</th>
                            <th className="p-4 rounded-tl-xl font-bold">دائن (Credit)</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {individualStatement.items.map((item, idx) => (
                            <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                <td className="p-4 max-w-md">
                                    <div className="font-bold text-slate-800">{item.description}</div>
                                    {item.details && <div className="text-slate-500 text-xs mt-1 truncate">{item.details}</div>}
                                    {item.status === 'Rejected' && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 mt-1">مرفوض</span>}
                                </td>
                                <td className="p-4 font-mono text-slate-600">{new Date(item.date).toLocaleDateString('en-GB')}</td>
                                <td className="p-4 font-mono font-bold text-slate-700">
                                    {item.type === 'debit' ? item.amount.toLocaleString() : '-'}
                                </td>
                                <td className="p-4 font-mono font-bold text-slate-700">
                                    {item.type === 'credit' ? item.amount.toLocaleString() : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200">
                        <tr>
                            <td colSpan={2} className="p-4 text-slate-600">الإجماليات</td>
                            <td className="p-4 text-rose-600">{individualStatement.totals.totalDebit.toLocaleString()}</td>
                            <td className="p-4 text-emerald-600">{individualStatement.totals.totalCredit.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>

                {/* Footer */}
                <div className="mt-12 text-center text-slate-400 text-xs border-t border-slate-100 pt-8">
                    <p>تم إنشاء هذا التقرير تلقائياً بواسطة نظام ORCA Dental Lab ERP</p>
                    <p className="mt-1">في حالة وجود استفسارات يرجى التواصل مع الإدارة المالية</p>
                </div>
            </div>
        </div>
    );
}
