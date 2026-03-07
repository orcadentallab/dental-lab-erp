/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import {
    FileText,
    FileSpreadsheet,
    Download
} from 'lucide-react';
import { type Order, type Transaction, type Doctor, type Supplier, type User, type Service } from '../../services/db';
import { exportToExcel } from '../../lib/exportUtils';
import clsx from 'clsx';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

interface StatementTabProps {
    type: 'service' | 'expense';
    orders: Partial<Order>[]; // Using Partial to support Account.tsx fallback logic
    transactions: Partial<Transaction>[];
    doctors: Doctor[];
    suppliers: Supplier[];
    designers: User[];
    services: Service[];
}

type TimeFilter = 'today' | 'week' | 'month' | 'current_month' | 'prev_month' | 'prev_prev_month' | '3months' | 'year' | 'all' | 'custom';

export default function StatementTab({
    type: targetType,
    orders,
    transactions,
    doctors,
    suppliers,
    designers,
    services
}: StatementTabProps) {
    const [selectedServiceId, setSelectedServiceId] = useState<string>('');
    const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
    const [selectedExpenseCategory, setSelectedExpenseCategory] = useState<string>('');

    // Time filtering
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });

    // Predefined Expense Categories - operational only (no supplier/designer payments)
    const expenseCategories = [
        'مرتبات وأجور',
        'دعايا وسوشيال ميديا',
        'شحن وتوصيل',
        'اجتماعات ونثريات',
        'خامات ومستهلكات',
        'مصروفات أخرى',
    ];

    // Categories to exclude from operational expense analysis
    const NON_OPERATIONAL_CATEGORIES = ['supplier_payment', 'designer_payment'];

    // Map of all known alternative category names to canonical names
    // This handles legacy data where categories were stored differently
    const CATEGORY_ALIASES: Record<string, string> = {
        'salaries': 'مرتبات وأجور',
        'مرتبات واجور': 'مرتبات وأجور',
        'shipping': 'شحن وتوصيل',
        'meetings': 'اجتماعات ونثريات',
        'material': 'خامات ومستهلكات',
        'other': 'مصروفات أخرى',
        'bonus': 'منحة/مكافأة',
        'deduction': 'خصم/جزاء',
    };

    // Normalize category name to its canonical form
    const normalizeCategory = (cat: string | undefined): string => {
        if (!cat) return 'أخرى';
        return CATEGORY_ALIASES[cat] || cat;
    };


    // Calculate Data based on filters
    const statementData = useMemo(() => {
        // Inline date range calculation to ensure reactivity with timeFilter state
        let start = '';
        let end = '';

        if (timeFilter === 'custom') {
            start = customDateRange.start;
            end = customDateRange.end;
        } else if (timeFilter !== 'all') {
            const today = new Date();
            const formatDate = (d: Date) => format(d, 'yyyy-MM-dd');

            let startDateStr = '';
            let endDateStr = formatDate(today);

            switch (timeFilter) {
                case 'today':
                    startDateStr = formatDate(today);
                    break;
                case 'week': {
                    const weekStart = new Date(today);
                    weekStart.setDate(today.getDate() - 7);
                    startDateStr = formatDate(weekStart);
                    break;
                }
                case 'month': { // Last 30 days
                    const monthAgo = new Date(today);
                    monthAgo.setDate(today.getDate() - 30);
                    startDateStr = formatDate(monthAgo);
                    break;
                }
                case 'current_month':
                    startDateStr = formatDate(startOfMonth(today));
                    endDateStr = formatDate(endOfMonth(today));
                    break;
                case 'prev_month': {
                    const prevDate = subMonths(today, 1);
                    startDateStr = formatDate(startOfMonth(prevDate));
                    endDateStr = formatDate(endOfMonth(prevDate));
                    break;
                }
                case 'prev_prev_month': {
                    const prevPrevDate = subMonths(today, 2);
                    startDateStr = formatDate(startOfMonth(prevPrevDate));
                    endDateStr = formatDate(endOfMonth(prevPrevDate));
                    break;
                }
                case '3months': {
                    const threeMonthsAgo = new Date(today);
                    threeMonthsAgo.setMonth(today.getMonth() - 3);
                    startDateStr = formatDate(threeMonthsAgo);
                    break;
                }
                case 'year': {
                    const yearStart = new Date(today.getFullYear(), 0, 1);
                    const yearEnd = new Date(today.getFullYear(), 11, 31);
                    startDateStr = formatDate(yearStart);
                    endDateStr = formatDate(yearEnd);
                    break;
                }
            }

            start = startDateStr;
            end = endDateStr;
        }
        // 'all' => start and end remain empty strings (no filter)

        const items: any[] = [];
        let totalAmount = 0;
        let totalCount = 0;

        // --- SERVICES STATEMENT ---
        if (targetType === 'service') {
            const filteredOrders = orders.filter(o => {
                // Must have items, must not be rejected or cancelled
                if (!o.items || (o.status as string) === 'Rejected' || (o.status as string) === 'Cancelled') return false;

                // Date filter
                const orderDate = o.deliveryDate || (o.createdAt || '').split('T')[0];
                if (start && orderDate < start) return false;
                if (end && orderDate > end) return false;

                // Doctor filter
                if (selectedDoctorId && o.doctorId !== selectedDoctorId) return false;

                // Service filter - Does this order contain the selected service?
                if (selectedServiceId) {
                    const hasService = (o.items as any[]).some(item => {
                        const srv = services.find(s => s.id === selectedServiceId);
                        return srv && item.serviceType === srv.name;
                    });
                    if (!hasService) return false;
                }

                return true;
            });

            // Extract Line Items
            filteredOrders.forEach(o => {
                const orderDate = o.deliveryDate || (o.createdAt || '').split('T')[0];
                const doctor = doctors.find(d => d.id === o.doctorId);

                (o.items as any[]).forEach(item => {
                    // If a specific service is selected, only show that service's items
                    const srv = services.find(s => s.id === selectedServiceId);
                    if (selectedServiceId && item.serviceType !== srv?.name) return;

                    const count = Array.isArray(item.teethNumbers) ? item.teethNumbers.length : 1;
                    const price = item.price || 0;

                    items.push({
                        id: `${o.caseId}-${item.serviceType}`,
                        date: orderDate,
                        caseId: o.caseId,
                        patientName: o.patientName,
                        doctorName: doctor?.name || 'غير معروف',
                        serviceName: item.serviceType,
                        teeth: Array.isArray(item.teethNumbers) ? item.teethNumbers.join(',') : '',
                        count: count,
                        unitPrice: price / count,
                        totalPrice: price
                    });

                    totalAmount += price;
                    totalCount += count;
                });
            });

            items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }
        // --- OPERATIONAL EXPENSES STATEMENT ---
        // Match Analytics RPC: Includes general expenses AND staff/representative salaries/expenses.
        // Excludes supplier/designer payments.
        else if (targetType === 'expense') {
            const filteredTx = transactions.filter(t => {
                if (t.type !== 'expense') return false;

                // Match Analytics RPC: Everything EXCEPT supplier, designer, and representative
                if (t.entityType === 'supplier' || t.entityType === 'designer' || t.entityType === 'representative') return false;

                // Exclude non-operational categories (supplier/designer payments stored as general)
                if (NON_OPERATIONAL_CATEGORIES.includes(t.category || '')) return false;

                // Exclude zero or negative amount transactions (invalid data)
                if (!t.amount || t.amount <= 0) return false;

                // Exclude rejected expenses (Analytics ignores rejected ones too in practice as they aren't real)
                if (t.status === 'rejected') return false;

                // Exclude transactions whose category looks like a caseId (starts with #)
                // These are data integrity issues from other workflows
                if ((t.category || '').startsWith('#')) return false;

                // For Operational Expenses, we filter by the financial period (effectiveDate)
                const txDate = (t.effectiveDate || t.date || '').split('T')[0];
                if (start && txDate < start) return false;
                if (end && txDate > end) return false;

                if (selectedExpenseCategory && normalizeCategory(t.category) !== selectedExpenseCategory) return false;

                return true;
            });

            filteredTx.forEach(t => {
                const txDate = (t.date || '').split('T')[0];
                let beneficiaryName = 'عام';

                if (t.entityType === 'representative') {
                    beneficiaryName = 'مندوب';
                }

                items.push({
                    id: t.id,
                    date: txDate,
                    category: normalizeCategory(t.category),
                    description: t.description || '',
                    beneficiary: beneficiaryName,
                    amount: t.amount || 0
                });

                totalAmount += (t.amount || 0);
                totalCount += 1;
            });

            items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }

        return {
            items,
            summary: {
                totalAmount,
                totalCount
            }
        };
    }, [orders, transactions, doctors, services, suppliers, designers, targetType, selectedServiceId, selectedDoctorId, selectedExpenseCategory, timeFilter, customDateRange]);


    const handleExportExcel = () => {
        if (!statementData.items.length) {
            alert('لا توجد بيانات للتصدير');
            return;
        }

        let exportData: any[] = [];
        let fileName = '';

        if (targetType === 'service') {
            exportData = statementData.items.map(i => ({
                'تاريخ التسليم': i.date,
                'رقم الحالة': i.caseId,
                'الطبيب': i.doctorName,
                'المريض': i.patientName,
                'الخدمة': i.serviceName,
                'الأسنان': i.teeth,
                'العدد': i.count,
                'المبلغ': i.totalPrice
            }));

            const serviceName = selectedServiceId ? services.find(s => s.id === selectedServiceId)?.name : 'كل_الخدمات';
            fileName = `كشف_حساب_خدمات_${serviceName}_${format(new Date(), 'yyyy-MM-dd')}`;
        } else {
            exportData = statementData.items.map(i => ({
                'التاريخ': i.date,
                'التصنيف': i.category,
                'المستفيد': i.beneficiary,
                'البيان': i.description,
                'المبلغ': i.amount
            }));

            const catName = selectedExpenseCategory || 'كل_المصروفات';
            fileName = `كشف_حساب_مصروفات_${catName}_${format(new Date(), 'yyyy-MM-dd')}`;
        }

        exportToExcel(exportData, fileName);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header & Filters */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex flex-col md:flex-row gap-6 mb-6">
                    <div className="flex-1">
                        <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
                            <FileText className="text-teal-600" />
                            كشوفات الحساب التحليلية
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            {targetType === 'service' ? 'تحليل مفصل للتشغيل (بالخدمات) لفترة محددة' : 'تحليل مفصل للمصروفات التشغيلية لفترة محددة'}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-50/50 rounded-xl border border-gray-100">

                    {/* Time Filter */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">الفترة الزمنية</label>
                        <select
                            aria-label="الفترة الزمنية"
                            value={timeFilter}
                            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
                            className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5"
                        >
                            <option value="today">اليوم</option>
                            <option value="week">آخر 7 أيام</option>
                            <option value="month">آخر 30 يوم</option>
                            <option value="current_month">{format(new Date(), 'MMMM')} (الشهر الحالي)</option>
                            <option value="prev_month">{format(subMonths(new Date(), 1), 'MMMM')} (الشهر السابق)</option>
                            <option value="prev_prev_month">{format(subMonths(new Date(), 2), 'MMMM')}</option>
                            <option value="3months">آخر 3 شهور</option>
                            <option value="year">هذا العام</option>
                            <option value="custom">فترة مخصصة...</option>
                            <option value="all">كل الأوقات</option>
                        </select>
                    </div>

                    {/* Custom Range (Conditional) */}
                    {timeFilter === 'custom' && (
                        <div className="space-y-2 col-span-1 lg:col-span-2">
                            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">اختر التاريخ (من - إلى)</label>
                            <div className="flex gap-2">
                                <input
                                    type="date"
                                    aria-label="تاريخ البداية"
                                    value={customDateRange.start}
                                    onChange={e => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                                    className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5"
                                />
                                <span className="self-center text-gray-400">-</span>
                                <input
                                    type="date"
                                    aria-label="تاريخ النهاية"
                                    value={customDateRange.end}
                                    onChange={e => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                                    className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5"
                                />
                            </div>
                        </div>
                    )}

                    {/* Dynamic Entity Filters based on Target */}
                    {targetType === 'service' ? (
                        <>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">الخدمة</label>
                                <select
                                    aria-label="الخدمة"
                                    value={selectedServiceId}
                                    onChange={(e) => setSelectedServiceId(e.target.value)}
                                    className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5"
                                >
                                    <option value="">جميع الخدمات</option>
                                    {services.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">الطبيب</label>
                                <select
                                    aria-label="الطبيب"
                                    value={selectedDoctorId}
                                    onChange={(e) => setSelectedDoctorId(e.target.value)}
                                    className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-teal-500 focus:border-teal-500 block p-2.5"
                                >
                                    <option value="">جميع الأطباء</option>
                                    {doctors.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">فئة المصروف</label>
                            <select
                                aria-label="فئة المصروف"
                                value={selectedExpenseCategory}
                                onChange={(e) => setSelectedExpenseCategory(e.target.value)}
                                className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg focus:ring-rose-500 focus:border-rose-500 block p-2.5"
                            >
                                <option value="">جميع المصروفات</option>
                                {expenseCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className={clsx("p-4 rounded-xl", targetType === 'service' ? "bg-teal-50 text-teal-600" : "bg-rose-50 text-rose-600")}>
                        <FileText size={28} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-medium mb-1">
                            {targetType === 'service' ? 'إجمالي عدد القطع / الوحدات' : 'إجمالي عدد العمليات'}
                        </p>
                        <h4 className="text-2xl font-black">{statementData.summary.totalCount.toLocaleString()}</h4>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className={clsx("p-4 rounded-xl", targetType === 'service' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600")}>
                        <FileSpreadsheet size={28} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-medium mb-1">إجمالي المبالغ</p>
                        <h4 className="text-2xl font-black">
                            {statementData.summary.totalAmount.toLocaleString()} <span className="text-sm font-normal text-gray-400">ج.م</span>
                        </h4>
                    </div>
                </div>
            </div>

            {/* Details Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        البيانات التفصيلية
                        <span className="bg-gray-200 text-gray-600 py-0.5 px-2 rounded-full text-xs">{statementData.items.length} حركة</span>
                    </h3>
                    <div className="flex gap-2">
                        <button
                            onClick={handleExportExcel}
                            className="bg-white border border-gray-200 text-gray-700 hover:bg-green-50 hover:text-green-700 hover:border-green-200 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
                        >
                            <Download size={16} />
                            تصدير Excel
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table key={`table-${targetType}`} className="w-full text-sm text-right">
                        <thead className="bg-gray-50/80 text-gray-500">
                            {targetType === 'service' ? (
                                <tr>
                                    <th className="p-4 font-medium">التاريخ</th>
                                    <th className="p-4 font-medium">الحالة</th>
                                    <th className="p-4 font-medium">الطبيب</th>
                                    <th className="p-4 font-medium">الخدمة</th>
                                    <th className="p-4 font-medium text-center">الأسنان</th>
                                    <th className="p-4 font-medium text-center">العدد</th>
                                    <th className="p-4 font-medium">الإجمالي</th>
                                </tr>
                            ) : (
                                <tr>
                                    <th className="p-4 font-medium">التاريخ</th>
                                    <th className="p-4 font-medium">التصنيف</th>
                                    <th className="p-4 font-medium">المستفيد</th>
                                    <th className="p-4 font-medium">البيان</th>
                                    <th className="p-4 font-medium">المبلغ</th>
                                </tr>
                            )}
                        </thead>
                        <tbody key={`tbody-${targetType}-${statementData.items.length}`} className="divide-y divide-gray-100">
                            {statementData.items.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-gray-400">
                                        لا توجد بيانات مطابقة للفلتر المحدد
                                    </td>
                                </tr>
                            ) : statementData.items.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                    {targetType === 'service' ? (
                                        <>
                                            <td className="p-4 text-gray-500 whitespace-nowrap">{new Date(item.date).toLocaleDateString()}</td>
                                            <td className="p-4 font-bold text-gray-700">#{item.caseId}</td>
                                            <td className="p-4 text-gray-800">{item.doctorName}</td>
                                            <td className="p-4 font-bold text-teal-600">{item.serviceName}</td>
                                            <td className="p-4 text-center text-gray-500 text-xs w-32 break-words">{item.teeth}</td>
                                            <td className="p-4 text-center font-bold">{item.count}</td>
                                            <td className="p-4 font-bold text-gray-900">{item.totalPrice.toLocaleString()}</td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="p-4 text-gray-500 whitespace-nowrap">{new Date(item.date).toLocaleDateString()}</td>
                                            <td className="p-4 font-bold text-gray-700">{item.category}</td>
                                            <td className="p-4 text-gray-800">{item.beneficiary}</td>
                                            <td className="p-4 text-gray-600">{item.description}</td>
                                            <td className="p-4 font-bold text-rose-600">{item.amount.toLocaleString()}</td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
