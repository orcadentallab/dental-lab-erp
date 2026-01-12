import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Doctor, type Supplier, type Order, type Transaction, type User } from '../services/db';
import { Printer, ArrowRight, Search, FileSpreadsheet } from 'lucide-react';
import clsx from 'clsx';
import { exportToExcel } from '../lib/exportUtils';

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
}

export default function Accounts() {
    const { user } = useAuth();
    const isLab = user?.role === 'lab';

    const [viewMode, setViewMode] = useState<'summary' | 'detail'>('summary');
    const [activeTab, setActiveTab] = useState<'doctors' | 'suppliers' | 'designers'>('doctors');
    const [selectedEntityId, setSelectedEntityId] = useState<string>('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

    // Options
    const [showInProgress, setShowInProgress] = useState(false);
    const [showAllOrders, setShowAllOrders] = useState(false);
    const [hideZeroBalance, setHideZeroBalance] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Data
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    // const [isLoading, setIsLoading] = useState(false); // Unused

    // Summary Data
    const [summaryData, setSummaryData] = useState<EntitySummary[]>([]);

    useEffect(() => {
        const loadData = async () => {

            try {
                const [docs, sups, ords, txs, users] = await Promise.all([
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getOrders(),
                    db.getTransactions(),
                    db.getUsers()
                ]);
                setDoctors(docs);
                setSuppliers(sups);
                setOrders(ords);
                setTransactions(txs);
                setDesigners(users.filter(u => u.role === 'designer'));
            } catch (error) {
                console.error('Error loading account data:', error);
            } finally {

            }
        };
        loadData();

        // Enforce Lab View
        if (isLab && user?.entityId) {
            setViewMode('detail');
            setActiveTab('suppliers');
            setSelectedEntityId(user.entityId);
        }
    }, [isLab, user]);

    // Helper: Calculate Summary for ALL
    useEffect(() => {
        if (viewMode !== 'summary') return;

        // Use state instead of db calls
        const allOrders = orders;
        const allTransactions = transactions;

        let summaries: EntitySummary[] = [];

        if (activeTab === 'doctors') {
            summaries = doctors.map(doc => {
                // Doctor Orders (Debit) - Show all if showAllOrders is enabled
                const docOrders = allOrders.filter(o =>
                    o.doctorId === doc.id &&
                    (showAllOrders || ['Delivered', 'Completed', 'Ready'].includes(o.status))
                );
                const totalDebit = docOrders.reduce((sum, o) => sum + o.totalPrice, 0);

                // Doctor Payments (Credit)
                const docTx = allTransactions.filter(t =>
                    t.entityType === 'doctor' && t.entityId === doc.id && t.type === 'income'
                );
                const totalCredit = docTx.reduce((sum, t) => sum + t.amount, 0);

                return {
                    id: doc.id,
                    name: doc.name,
                    totalOrders: docOrders.length,
                    totalDebit,
                    totalCredit,
                    balance: totalDebit - totalCredit // Positive = He owes us
                };
            });
        } else if (activeTab === 'suppliers') {
            summaries = suppliers.map(sup => {
                // Supplier Orders (Credit - We owe them) - Only count Delivered orders unless showAllOrders
                const supOrders = allOrders.filter(o => o.supplierId === sup.id && (showAllOrders || o.status === 'Delivered'));
                // Fix: Subtract designer price if split workflow
                const totalCredit = supOrders.reduce((sum, o) => {
                    let cost = o.cost || 0;
                    if (o.workflowType === 'split' && o.designPrice) {
                        cost -= o.designPrice;
                    }
                    return sum + cost;
                }, 0);

                // Supplier Payments (Debit - We paid them)
                const supTx = allTransactions.filter(t =>
                    t.entityType === 'supplier' && t.entityId === sup.id && t.type === 'expense'
                );
                const totalDebit = supTx.reduce((sum, t) => sum + t.amount, 0);

                return {
                    id: sup.id,
                    name: sup.name,
                    totalOrders: supOrders.length,
                    totalDebit, // We paid
                    totalCredit, // We owe check
                    balance: totalCredit - totalDebit // Positive = We owe them
                };
            });
        } else if (activeTab === 'designers') {
            // Fetch all designers (users with role designer)
            const allDesigners = designers;

            summaries = allDesigners.map(des => {
                // Designer Orders (Credit - We owe them) - Only count Delivered orders unless showAllOrders
                const desOrders = allOrders.filter(o => o.designerId === des.id && o.workflowType === 'split' && (showAllOrders || o.status === 'Delivered'));
                const totalCredit = desOrders.reduce((sum, o) => sum + (o.designPrice || 0), 0);

                // Designer Payments (Debit - We paid them)
                const desTx = allTransactions.filter(t =>
                    t.entityType === 'designer' && t.entityId === des.id && t.type === 'expense'
                );
                const totalDebit = desTx.reduce((sum, t) => sum + t.amount, 0);

                return {
                    id: des.id,
                    name: des.name,
                    totalOrders: desOrders.length,
                    totalDebit, // We paid
                    totalCredit, // We owe
                    balance: totalCredit - totalDebit // Positive = We owe them
                };
            });
        }
        setSummaryData(summaries);
    }, [viewMode, activeTab, doctors, suppliers, designers, orders, transactions, showAllOrders]);


    // Helper: Logic for Individual Statement
    const [individualStatement, setIndividualStatement] = useState<{ items: StatementItem[], totals: any }>({ items: [], totals: {} });

    useEffect(() => {
        if (viewMode === 'detail' && selectedEntityId) {
            const allOrders = orders;
            const allTransactions = transactions;
            let items: StatementItem[] = [];

            if (activeTab === 'doctors') {
                const docOrders = allOrders.filter(o => {
                    if (o.doctorId !== selectedEntityId) return false;
                    if (!showInProgress) return ['Delivered', 'Completed', 'Ready'].includes(o.status);
                    return true;
                });

                items = docOrders.map(o => ({
                    id: o.id,
                    date: o.deliveryDate || o.createdAt.split('T')[0],
                    description: `حالة #${o.caseId} - المريض: ${o.patientName}`,
                    details: o.items.map((i: any) => `${i.serviceType} (${i.teethNumbers.join(',')})`).join(' + '),
                    type: 'debit' as const,
                    amount: o.totalPrice,
                    status: o.status
                }));

                const docTx = allTransactions.filter(t => t.entityType === 'doctor' && t.entityId === selectedEntityId && t.type === 'income');
                items = [...items, ...docTx.map(t => ({
                    id: t.id,
                    date: t.date.split('T')[0],
                    description: `دفعة نقدية - ${t.description || ''}`,
                    type: 'credit' as const,
                    amount: t.amount
                }))];
            } else if (activeTab === 'suppliers') {
                // Only count Delivered orders for suppliers unless showAll is checked
                const supOrders = allOrders.filter(o => o.supplierId === selectedEntityId && (showAllOrders || o.status === 'Delivered'));
                items = supOrders.map(o => {
                    let cost = o.cost || 0;
                    if (o.workflowType === 'split' && o.designPrice) cost -= o.designPrice;
                    return {
                        id: o.id,
                        date: o.deliveryDate || o.createdAt.split('T')[0],
                        description: `طلب خارجي #${o.caseId} - ${o.patientName}`,
                        type: 'credit' as const,
                        amount: cost
                    };
                });

                const supTx = allTransactions.filter(t => t.entityType === 'supplier' && t.entityId === selectedEntityId && t.type === 'expense');
                items = [...items, ...supTx.map(t => ({
                    id: t.id,
                    date: t.date.split('T')[0],
                    description: `سداد للمورد - ${t.description || ''}`,
                    type: 'debit' as const,
                    amount: t.amount
                }))];
            } else if (activeTab === 'designers') {
                // Only count Delivered orders for designers unless showAll is checked
                const desOrders = allOrders.filter(o => o.designerId === selectedEntityId && o.workflowType === 'split' && (showAllOrders || o.status === 'Delivered'));
                items = desOrders.map(o => ({
                    id: o.id,
                    date: o.deliveryDate || o.createdAt.split('T')[0],
                    description: `تصميم #${o.caseId} - ${o.patientName}`,
                    type: 'credit' as const,
                    amount: o.designPrice || 0
                }));

                const desTx = allTransactions.filter(t => t.entityType === 'designer' && t.entityId === selectedEntityId && t.type === 'expense');
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

            setIndividualStatement({ items, totals: { totalDebit, totalCredit, balance } });
        }
    }, [viewMode, selectedEntityId, activeTab, showInProgress, dateRange, orders, transactions]);


    const handlePrint = () => window.print();

    // VIEW 1: SUMMARY TABLE
    if (viewMode === 'summary') {
        const filteredSummary = summaryData
            .filter(item => {
                if (hideZeroBalance && item.balance === 0) return false;
                if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
            });

        return (
            <div className="space-y-6">
                <div className="print:hidden flex flex-col gap-4 bg-white p-4 rounded-xl border border-gray-200">
                    <div className="flex justify-between items-center">
                        <div>
                            <h1 className="text-xl font-bold text-gray-800">إجمالي الحسابات</h1>
                            <p className="text-sm text-gray-500">ملخص أرصدة {activeTab === 'doctors' ? 'العملاء' : (activeTab === 'suppliers' ? 'الموردين' : 'المصممين')}</p>
                        </div>
                        <div className="flex gap-2">
                            {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                                <>
                                    <button
                                        onClick={() => {
                                            exportToExcel(
                                                filteredSummary.map(item => ({
                                                    'الاسم': item.name,
                                                    'عدد الطلبات': item.totalOrders,
                                                    'إجمالي المستحق': item.totalDebit,
                                                    'إجمالي المدفوع': item.totalCredit,
                                                    'الرصيد': item.balance
                                                })),
                                                `accounts_${activeTab}_${new Date().toISOString().split('T')[0]}`,
                                                activeTab === 'doctors' ? 'العملاء' : 'الموردين'
                                            );
                                        }}
                                        className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 text-sm font-medium"
                                    >
                                        <FileSpreadsheet size={16} />
                                        <span>Excel</span>
                                    </button>
                                    <button onClick={handlePrint} className="flex items-center gap-1.5 bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-900 text-sm font-medium">
                                        <Printer size={16} /> <span>طباعة</span>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 mt-4 border-t pt-4 border-gray-50">
                        {/* Filters */}
                        <div className="flex items-center gap-4">
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                <button onClick={() => setActiveTab('doctors')} className={clsx("px-4 py-2 rounded-md text-sm font-bold transition-all", activeTab === 'doctors' ? 'bg-white shadow text-blue-600' : 'text-gray-500')}>العملاء</button>
                                <button onClick={() => setActiveTab('suppliers')} className={clsx("px-4 py-2 rounded-md text-sm font-bold transition-all", activeTab === 'suppliers' ? 'bg-white shadow text-purple-600' : 'text-gray-500')}>الموردين</button>
                                <button onClick={() => setActiveTab('designers')} className={clsx("px-4 py-2 rounded-md text-sm font-bold transition-all", activeTab === 'designers' ? 'bg-white shadow text-pink-600' : 'text-gray-500')}>المصممين</button>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer bg-gray-50 px-3 py-2 rounded-lg border hover:bg-gray-100 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={hideZeroBalance}
                                    onChange={e => setHideZeroBalance(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded"
                                />
                                <span className="text-sm font-bold text-gray-700">إخفاء الأرصدة الصفرية (0)</span>
                            </label>

                            {/* Show All Orders Option - For All Tabs */}
                            <label className="flex items-center gap-2 cursor-pointer bg-purple-50 px-3 py-2 rounded-lg border border-purple-100 hover:bg-purple-100 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={showAllOrders}
                                    onChange={e => setShowAllOrders(e.target.checked)}
                                    className="w-4 h-4 text-purple-600 rounded"
                                />
                                <span className="text-sm font-bold text-purple-700">عرض كل الحالات (غير المنتهية)</span>
                            </label>
                        </div>

                        {/* Search / Statement Lookup */}
                        <div className="flex items-center gap-2 w-full md:w-auto">
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="بحث تصفية..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pr-10 pl-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-100 outline-none w-64"
                                />
                            </div>
                            <div className="h-8 w-px bg-gray-300 mx-2"></div>

                            {/* Quick Jump */}
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        setSelectedEntityId(e.target.value);
                                        setViewMode('detail');
                                        e.target.value = ''; // Reset
                                    }
                                }}
                                className="p-2 border border-blue-200 bg-blue-50 text-blue-800 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-100 outline-none min-w-[200px]"
                            >
                                <option value="">📄 هات كشف حساب لـ...</option>
                                {activeTab === 'doctors' && doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                {activeTab === 'suppliers' && suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                {activeTab === 'designers' && designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-lg min-h-[500px]">
                    {/* Print Header */}
                    <div className="hidden print:block text-center border-b pb-4 mb-6">
                        <img src="/orca-logo.png" alt="ORCA Lab" className="h-16 mx-auto mb-2" />
                        <h1 className="text-2xl font-bold mb-1">تقرير أرصدة {activeTab === 'doctors' ? 'العملاء والمستحقات' : (activeTab === 'suppliers' ? 'الموردين والمطالبات' : 'المصممين والمستحقات')}</h1>
                        <p className="text-gray-500 text-sm">التاريخ: {new Date().toLocaleDateString('ar-EG')}</p>
                    </div>

                    <table className="w-full text-right">
                        <thead className="bg-gray-50 text-gray-600 font-bold">
                            <tr>
                                <th className="p-4 rounded-r-lg">الاسم</th>
                                <th className="p-4">عدد الحالات</th>
                                <th className="p-4">{activeTab === 'doctors' ? 'إجمالي الشغل (Debit)' : 'إجمالي الشغل (Credit)'}</th>
                                <th className="p-4">{activeTab === 'doctors' ? 'إجمالي المدفوع (Credit)' : 'إجمالي المسدد (Debit)'}</th>
                                <th className="p-4 rounded-l-lg">الرصيد الحالي</th>
                                <th className="p-4 print:hidden">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredSummary.map(item => (
                                <tr key={item.id} className="hover:bg-blue-50 transition-colors group">
                                    <td className="p-4 font-bold text-gray-800">{item.name}</td>
                                    <td className="p-4 text-gray-600">{item.totalOrders}</td>
                                    <td className="p-4 font-medium">{activeTab === 'doctors' ? item.totalDebit.toLocaleString() : item.totalCredit.toLocaleString()}</td>
                                    <td className="p-4 font-medium">{activeTab === 'doctors' ? item.totalCredit.toLocaleString() : item.totalDebit.toLocaleString()}</td>
                                    <td className={clsx("p-4 font-bold dir-ltr", item.balance > 0 ? "text-red-600" : "text-green-600")}>
                                        {Math.abs(item.balance).toLocaleString()}
                                        <span className="text-xs font-normal text-gray-400 mr-1">
                                            {item.balance > 0
                                                ? (activeTab === 'doctors' ? '(عليه)' : '(له)')
                                                : (activeTab === 'doctors' ? '(له)' : '(عليه)')}
                                        </span>
                                    </td>
                                    <td className="p-4 print:hidden">
                                        <button
                                            onClick={() => { setSelectedEntityId(item.id); setViewMode('detail'); }}
                                            className="text-blue-600 hover:text-blue-800 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            عرض التفاصيل &larr;
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-100">
                            <tr>
                                <td className="p-4">الإجمالي الكلي</td>
                                <td className="p-4">{filteredSummary.reduce((s, i) => s + i.totalOrders, 0)}</td>
                                <td className="p-4">{filteredSummary.reduce((s, i) => s + (activeTab === 'doctors' ? i.totalDebit : i.totalCredit), 0).toLocaleString()}</td>
                                <td className="p-4">{filteredSummary.reduce((s, i) => s + (activeTab === 'doctors' ? i.totalCredit : i.totalDebit), 0).toLocaleString()}</td>
                                <td className={clsx("p-4 text-lg font-bold dir-ltr", filteredSummary.reduce((s, i) => s + i.balance, 0) > 0 ? "text-red-700" : "text-green-700")}>
                                    {Math.abs(filteredSummary.reduce((s, i) => s + i.balance, 0)).toLocaleString()} <span className="text-xs font-normal text-gray-500">
                                        {activeTab === 'doctors' ? 'إجمالي مستحقات المعمل' : 'إجمالي ديون المعمل'}
                                    </span>
                                </td>
                                <td className="print:hidden"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    }

    // VIEW 2: INDIVIDUAL DETAIL (Existing UI wrapped)
    return (
        <div className="space-y-6">
            {/* Header Controls - Hidden in Print */}
            <div className="print:hidden flex flex-col gap-6 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        {!isLab && (
                            <button onClick={() => setViewMode('summary')} className="p-2 hover:bg-gray-100 rounded-full transition-colors flex items-center gap-2 text-gray-600" title="عودة للقائمة">
                                <ArrowRight /> <span className="text-sm font-bold">عودة للملخص</span>
                            </button>
                        )}
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">كشف حساب تفصيلي</h1>
                            <p className="text-gray-500">
                                {activeTab === 'doctors'
                                    ? doctors.find(d => d.id === selectedEntityId)?.name
                                    : (activeTab === 'suppliers'
                                        ? suppliers.find(s => s.id === selectedEntityId)?.name
                                        : designers.find(u => u.id === selectedEntityId)?.name)
                                }
                            </p>
                        </div>
                    </div>
                    {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                        <button onClick={handlePrint} className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800">
                            <Printer size={18} /> <span>طباعة الكشف</span>
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap gap-4 items-end border-t border-gray-50 pt-4">
                    {/* Date Range */}
                    <div className="flex gap-2">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">من</label>
                            <input type="date" className="p-2 border border-gray-200 rounded-lg text-sm" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">إلى</label>
                            <input type="date" className="p-2 border border-gray-200 rounded-lg text-sm" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} />
                        </div>
                    </div>

                    {/* Filter Options for Orders */}
                    {activeTab === 'doctors' && (
                        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-100 rounded-lg">
                            <input type="checkbox" id="showInProgress" checked={showInProgress} onChange={(e) => setShowInProgress(e.target.checked)} className="w-4 h-4 text-blue-600 rounded cursor-pointer" />
                            <label htmlFor="showInProgress" className="text-sm font-medium text-blue-800 cursor-pointer">عرض "الجاري تنفيذه"</label>
                        </div>
                    )}
                </div>
            </div>

            {/* Statement Preview */}
            <div className="bg-white p-8 rounded-xl shadow-lg print:shadow-none print:p-0 min-h-[500px]">
                {/* Print Header */}
                <div className="hidden print:block text-center border-b pb-4 mb-6">
                    <img src="/orca-logo.png" alt="ORCA Lab" className="h-16 mx-auto mb-2" />
                    <h1 className="text-2xl font-bold mb-1">كشف حساب / Statement</h1>
                    <p className="text-gray-500 text-sm">تاريخ الطباعة: {new Date().toLocaleDateString('ar-EG')}</p>

                    {/* Date Range Display */}
                    {(dateRange.start || dateRange.end) && (
                        <p className="text-gray-800 font-bold mt-1 border border-gray-300 inline-block px-3 py-1 rounded bg-gray-50">
                            الفترة من: <span dir="ltr">{dateRange.start || 'البداية'}</span> إلى: <span dir="ltr">{dateRange.end || 'الآن'}</span>
                        </p>
                    )}

                    <h2 className="text-xl font-bold mt-2">
                        {activeTab === 'doctors'
                            ? doctors.find(d => d.id === selectedEntityId)?.name
                            : (activeTab === 'suppliers'
                                ? suppliers.find(s => s.id === selectedEntityId)?.name
                                : designers.find(u => u.id === selectedEntityId)?.name)
                        }
                    </h2>
                </div>

                <div className="flex justify-between items-start mb-8 print:hidden">
                    <div>
                        <h2 className="text-sm text-gray-500">الاسم</h2>
                        <h3 className="text-2xl font-bold text-gray-900">
                            {activeTab === 'doctors'
                                ? doctors.find(d => d.id === selectedEntityId)?.name
                                : (activeTab === 'suppliers'
                                    ? suppliers.find(s => s.id === selectedEntityId)?.name
                                    : designers.find(u => u.id === selectedEntityId)?.name)
                            }
                        </h3>
                    </div>
                    <div className="text-left bg-gray-50 p-4 rounded-lg">
                        <h2 className="text-sm text-gray-500 mb-1">الرصيد الحالي</h2>
                        <div className={clsx("text-3xl font-bold dir-ltr", individualStatement.totals.balance > 0 ? 'text-red-600' : 'text-green-600')}>
                            {Math.abs(individualStatement.totals.balance || 0).toLocaleString()} <span className="text-base font-normal text-gray-500">ج.م</span>
                            <span className="block text-xs font-normal mt-1 text-gray-400">
                                {individualStatement.totals.balance > 0
                                    ? (activeTab === 'doctors' ? ' (عليه - مطلوب سداده)' : ' (مستحق له)')
                                    : ' (خالص / مقدم)'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Individual Table */}
                <div className="overflow-hidden border border-gray-200 rounded-lg">
                    <table className="w-full text-sm text-right">
                        <thead className="bg-gray-50 text-gray-600 font-medium">
                            <tr>
                                <th className="p-3 border-b">التاريخ</th>
                                <th className="p-3 border-b w-1/2">البيان</th>
                                <th className="p-3 border-b">مدين</th>
                                <th className="p-3 border-b">دائن</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {individualStatement.items.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">لا توجد حركات</td></tr>
                            ) : (
                                individualStatement.items.map((item, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="p-3 whitespace-nowrap text-gray-500">{item.date}</td>
                                        <td className="p-3">
                                            <div className="font-medium text-gray-900">{item.description}</div>
                                            {item.details && <div className="text-xs text-blue-600 mt-1">{item.details}</div>}
                                            {item.status && showInProgress && <span className="text-[10px] bg-gray-100 px-1.5 rounded text-gray-500 mr-2">{item.status}</span>}
                                        </td>
                                        <td className="p-3 font-medium text-gray-700">{item.type === 'debit' ? item.amount.toLocaleString() : '-'}</td>
                                        <td className="p-3 font-medium text-gray-700">{item.type === 'credit' ? item.amount.toLocaleString() : '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        <tfoot className="bg-gray-50 font-bold text-gray-800">
                            <tr>
                                <td colSpan={2} className="p-3 text-left pl-8">الإجمالي</td>
                                <td className="p-3 text-red-600">{(individualStatement.totals.totalDebit || 0).toLocaleString()}</td>
                                <td className="p-3 text-green-600">{(individualStatement.totals.totalCredit || 0).toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}
