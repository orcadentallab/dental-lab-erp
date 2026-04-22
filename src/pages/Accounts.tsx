/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db, type Doctor, type Supplier, type Order, type Transaction, type User } from '../services/db';
import { Printer, ArrowRight, Search, FileSpreadsheet, Filter, Building2, User as UserIcon, Truck, Calendar, TrendingUp, TrendingDown, Wallet, ArrowUpDown, ChevronUp, ChevronDown, FileText, FileDown } from 'lucide-react';
import clsx from 'clsx';
import { exportToExcel, exportToExcelWithHeaders } from '../lib/exportUtils';
import { statementService, type StatementResult } from '../services/statementService';
import { generateDoctorStatementPDF, generateBulkStatementsPDF } from '../services/pdfService';
import { financeService, type Adjustment } from '../services/financeService';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import OrderForm from '../components/orders/OrderForm';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface StatementItem {
    id: string;
    date: string;
    description: string;
    type: 'debit' | 'credit' | 'opening';
    amount: number;
    details?: string;
    status?: string;
    runningBalance?: number;
    services?: string;
    count?: number;
    isHidden?: boolean;
}

// Time filter presets
type TimeFilter = 'week' | 'month' | '3months' | 'year' | 'all';

// Sorting
type SortField = 'name' | 'code' | 'totalOrders' | 'totalSales' | 'totalCredit' | 'balance';
type SortDirection = 'asc' | 'desc';

const getOrderStatementDate = (order: Partial<Order>) => (order.createdAt || '').split('T')[0];

const getDateRangeFromFilter = (filter: TimeFilter): { start: string; end: string } => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start = '';

    switch (filter) {
        case 'week': {
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            start = weekAgo.toISOString().split('T')[0];
            break;
        }
        case 'month': {
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            start = monthAgo.toISOString().split('T')[0];
            break;
        }
        case '3months': {
            const threeMonthsAgo = new Date(today);
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            start = threeMonthsAgo.toISOString().split('T')[0];
            break;
        }
        case 'year': {
            const yearAgo = new Date(today);
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);
            start = yearAgo.toISOString().split('T')[0];
            break;
        }
        case 'all':
        default:
            start = '';
            break;
    }

    return { start, end: filter === 'all' ? '' : end };
};

export default function Accounts() {
    const { user } = useAuth();
    const isLab = user?.role === 'lab';
    const isDesigner = user?.role === 'designer';
    const isRepresentative = user?.role === 'representative';

    const [searchParams, setSearchParams] = useSearchParams();

    const [viewMode, setViewMode] = useState<'summary' | 'detail' | 'rep-search'>(() => {
        const urlMode = searchParams.get('mode') as 'summary' | 'detail' | 'rep-search';
        if (urlMode) return urlMode;
        if (isRepresentative) return 'rep-search'; // Representatives see search-only view
        if (isLab && user?.entityId) return 'detail';
        if (isDesigner && user?.id) return 'detail';
        return 'summary';
    });
    const [activeTab, setActiveTab] = useState<'doctors' | 'suppliers' | 'designers'>(() => {
        const urlTab = searchParams.get('tab') as 'doctors' | 'suppliers' | 'designers';
        if (urlTab) return urlTab;
        if (isRepresentative) return 'doctors'; // Representatives only see doctors
        if (isLab && user?.entityId) return 'suppliers';
        if (isDesigner && user?.id) return 'designers';
        return 'doctors';
    });
    const [selectedEntityId, setSelectedEntityId] = useState<string>(() => {
        const urlEntity = searchParams.get('entity');
        if (urlEntity) return urlEntity;
        if (isLab && user?.entityId) return user.entityId;
        if (isDesigner && user?.id) return user.id;
        return '';
    });

    useEffect(() => {
        const newParams = new URLSearchParams(searchParams);
        if (viewMode !== 'summary') newParams.set('mode', viewMode);
        else newParams.delete('mode');

        newParams.set('tab', activeTab);

        if (selectedEntityId) newParams.set('entity', selectedEntityId);
        else newParams.delete('entity');

        setSearchParams(newParams, { replace: true });
    }, [viewMode, activeTab, selectedEntityId, setSearchParams]);

    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

    // Options
    const [showAllOrders, setShowAllOrders] = useState(false);
    const [hideZeroBalance, setHideZeroBalance] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statementSearch, setStatementSearch] = useState('');
    const [sortField, setSortField] = useState<SortField>('balance');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Data
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [orders, setOrders] = useState<Partial<Order>[]>([]);
    const [transactions, setTransactions] = useState<Partial<Transaction>[]>([]);
    const [designers, setDesigners] = useState<User[]>([]);
    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);

    // Permissions
    const canEditOrder = user?.role === 'admin' || !!user?.customPermissions?.edit_orders;

    // Handle time filter changes
    const handleTimeFilterChange = (filter: TimeFilter) => {
        setTimeFilter(filter);
        const range = getDateRangeFromFilter(filter);
        setDateRange(range);
    };

    const fetchData = async () => {
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
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'خطأ غير معروف';
            console.error('Error loading entities:', error);
            setError(`فشل تحميل البيانات الأساسية: ${errorMessage}`);
        }

        // 2. Load Financial Data (Heavy)
        try {
            const [ords, txs, adjs] = await Promise.all([
                db.getOrdersForFinanceSummary(),
                db.getTransactionsForFinanceSummary(),
                financeService.getAdjustments()
            ]);
            setOrders(ords);
            setTransactions(txs);
            setAdjustments(adjs);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'خطأ غير معروف';
            console.error('Error loading financial data:', error);
            setError(`فشل تحميل البيانات المالية: ${errorMessage}`);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleStatementRowClick = async (item: StatementItem) => {
        if (item.status && (item.description?.includes('حالة #') || item.description?.includes('#'))) {
            try {
                // Determine order ID using the case ID or item ID (item.id usually is the order ID)
                const fullOrder = await db.getOrder(item.id);
                if (fullOrder) {
                    setEditingOrder({ ...fullOrder, id: item.id });
                }
            } catch (err) {
                console.error('Error loading order details:', err);
            }
        }
    };

    const handleOrderSubmit = async (orderData: Omit<Order, 'id'>) => {
        if (!editingOrder) return;
        try {
            await db.updateOrder(editingOrder.id, orderData);
            setEditingOrder(null);
            fetchData();
        } catch (error) {
            console.error('Error updating order:', error);
        }
    };

    // -- BULK PRINT LOGIC --
    const [isGeneratingBulk, setIsGeneratingBulk] = useState(false);


    const handleBulkExport = async () => {
        if (activeTab !== 'doctors') return;
        setIsGeneratingBulk(true);

        try {
            const activeDoctors = filteredSummary;
            const results: StatementResult[] = [];

            for (const summaryItem of activeDoctors) {
                const doctor = doctors.find(d => d.id === summaryItem.id);
                if (!doctor) continue;

                const statement = statementService.calculateDoctorStatement(
                    doctor.id,
                    orders as Order[], // Cast as Order[] because calculateDoctorStatement expects full objects, but we only have partials here. 
                    // ideally statementService should also accept Partial, but for bulk export we usually want full data. 
                    // However, bulk export logic is currently using 'orders' state which is now Partial.
                    // FIX: For bulk export, we might need to fetch full data or ensure statementService is robust.
                    // For now, let's assume statementService only needs financial fields which are present.
                    transactions as Transaction[],
                    dateRange.start,
                    dateRange.end,
                    adjustments
                );

                statement.doctorName = doctor.name;
                statement.doctorCode = doctor.doctorCode;
                results.push(statement);
            }

            if (results.length === 0) {
                alert('لا توجد بيانات للتصدير');
                return;
            }

            // Always export as ZIP per user request
            await generateBulkStatementsPDF(
                results,
                dateRange,
                DEFAULT_LAB_INFO,
                'zip'
            );
        } catch (error) {
            console.error('Bulk export failed:', error);
            alert('فشل في تصدير الكشوفات.');
        } finally {
            setIsGeneratingBulk(false);
        }
    };



    // Helper: Calculate Summary (Optimized O(N))
    const summaryData = useMemo(() => {
        if (viewMode !== 'summary' && viewMode !== 'rep-search') return [];

        const allOrders = orders;
        const allTransactions = transactions;

        // 1. Pre-aggregate Orders by Entity ID (O(Orders))
        const orderStats = new Map<string, { totalDebit: number; totalCredit: number; count: number; lastDate: string; totalSales: number }>();
        const getStats = (id: string) => {
            if (!orderStats.has(id)) orderStats.set(id, { totalDebit: 0, totalCredit: 0, count: 0, lastDate: '', totalSales: 0 });
            return orderStats.get(id)!;
        };

        for (const o of allOrders) {
            if (activeTab === 'doctors' && o.doctorId) {
                const isRelevant = showAllOrders || ['delivered', 'completed', 'ready', 'cancelled', 'rejected'].includes((o.status || '').toLowerCase());

                if (isRelevant) {
                    const stats = getStats(o.doctorId);
                    stats.count++;
                    const amount = (o.status === 'Cancelled' || o.status === 'Rejected' ? 0 : (o.totalPrice || 0));
                    stats.totalDebit += amount;
                    stats.totalSales += amount;
                    if (o.createdAt && o.createdAt > stats.lastDate) stats.lastDate = o.createdAt;
                }
            } else if (activeTab === 'suppliers' && o.supplierId) {
                const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                const isRelevant = (o.status !== 'Rejected' || hasRejectionCost) &&
                    (showAllOrders || (o.status || '').toLowerCase() === 'delivered' || (o.status || '').toLowerCase() === 'cancelled' || hasRejectionCost);

                if (isRelevant) {
                    const stats = getStats(o.supplierId);
                    stats.count++;
                    let cost = (o.status === 'Cancelled' || o.status === 'Rejected' ? 0 : (o.cost || 0));
                    if (hasRejectionCost) cost = o.rejectedLabCost!;
                    if (o.workflowType === 'split' && o.designPrice && o.status !== 'Cancelled' && o.status !== 'Rejected' && !hasRejectionCost) cost -= o.designPrice;
                    stats.totalCredit += cost;
                    stats.totalSales += cost;
                }
            } else if (activeTab === 'designers' && o.designerId) {
                const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                const isRelevant = o.workflowType === 'split' &&
                    (o.status !== 'Rejected' || hasRejectionCost) &&
                    (showAllOrders || (o.status || '').toLowerCase() === 'delivered' || (o.status || '').toLowerCase() === 'cancelled' || hasRejectionCost);

                if (isRelevant) {
                    const stats = getStats(o.designerId);
                    stats.count++;
                    let price = (o.status === 'Cancelled' || o.status === 'Rejected' ? 0 : (o.designPrice || 0));
                    if (hasRejectionCost) price = o.rejectedLabCost!;
                    stats.totalCredit += price;
                    stats.totalSales += price;
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
                stats.totalCredit += (t.amount || 0);
                if (t.date && t.date > stats.lastDate) stats.lastDate = t.date;
            } else if (activeTab === 'suppliers' && t.entityType === 'supplier' && t.entityId && t.type === 'expense') {
                const stats = getTxStats(t.entityId);
                stats.totalDebit += (t.amount || 0);
            } else if (activeTab === 'designers' && t.entityType === 'designer' && t.entityId && t.type === 'expense') {
                const stats = getTxStats(t.entityId);
                stats.totalDebit += (t.amount || 0);
            }
        }

        // 2b. Pre-aggregate Adjustments by Entity ID
        for (const adj of adjustments) {
            if (activeTab === 'doctors' && adj.entity_type === 'doctor') {
                const stats = getStats(adj.entity_id);
                const txSt = getTxStats(adj.entity_id);
                if (adj.type === 'charge') {
                    stats.totalDebit += adj.amount;
                } else {
                    txSt.totalCredit += adj.amount;
                }
            } else if (activeTab === 'suppliers' && adj.entity_type === 'supplier') {
                const stats = getStats(adj.entity_id);
                const txSt = getTxStats(adj.entity_id);
                if (adj.type === 'charge') {
                    txSt.totalDebit += adj.amount;
                } else {
                    stats.totalCredit += adj.amount;
                }
            } else if (activeTab === 'designers' && adj.entity_type === 'designer') {
                const stats = getStats(adj.entity_id);
                const txSt = getTxStats(adj.entity_id);
                if (adj.type === 'charge') {
                    txSt.totalDebit += adj.amount;
                } else {
                    stats.totalCredit += adj.amount;
                }
            }
        }

        // 3. Map to Summaries (O(Entities))
        let entities: (Doctor | Supplier | User)[] = [];
        if (activeTab === 'doctors') entities = doctors.filter(d => !d.parentId);
        else if (activeTab === 'suppliers') entities = suppliers;
        else if (activeTab === 'designers') entities = designers;

        return entities.map(entity => {
            const oStats = orderStats.get(entity.id) || { totalDebit: 0, totalCredit: 0, count: 0, lastDate: '', totalSales: 0 };
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
                totalDebit = tStats.totalDebit;
                totalCredit = oStats.totalCredit;
                balance = totalCredit - totalDebit;
            } else if (activeTab === 'designers') {
                totalDebit = tStats.totalDebit;
                totalCredit = oStats.totalCredit;
                balance = totalCredit - totalDebit;
            }

            const code = activeTab === 'doctors' ? (entity as Doctor).doctorCode : undefined;

            return {
                id: entity.id,
                name: entity.name,
                code: code,
                totalOrders: oStats.count,
                totalSales: oStats.totalSales,
                totalDebit,
                totalCredit,
                balance,
                lastTransaction
            };
        });

    }, [viewMode, activeTab, doctors, suppliers, designers, orders, transactions, adjustments, showAllOrders]);

    // -- FETCH FULL DETAIL DATA ON SELECTION --
    const [detailOrders, setDetailOrders] = useState<Order[]>([]);
    const [detailTransactions, setDetailTransactions] = useState<Transaction[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [hiddenTransactionIds, setHiddenTransactionIds] = useState<Set<string>>(new Set());
    const [childDoctorFilter, setChildDoctorFilter] = useState('');
    const toggleTransactionVisibility = (id: string) => {
        setHiddenTransactionIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    useEffect(() => {
        if (viewMode === 'detail' && selectedEntityId) {
            setLoadingDetails(true);
            setHiddenTransactionIds(new Set());
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
                .finally(() => { setLoadingDetails(false); console.log('Details loaded', loadingDetails); });
        }
    }, [viewMode, selectedEntityId, activeTab]);

    useEffect(() => {
        setChildDoctorFilter('');
    }, [selectedEntityId, activeTab, viewMode]);

    // Calculate opening balance (balance before the filtered period)
    const calculateOpeningBalance = useMemo(() => {
        if (!dateRange.start || !selectedEntityId) return 0;

        const relevantOrders = detailOrders.length > 0 ? detailOrders : orders;
        const relevantTransactions = detailTransactions.length > 0 ? detailTransactions : transactions;

        let openingDebit = 0;
        let openingCredit = 0;

        if (activeTab === 'doctors') {
            // Orders before the period
            const beforeOrders = relevantOrders.filter(o => {
                if (o.doctorId !== selectedEntityId) return false;
                const orderDate = getOrderStatementDate(o);
                return orderDate < dateRange.start && o.status !== 'Rejected' &&
                    ['delivered', 'completed', 'ready'].includes((o.status || '').toLowerCase());
            });
            openingDebit = beforeOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

            // Transactions before the period
            const beforeTx = relevantTransactions.filter(t =>
                (t.entityType === 'doctor' || !t.entityType) &&
                t.entityId === selectedEntityId &&
                t.type === 'income' &&
                (t.date || '').split('T')[0] < dateRange.start
            );
            openingCredit = beforeTx.reduce((sum, t) => sum + (t.amount || 0), 0);

            // Adjustments before the period
            const beforeAdjs = adjustments.filter(a =>
                a.entity_type === 'doctor' &&
                a.entity_id === selectedEntityId &&
                a.date < dateRange.start
            );
            for (const adj of beforeAdjs) {
                if (adj.type === 'charge') openingDebit += adj.amount;
                else openingCredit += adj.amount;
            }

            return openingDebit - openingCredit;
        } else if (activeTab === 'suppliers') {
            const beforeOrders = relevantOrders.filter(o => {
                if (o.supplierId !== selectedEntityId) return false;
                const orderDate = getOrderStatementDate(o);
                return orderDate < dateRange.start && o.status !== 'Rejected' && o.status === 'Delivered';
            });
            openingCredit = beforeOrders.reduce((sum, o) => {
                let cost = o.cost || 0;
                if (o.workflowType === 'split' && o.designPrice) cost -= o.designPrice;
                return sum + cost;
            }, 0);

            const beforeTx = relevantTransactions.filter(t =>
                (t.entityType === 'supplier' || !t.entityType) &&
                t.entityId === selectedEntityId &&
                t.type === 'expense' &&
                (t.date || '').split('T')[0] < dateRange.start
            );
            openingDebit = beforeTx.reduce((sum, t) => sum + (t.amount || 0), 0);

            // Adjustments before the period
            const beforeAdjs = adjustments.filter(a =>
                a.entity_type === 'supplier' &&
                a.entity_id === selectedEntityId &&
                a.date < dateRange.start
            );
            for (const adj of beforeAdjs) {
                if (adj.type === 'charge') openingDebit += adj.amount;
                else openingCredit += adj.amount;
            }

            return openingCredit - openingDebit;
        } else if (activeTab === 'designers') {
            const beforeOrders = relevantOrders.filter(o => {
                if (o.designerId !== selectedEntityId) return false;
                const orderDate = getOrderStatementDate(o);
                return orderDate < dateRange.start && o.workflowType === 'split' && o.status !== 'Rejected' && o.status === 'Delivered';
            });
            openingCredit = beforeOrders.reduce((sum, o) => sum + (o.designPrice || 0), 0);

            const beforeTx = relevantTransactions.filter(t =>
                (t.entityType === 'designer' || !t.entityType) &&
                t.entityId === selectedEntityId &&
                t.type === 'expense' &&
                (t.date || '').split('T')[0] < dateRange.start
            );
            openingDebit = beforeTx.reduce((sum, t) => sum + (t.amount || 0), 0);

            // Adjustments before the period
            const beforeAdjs = adjustments.filter(a =>
                a.entity_type === 'designer' &&
                a.entity_id === selectedEntityId &&
                a.date < dateRange.start
            );
            for (const adj of beforeAdjs) {
                if (adj.type === 'charge') openingDebit += adj.amount;
                else openingCredit += adj.amount;
            }

            return openingCredit - openingDebit;
        }

        return 0;
    }, [dateRange.start, selectedEntityId, activeTab, detailOrders, detailTransactions, orders, transactions, adjustments, childDoctorFilter, doctors]);

    // Helper: Logic for Individual Statement
    const individualStatement = useMemo(() => {
        if (viewMode !== 'detail' || !selectedEntityId) return { items: [], totals: { totalDebit: 0, totalCredit: 0, balance: 0, openingBalance: 0 } };

        const relevantOrders = detailOrders.length > 0 ? detailOrders : orders;
        const relevantTransactions = detailTransactions.length > 0 ? detailTransactions : transactions;

        let items: StatementItem[] = [];

        if (activeTab === 'doctors') {
            const selectedIsCenter = !!doctors.find(d => d.id === selectedEntityId)?.isCenter;

            const docOrders = relevantOrders.filter(o => {
                // Match direct orders OR orders by child doctors of the selected center
                const isDirectOrder = o.doctorId === selectedEntityId;
                const isChildOrder = selectedIsCenter && o.doctorId &&
                    doctors.find(d => d.id === o.doctorId)?.parentId === selectedEntityId;
                if (!isDirectOrder && !isChildOrder) return false;
                // Apply child doctor filter if set
                if (childDoctorFilter && o.doctorId !== childDoctorFilter) return false;
                if (showAllOrders) return true;
                return ['Delivered', 'Completed', 'Ready', 'Cancelled', 'Rejected'].map(s => s.toLowerCase()).includes((o.status || '').toLowerCase());
            });

            items = docOrders.map(o => {
                const orderItems = o.items || [];
                const services = orderItems.map((i: { serviceType: string }) => i.serviceType).filter(Boolean).join(' + ');
                const count = orderItems.reduce((sum: number, i: { teethNumbers: string[] }) => sum + (Array.isArray(i.teethNumbers) ? i.teethNumbers.length : 1), 0);
                // If center, show child doctor name in description
                const childDoc = selectedIsCenter ? doctors.find(d => d.id === o.doctorId && d.parentId === selectedEntityId) : null;
                const doctorSuffix = childDoc ? ` (د. ${childDoc.name})` : '';
                return {
                    id: o.id || '',
                    date: getOrderStatementDate(o),
                    description: `حالة #${o.caseId} - المريض: ${o.patientName}${doctorSuffix}`,
                    details: orderItems.map((i: { serviceType: string; teethNumbers: string[] }) => `${i.serviceType} (${i.teethNumbers.join(',')})`).join(' + '),
                    type: 'debit' as const,
                    amount: (o.status === 'Cancelled' || o.status === 'Rejected' ? 0 : (o.totalPrice || 0)),
                    status: o.status,
                    services,
                    count
                };
            });

            const docTx = relevantTransactions.filter(t => {
                if (t.type !== 'income') return false;
                if (t.entityType !== 'doctor' && t.entityType) return false;
                // Direct match
                if (t.entityId === selectedEntityId) {
                    return !childDoctorFilter; // only show center-level tx when no child filter
                }
                // Child doctor tx for center
                if (selectedIsCenter && t.entityId &&
                    doctors.find(d => d.id === t.entityId)?.parentId === selectedEntityId) {
                    return !childDoctorFilter || t.entityId === childDoctorFilter;
                }
                return false;
            });
            items = [...items, ...docTx.map(t => ({
                id: t.id || '',
                date: (t.date || '').split('T')[0],
                description: `دفعة نقدية - ${t.description || ''} `,
                type: 'credit' as const,
                amount: t.amount || 0
            }))];
        } else if (activeTab === 'suppliers') {
            const supOrders = relevantOrders.filter(o => o.supplierId === selectedEntityId && (showAllOrders || o.status === 'Delivered' || o.status === 'Rejected' || o.status === 'Cancelled'));
            items = supOrders.map(o => {
                const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                let cost = o.cost || 0;
                if (o.workflowType === 'split' && o.designPrice && !hasRejectionCost) cost -= o.designPrice;

                // If Rejected or Cancelled, set cost to 0 (unless it has a rejection cost)
                if (o.status === 'Cancelled') cost = 0;
                else if (o.status === 'Rejected') {
                    cost = hasRejectionCost ? o.rejectedLabCost! : 0;
                }

                const orderItems = o.items || [];
                const services = orderItems.map((i: { serviceType: string }) => i.serviceType).filter(Boolean).join(' + ');
                const count = orderItems.reduce((sum: number, i: { teethNumbers: string[] }) => sum + (Array.isArray(i.teethNumbers) ? i.teethNumbers.length : 1), 0);

                return {
                    id: o.id || '',
                    date: getOrderStatementDate(o),
                    description: `#${o.caseId} - ${o.patientName} ${o.workflowType === 'split' ? '(خراطة فقط)' : ''}`,
                    type: 'credit' as const,
                    amount: cost,
                    status: o.status,
                    services,
                    count
                };
            });

            const supTx = relevantTransactions.filter(t =>
                (t.entityType === 'supplier' || !t.entityType) &&
                t.entityId === selectedEntityId &&
                t.type === 'expense'
            );
            items = [...items, ...supTx.map(t => ({
                id: t.id || '',
                date: (t.date || '').split('T')[0],
                description: `سداد للمورد - ${t.description || ''} `,
                type: 'debit' as const,
                amount: t.amount || 0
            }))];
        } else if (activeTab === 'designers') {
            const desOrders = relevantOrders.filter(o => o.designerId === selectedEntityId && o.workflowType === 'split' && (showAllOrders || o.status === 'Delivered' || o.status === 'Rejected' || o.status === 'Cancelled'));
            items = desOrders.map(o => {
                const hasRejectionCost = o.status === 'Rejected' && typeof o.rejectedLabCost === 'number';
                const orderItems = o.items || [];
                const services = orderItems.map((i: { serviceType: string }) => i.serviceType).filter(Boolean).join(' + ');
                const count = orderItems.reduce((sum: number, i: { teethNumbers: string[] }) => sum + (Array.isArray(i.teethNumbers) ? i.teethNumbers.length : 1), 0);
                
                let price = o.designPrice || 0;
                if (o.status === 'Cancelled') price = 0;
                else if (o.status === 'Rejected') {
                    price = hasRejectionCost ? o.rejectedLabCost! : 0;
                }

                return {
                    id: o.id || '',
                    date: getOrderStatementDate(o),
                    description: `تصميم #${o.caseId} - ${o.patientName}`,
                    type: 'credit' as const,
                    amount: price,
                    status: o.status,
                    services,
                    count
                };
            });

            const desTx = relevantTransactions.filter(t =>
                (t.entityType === 'designer' || !t.entityType) &&
                t.entityId === selectedEntityId &&
                t.type === 'expense'
            );
            items = [...items, ...desTx.map(t => ({
                id: t.id || '',
                date: (t.date || '').split('T')[0],
                description: `سداد للمصمم - ${t.description || ''} `,
                type: 'debit' as const,
                amount: t.amount || 0
            }))];
        }

        // Add Adjustments as statement items
        const entityTypeMap: Record<string, string> = { doctors: 'doctor', suppliers: 'supplier', designers: 'designer' };
        const entityAdjustments = adjustments.filter(a =>
            a.entity_type === entityTypeMap[activeTab] &&
            a.entity_id === selectedEntityId
        );
        items = [...items, ...entityAdjustments.map(adj => ({
            id: adj.id,
            date: adj.date,
            description: `تسوية - ${adj.reason || 'قيد محاسبي'}`,
            type: (activeTab === 'doctors'
                ? (adj.type === 'charge' ? 'debit' : 'credit')
                : (adj.type === 'charge' ? 'debit' : 'credit')
            ) as 'debit' | 'credit',
            amount: adj.amount
        }))];

        if (dateRange.start) items = items.filter(i => i.date >= dateRange.start);
        if (dateRange.end) items = items.filter(i => i.date <= dateRange.end);

        items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Calculate running balance
        let runningBalance = dateRange.start ? calculateOpeningBalance : 0;
        items = items.map(item => {
            const isHidden = hiddenTransactionIds.has(item.id);
            if (!isHidden) {
                if (activeTab === 'doctors') {
                    runningBalance += item.type === 'debit' ? item.amount : -item.amount;
                } else {
                    runningBalance += item.type === 'credit' ? item.amount : -item.amount;
                }
            }
            return { ...item, runningBalance: isHidden ? 0 : runningBalance, isHidden };
        });

        const visibleItems = items.filter(i => !i.isHidden);
        const totalDebit = visibleItems.filter(i => i.type === 'debit').reduce((sum, i) => sum + i.amount, 0);
        const totalCredit = visibleItems.filter(i => i.type === 'credit').reduce((sum, i) => sum + i.amount, 0);
        const periodBalance = activeTab === 'doctors' ? totalDebit - totalCredit : totalCredit - totalDebit;
        const finalBalance = (dateRange.start ? calculateOpeningBalance : 0) + periodBalance;

        return {
            items,
            totals: {
                totalDebit,
                totalCredit,
                balance: finalBalance,
                openingBalance: dateRange.start ? calculateOpeningBalance : 0
            }
        };
    }, [viewMode, selectedEntityId, activeTab, showAllOrders, dateRange, orders, transactions, adjustments, detailOrders, detailTransactions, calculateOpeningBalance, hiddenTransactionIds, childDoctorFilter]);


    const handlePrint = async () => {
        if (!selectedEntityId || !individualStatement) return;
        const entityName = getSelectedEntityName();
        const doctor = doctors.find(d => d.id === selectedEntityId);
        const filteredDoctor = childDoctorFilter ? doctors.find(d => d.id === childDoctorFilter) : undefined;

        const statementForPdf: StatementResult = {
            ...individualStatement,
            items: individualStatement.items.filter(i => !i.isHidden),
            doctorName: entityName,
            doctorCode: doctor?.doctorCode,
            filteredDoctorName: filteredDoctor?.name
        };

        await generateDoctorStatementPDF(statementForPdf, dateRange, DEFAULT_LAB_INFO, { print: true });
    };

    const handleExportStatementPDF = async () => {
        if (!selectedEntityId || !individualStatement) return;
        const entityName = getSelectedEntityName();
        const doctor = doctors.find(d => d.id === selectedEntityId);
        const filteredDoctor = childDoctorFilter ? doctors.find(d => d.id === childDoctorFilter) : undefined;

        const statementForPdf: StatementResult = {
            ...individualStatement,
            items: individualStatement.items.filter(i => !i.isHidden),
            doctorName: entityName,
            doctorCode: doctor?.doctorCode,
            filteredDoctorName: filteredDoctor?.name
        };

        await generateDoctorStatementPDF(statementForPdf, dateRange, DEFAULT_LAB_INFO);
    };

    // -- RENDER HELPERS --

    const filteredSummary = useMemo(() => {
        let result = summaryData.filter(item => {
            if (hideZeroBalance && item.balance === 0) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return item.name.toLowerCase().includes(q) || item.code?.toLowerCase().includes(q);
            }
            return true;
        });

        // Apply sorting
        result = [...result].sort((a, b) => {
            let aValue: string | number = 0;
            let bValue: string | number = 0;

            switch (sortField) {
                case 'name':
                    aValue = a.name.toLowerCase();
                    bValue = b.name.toLowerCase();
                    break;
                case 'code':
                    aValue = (a.code || '').toLowerCase();
                    bValue = (b.code || '').toLowerCase();
                    break;
                case 'totalOrders':
                    aValue = a.totalOrders;
                    bValue = b.totalOrders;
                    break;
                case 'totalSales':
                    aValue = a.totalSales;
                    bValue = b.totalSales;
                    break;
                case 'totalCredit':
                    aValue = a.totalCredit;
                    bValue = b.totalCredit;
                    break;
                case 'balance':
                    aValue = Math.abs(a.balance);
                    bValue = Math.abs(b.balance);
                    break;
            }

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                return sortDirection === 'asc'
                    ? aValue.localeCompare(bValue, 'ar')
                    : bValue.localeCompare(aValue, 'ar');
            }

            return sortDirection === 'asc'
                ? (aValue as number) - (bValue as number)
                : (bValue as number) - (aValue as number);
        });

        return result;
    }, [summaryData, hideZeroBalance, searchQuery, sortField, sortDirection]);

    // Handle sort
    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    // Sort indicator component
    const SortIndicator = ({ field }: { field: SortField }) => {
        if (sortField !== field) {
            return <ArrowUpDown size={14} className="text-gray-300 mr-1" />;
        }
        return sortDirection === 'asc'
            ? <ChevronUp size={14} className="text-blue-600 mr-1" />
            : <ChevronDown size={14} className="text-blue-600 mr-1" />;
    };

    const totalEquity = filteredSummary.reduce((sum, item) => sum + item.balance, 0);
    const totalSalesAmount = filteredSummary.reduce((sum, item) => sum + item.totalSales, 0);
    const totalPayments = filteredSummary.reduce((sum, item) => sum + (activeTab === 'doctors' ? item.totalCredit : item.totalDebit), 0);

    // Get selected entity name
    const getSelectedEntityName = () => {
        if (activeTab === 'doctors') return doctors.find(d => d.id === selectedEntityId)?.name;
        if (activeTab === 'suppliers') return suppliers.find(s => s.id === selectedEntityId)?.name;
        return designers.find(u => u.id === selectedEntityId)?.name;
    };

    // -- VIEW: REPRESENTATIVE SEARCH (No aggregated data) --
    if (viewMode === 'rep-search') {
        // Filter customers
        let repFilteredCustomers = summaryData.filter(item => {
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return item.name.toLowerCase().includes(q) || item.code?.toLowerCase().includes(q);
            }
            return true;
        });

        // Sort customers based on current sort settings
        repFilteredCustomers = [...repFilteredCustomers].sort((a, b) => {
            if (sortField === 'name') {
                const comparison = a.name.localeCompare(b.name, 'ar');
                return sortDirection === 'asc' ? comparison : -comparison;
            } else if (sortField === 'code') {
                const aCode = a.code || '';
                const bCode = b.code || '';
                const comparison = aCode.localeCompare(bCode, 'ar');
                return sortDirection === 'asc' ? comparison : -comparison;
            }
            return 0;
        });

        return (
            <div className="space-y-6">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl" role="alert">
                        <strong className="font-bold">تنبيه! </strong>
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}

                {/* Header */}
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                                <UserIcon className="text-blue-600" size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-800">العملاء</h2>
                                <p className="text-sm text-gray-500">البحث عن عميل لعرض كشف حسابه</p>
                            </div>
                        </div>

                        {/* Sort Buttons */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 hidden sm:inline">ترتيب:</span>
                            <button
                                onClick={() => {
                                    if (sortField === 'name') {
                                        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                    } else {
                                        setSortField('name');
                                        setSortDirection('asc');
                                    }
                                }}
                                className={clsx(
                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                                    sortField === 'name'
                                        ? "bg-blue-50 text-blue-600 border border-blue-200"
                                        : "bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"
                                )}
                            >
                                الاسم
                                {sortField === 'name' && (
                                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                )}
                            </button>
                            <button
                                onClick={() => {
                                    if (sortField === 'code') {
                                        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                    } else {
                                        setSortField('code');
                                        setSortDirection('asc');
                                    }
                                }}
                                className={clsx(
                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                                    sortField === 'code'
                                        ? "bg-blue-50 text-blue-600 border border-blue-200"
                                        : "bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"
                                )}
                            >
                                الكود
                                {sortField === 'code' && (
                                    sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="relative">
                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="بحث بالاسم أو الكود..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-300 text-sm font-medium transition-all"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Customer List - Simplified, no totals */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="divide-y divide-gray-50">
                        {repFilteredCustomers.length === 0 ? (
                            <div className="p-12 text-center text-gray-400">
                                <div className="flex flex-col items-center gap-2">
                                    <Search size={32} className="text-gray-300" />
                                    <span>لا توجد نتائج للبحث</span>
                                </div>
                            </div>
                        ) : (
                            repFilteredCustomers.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => { setSelectedEntityId(item.id); setViewMode('detail'); }}
                                    className="w-full flex items-center justify-between p-4 hover:bg-blue-50/50 transition-colors text-right"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center text-sm font-bold text-gray-500 border border-gray-200">
                                            {item.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-800">{item.name}</p>
                                            {item.code && <p className="text-xs text-gray-400 font-mono">{item.code}</p>}
                                        </div>
                                    </div>
                                    <ArrowRight size={18} className="text-gray-400 rtl:rotate-180" />
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // -- VIEW: SUMMARY GRID --
    if (viewMode === 'summary') {
        return (
            <div className="space-y-6">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl" role="alert">
                        <strong className="font-bold">تنبيه! </strong>
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}

                {/* Modern Navigation */}
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col lg:flex-row justify-between items-center gap-4">
                    <nav className="flex bg-gray-50 p-1.5 rounded-xl w-full lg:w-auto overflow-x-auto">
                        {([
                            { id: 'doctors', label: 'العملاء', icon: UserIcon },
                            { id: 'suppliers', label: 'الموردين', icon: Truck },
                            { id: 'designers', label: 'المصممين', icon: Building2 },
                        ] as const).filter(t => !(['suppliers', 'designers'].includes(t.id) && user?.role === 'representative')).map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={clsx(
                                    "px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-200 whitespace-nowrap",
                                    activeTab === tab.id
                                        ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                                        : "text-gray-500 hover:text-gray-900 hover:bg-white/50"
                                )}
                            >
                                <tab.icon size={18} />
                                {tab.label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex items-center gap-3 w-full lg:w-auto">
                        <div className="relative flex-1 lg:flex-initial lg:w-64">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="بحث بالاسم أو الكود..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-4 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-300 text-sm font-medium transition-all"
                            />
                        </div>
                        <button
                            onClick={() => setShowAllOrders(!showAllOrders)}
                            className={clsx(
                                "p-2.5 rounded-xl border transition-all flex items-center gap-2",
                                showAllOrders ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50"
                            )}
                            title="إظهار كل الطلبات (حتى غير المنتهية)"
                        >
                            <FileText size={18} />
                            <span className="hidden sm:inline text-sm font-medium">كل الطلبات</span>
                        </button>
                        <button
                            onClick={() => setHideZeroBalance(!hideZeroBalance)}
                            className={clsx(
                                "p-2.5 rounded-xl border transition-all flex items-center gap-2",
                                hideZeroBalance ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50"
                            )}
                            title="إخفاء الرصيد الصفري"
                            aria-label="Toggle zero balance visibility"
                        >
                            <Filter size={18} />
                            <span className="hidden sm:inline text-sm font-medium">إخفاء الصفري</span>
                        </button>
                        {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                            <button
                                onClick={() => {
                                    exportToExcel(
                                        filteredSummary.map(item => ({
                                            'الاسم': item.name,
                                            'الكود': item.code || '-',
                                            'عدد الطلبات': item.totalOrders,
                                            'إجمالي التعاملات': item.totalSales,
                                            'المدفوعات': item.totalCredit,
                                            'الرصيد': item.balance
                                        })),
                                        `accounts_${activeTab} `,
                                        activeTab
                                    );
                                }}
                                className="p-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl hover:bg-emerald-100 transition-colors flex items-center gap-2"
                                title="تصدير إلى Excel"
                                aria-label="Export to Excel"
                            >
                                <FileSpreadsheet size={18} />
                                <span className="hidden sm:inline text-sm font-medium">تصدير</span>
                            </button>
                        )}

                        {/* Bulk Print Button */}
                        {['admin', 'accountant'].includes(user?.role || '') && activeTab === 'doctors' && (
                            <button
                                onClick={handleBulkExport}
                                disabled={isGeneratingBulk}
                                className="p-2.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-xl hover:bg-blue-100 transition-colors flex items-center gap-2"
                                title="تصدير كشوفات الحساب مجمعة لكل العملاء الظاهرين"
                                aria-label="Bulk Export Statements"
                            >
                                <FileDown size={18} />
                                <span className="hidden sm:inline text-sm font-medium">{isGeneratingBulk ? 'جاري التحضير...' : 'تصدير مجمع'}</span>
                            </button>
                        )}
                    </div>
                </div>


                {/* Date Filters (For Bulk Export & View) */}
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Calendar className="text-gray-400" size={20} />
                        <span className="text-sm font-bold text-gray-700">فترة الكشف:</span>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl overflow-x-auto">
                        {([
                            { id: 'week', label: 'أسبوع' },
                            { id: 'month', label: 'شهر' },
                            { id: '3months', label: '3 شهور' },
                            { id: 'year', label: 'سنة' },
                            { id: 'all', label: 'الكل' },
                        ] as { id: TimeFilter; label: string }[]).map((filter) => (
                            <button
                                key={filter.id}
                                onClick={() => handleTimeFilterChange(filter.id)}
                                className={clsx(
                                    "px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
                                    timeFilter === filter.id
                                        ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                                        : "text-gray-500 hover:text-gray-900 hover:bg-white/50"
                                )}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>

                    {timeFilter === 'all' && (
                        <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
                            <span className="text-sm text-gray-500 font-medium px-2">تاريخ مخصص:</span>
                            <input
                                type="date"
                                value={dateRange.start}
                                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                className="bg-white border border-gray-200 rounded-lg text-sm px-2 py-1"
                                aria-label="Start Date"
                            />
                            <span className="text-gray-400">إلى</span>
                            <input
                                type="date"
                                value={dateRange.end}
                                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                className="bg-white border border-gray-200 rounded-lg text-sm px-2 py-1"
                                aria-label="End Date"
                            />
                        </div>
                    )}
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-2xl text-white shadow-lg">
                        <div className="flex items-center justify-between mb-3">
                            <Wallet className="text-slate-400" size={24} />
                            <span className={clsx("text-xs px-2 py-1 rounded-lg font-medium", totalEquity > 0 ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300")}>
                                {activeTab === 'doctors' ? (totalEquity > 0 ? 'مستحقات' : 'سلف') : (totalEquity > 0 ? 'مطلوب سداد' : 'مدفوع زيادة')}
                            </span>
                        </div>
                        <p className="text-slate-400 text-sm font-medium mb-1">إجمالي الأرصدة</p>
                        <h3 className="text-2xl font-bold tracking-tight">{Math.abs(totalEquity).toLocaleString()} <span className="text-sm font-normal text-slate-400">ج.م</span></h3>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <TrendingUp className="text-blue-500" size={24} />
                        </div>
                        <p className="text-gray-500 text-sm font-medium mb-1">إجمالي {activeTab === 'doctors' ? 'المبيعات' : 'المشتريات'}</p>
                        <h3 className="text-2xl font-bold text-gray-800">{totalSalesAmount.toLocaleString()} <span className="text-sm font-normal text-gray-400">ج.م</span></h3>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <TrendingDown className="text-emerald-500" size={24} />
                        </div>
                        <p className="text-gray-500 text-sm font-medium mb-1">إجمالي {activeTab === 'doctors' ? 'التحصيلات' : 'المدفوعات'}</p>
                        <h3 className="text-2xl font-bold text-gray-800">{totalPayments.toLocaleString()} <span className="text-sm font-normal text-gray-400">ج.م</span></h3>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <UserIcon className="text-gray-400" size={24} />
                        </div>
                        <p className="text-gray-500 text-sm font-medium mb-1">حسابات نشطة</p>
                        <h3 className="text-2xl font-bold text-gray-800">{filteredSummary.filter(s => s.balance !== 0).length} <span className="text-sm font-normal text-gray-400">من {filteredSummary.length}</span></h3>
                    </div>
                </div>

                {/* Data Table */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead className="bg-gray-50 text-gray-600 font-semibold text-sm border-b border-gray-100">
                                <tr>
                                    <th className="p-4 w-14">#</th>
                                    <th
                                        className="p-4 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                        onClick={() => handleSort('name')}
                                    >
                                        <div className="flex items-center gap-1">
                                            <SortIndicator field="name" />
                                            الاسم
                                        </div>
                                    </th>
                                    {activeTab === 'doctors' && (
                                        <th
                                            className="p-4 w-24 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                            onClick={() => handleSort('code')}
                                        >
                                            <div className="flex items-center gap-1">
                                                <SortIndicator field="code" />
                                                الكود
                                            </div>
                                        </th>
                                    )}
                                    <th
                                        className="p-4 w-28 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                        onClick={() => handleSort('totalOrders')}
                                    >
                                        <div className="flex items-center gap-1">
                                            <SortIndicator field="totalOrders" />
                                            الطلبات
                                        </div>
                                    </th>
                                    <th
                                        className="p-4 w-36 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                        onClick={() => handleSort('totalSales')}
                                    >
                                        <div className="flex items-center gap-1">
                                            <SortIndicator field="totalSales" />
                                            {activeTab === 'doctors' ? 'إجمالي المبيعات' : 'إجمالي التعاملات'}
                                        </div>
                                    </th>
                                    <th
                                        className="p-4 w-36 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                        onClick={() => handleSort('totalCredit')}
                                    >
                                        <div className="flex items-center gap-1">
                                            <SortIndicator field="totalCredit" />
                                            {activeTab === 'doctors' ? 'المحصل' : 'المدفوع'}
                                        </div>
                                    </th>
                                    <th
                                        className="p-4 w-32 cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                        onClick={() => handleSort('balance')}
                                    >
                                        <div className="flex items-center gap-1">
                                            <SortIndicator field="balance" />
                                            الرصيد
                                        </div>
                                    </th>
                                    <th className="p-4 w-24">الحالة</th>
                                    <th className="p-4 w-14"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredSummary.length === 0 ? (
                                    <tr>
                                        <td colSpan={activeTab === 'doctors' ? 9 : 8} className="p-12 text-center text-gray-400">
                                            <div className="flex flex-col items-center gap-2">
                                                <Search size={32} className="text-gray-300" />
                                                <span>لا توجد حسابات مطابقة للبحث</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredSummary.map((item, idx) => (
                                        <tr
                                            key={item.id}
                                            onClick={() => { setSelectedEntityId(item.id); setViewMode('detail'); }}
                                            className="hover:bg-blue-50/50 transition-colors cursor-pointer group"
                                        >
                                            <td className="p-4 text-gray-400 font-mono text-sm">{idx + 1}</td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center text-sm font-bold text-gray-500 group-hover:from-blue-100 group-hover:to-blue-50 group-hover:text-blue-600 transition-all border border-gray-200 group-hover:border-blue-200">
                                                        {item.name.charAt(0)}
                                                    </div>
                                                    <span className="font-bold text-gray-800">{item.name}</span>
                                                </div>
                                            </td>
                                            {activeTab === 'doctors' && <td className="p-4 text-gray-500 text-sm font-mono">{item.code || '-'}</td>}
                                            <td className="p-4 text-gray-600 font-medium">{item.totalOrders}</td>
                                            <td className="p-4 font-bold text-gray-700">{item.totalSales.toLocaleString()}</td>
                                            <td className="p-4 font-medium text-emerald-600">{(activeTab === 'doctors' ? item.totalCredit : item.totalDebit).toLocaleString()}</td>
                                            <td className="p-4">
                                                <span className={clsx("font-bold font-mono text-lg", item.balance > 0 ? "text-rose-600" : (item.balance < 0 ? "text-emerald-600" : "text-gray-400"))}>
                                                    {Math.abs(item.balance).toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={clsx("text-xs font-bold px-2.5 py-1.5 rounded-lg", item.balance > 0 ? "bg-rose-50 text-rose-600 border border-rose-100" : (item.balance < 0 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-gray-100 text-gray-500 border border-gray-200"))}>
                                                    {item.balance === 0 ? 'خالص' : (item.balance > 0 ? (activeTab === 'doctors' ? 'مدين' : 'مستحق') : (activeTab === 'doctors' ? 'دائن' : 'مدفوع'))}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <button className="text-gray-400 group-hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-blue-100" aria-label="View Details" title="عرض كشف الحساب">
                                                    <ArrowRight size={18} className="rtl:rotate-180" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                            {filteredSummary.length > 0 && (
                                <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-200">
                                    <tr>
                                        <td colSpan={activeTab === 'doctors' ? 4 : 3} className="p-4 text-gray-600">الإجمالي</td>
                                        <td className="p-4 text-gray-800">{totalSalesAmount.toLocaleString()}</td>
                                        <td className="p-4 text-emerald-600">{totalPayments.toLocaleString()}</td>
                                        <td className="p-4">
                                            <span className={clsx("font-mono text-lg", totalEquity > 0 ? "text-rose-600" : "text-emerald-600")}>
                                                {Math.abs(totalEquity).toLocaleString()}
                                            </span>
                                        </td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            </div >
        );
    }

    // -- VIEW: DETAIL STATEMENT --
    return (
        <div className="space-y-4 max-w-5xl mx-auto">
            {/* Print Styles */}
            <style>{`
@media print {
    @page {
        size: A4;
        margin: 15mm 10mm;
    }

    html, body, #root {
        height: auto!important;
        min - height: 100 % !important;
        overflow: visible!important;
        background: white!important;
    }

    body > *: not(#root) { display: none!important; }
    nav, aside, header, .print - hidden { display: none!important; }

    div[class*= "flex h-screen"],
        div[class*= "flex-1 flex flex-col"],
        main {
        display: block!important;
        height: auto!important;
        overflow: visible!important;
        padding: 0!important;
        margin: 0!important;
        background: white!important;
    }

                    .max - w - 5xl {
        max - width: none!important;
        margin: 0!important;
        padding: 0!important;
    }

                    .print - container {
        background: white!important;
        box - shadow: none!important;
        border: none!important;
        border - radius: 0!important;
        padding: 0!important;
    }

                    table {
        font - size: 11px!important;
        page -break-inside: avoid;
    }

                    thead {
        background: #1e293b!important;
        -webkit - print - color - adjust: exact;
        print - color - adjust: exact;
    }

                    tfoot {
        background: #f1f5f9!important;
        -webkit - print - color - adjust: exact;
        print - color - adjust: exact;
    }

                    tr {
        page -break-inside: avoid;
    }

                    .print - header {
        border - bottom: 2px solid #e2e8f0!important;
        padding - bottom: 16px!important;
        margin - bottom: 16px!important;
    }

                    .print - summary {
        background: #f8fafc!important;
        border: 1px solid #e2e8f0!important;
        -webkit - print - color - adjust: exact;
        print - color - adjust: exact;
    }
}
`}</style>

            {/* Action Header - Hidden in Print */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-gray-100 gap-4 print-hidden">
                {/* Hide back button for lab/designer - they can only see their own account */}
                {!isLab && !isDesigner ? (
                    <button onClick={() => setViewMode(isRepresentative ? 'rep-search' : 'summary')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 font-bold px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                        <ArrowRight size={20} />
                        <span>عودة للعملاء</span>
                    </button>
                ) : (
                    <div className="flex items-center gap-2 text-gray-600 font-bold px-4 py-2">
                        <Wallet size={20} className="text-blue-600" />
                        <span>كشف حسابي</span>
                    </div>
                )}

                {/* Time Filter Pills */}
                <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl overflow-x-auto">
                    {([
                        { id: 'week', label: 'أسبوع' },
                        { id: 'month', label: 'شهر' },
                        { id: '3months', label: '3 شهور' },
                        { id: 'year', label: 'سنة' },
                        { id: 'all', label: 'الكل' },
                    ] as { id: TimeFilter; label: string }[]).map((filter) => (
                        <button
                            key={filter.id}
                            onClick={() => handleTimeFilterChange(filter.id)}
                            className={clsx(
                                "px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
                                timeFilter === filter.id
                                    ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                                    : "text-gray-500 hover:text-gray-900 hover:bg-white/50"
                            )}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowAllOrders(!showAllOrders)}
                        className={clsx(
                            "px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-sm border print-hidden",
                            showAllOrders
                                ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-blue-200"
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        )}
                        title="إظهار كل الطلبات (حتى غير المنتهية)"
                    >
                        <FileText size={18} />
                        <span className="hidden sm:inline">الكل</span>
                    </button>
                    <button
                        onClick={() => {
                            const fileName = `statement_${activeTab}_${selectedEntityId}_${new Date().toISOString().split('T')[0]} `;
                            const exportData = [];

                            // Add opening balance row if applicable
                            if (dateRange.start && individualStatement.totals.openingBalance !== 0) {
                                exportData.push({
                                    date: dateRange.start,
                                    description: 'رصيد سابق',
                                    services: '',
                                    count: '',
                                    debit: individualStatement.totals.openingBalance > 0 ? individualStatement.totals.openingBalance : 0,
                                    credit: individualStatement.totals.openingBalance < 0 ? Math.abs(individualStatement.totals.openingBalance) : 0,
                                    runningBalance: individualStatement.totals.openingBalance,
                                    details: 'الرصيد المرحل من الفترة السابقة',
                                    status: ''
                                });
                            }

                            // Add statement items
                            exportData.push(...individualStatement.items.filter(i => !i.isHidden).map(i => ({
                                date: i.date,
                                description: i.description,
                                services: i.services || '',
                                count: i.count || '',
                                debit: i.type === 'debit' ? i.amount : 0,
                                credit: i.type === 'credit' ? i.amount : 0,
                                runningBalance: i.runningBalance || 0,
                                details: i.details || '',
                                status: i.status === 'Cancelled' ? 'ملغي' : i.status === 'Rejected' ? 'مرفوض' : ''
                            })));

                            exportToExcelWithHeaders(
                                exportData,
                                {
                                    date: 'تاريخ الاستلام',
                                    description: 'البيان',
                                    services: 'الخدمات',
                                    count: 'العدد',
                                    debit: 'مدين',
                                    credit: 'دائن',
                                    runningBalance: 'الرصيد',
                                    details: 'التفاصيل',
                                    status: 'الحالة'
                                },
                                fileName
                            );
                        }}
                        className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
                    >
                        <FileSpreadsheet size={18} /> تصدير
                    </button>
                    <button onClick={handlePrint} className="bg-slate-800 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-900 shadow-lg shadow-slate-200 transition-all">
                        <Printer size={18} /> طباعة
                    </button>
                    <button onClick={handleExportStatementPDF} className="bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all">
                        <FileDown size={18} /> PDF
                    </button>
                </div>
            </div>

            {/* Custom Date Range (shown when not using presets) */}
            {timeFilter === 'all' && (
                <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-gray-100 print-hidden">
                    <Calendar size={18} className="text-gray-400" />
                    <span className="text-sm text-gray-500 font-medium">تاريخ مخصص:</span>
                    <input
                        type="date"
                        value={dateRange.start}
                        onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="bg-gray-50 border border-gray-200 rounded-lg text-sm px-3 py-2"
                        aria-label="Start Date"
                    />
                    <span className="text-gray-400">إلى</span>
                    <input
                        type="date"
                        value={dateRange.end}
                        onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="bg-gray-50 border border-gray-200 rounded-lg text-sm px-3 py-2"
                        aria-label="End Date"
                    />
                    {activeTab === 'doctors' && doctors.find(d => d.id === selectedEntityId)?.isCenter && (
                        <>
                            <div className="hidden sm:block h-6 w-px bg-gray-200 mx-1" />
                            <span className="text-sm text-blue-600 font-medium">طبيب المركز:</span>
                            <select
                                className="bg-blue-50 border border-blue-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none min-w-[180px]"
                                value={childDoctorFilter}
                                onChange={e => setChildDoctorFilter(e.target.value)}
                                aria-label="تصفية بطبيب المركز"
                            >
                                <option value="">كل أطباء المركز</option>
                                {doctors.filter(d => d.parentId === selectedEntityId).map(doc => (
                                    <option key={doc.id} value={doc.id}>{doc.name}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
            )}

            {/* Statement Paper */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 print-container">
                {/* Letterhead */}
                <div className="flex justify-between items-start pb-6 mb-6 border-b-2 border-gray-100 print-header">
                    <div>
                        <img src="/orca-logo.png" alt="ORCA Dental Lab" className="h-14 mb-3" />
                        <h1 className="text-2xl font-black text-gray-900">كشف حساب تفصيلي</h1>
                        <p className="text-gray-500 text-sm mt-1">
                            {dateRange.start && dateRange.end
                                ? `الفترة من ${new Date(dateRange.start).toLocaleDateString('ar-EG')} إلى ${new Date(dateRange.end).toLocaleDateString('ar-EG')} `
                                : dateRange.start
                                    ? `من ${new Date(dateRange.start).toLocaleDateString('ar-EG')} حتى الآن`
                                    : 'جميع المعاملات'
                            }
                        </p>
                    </div>
                    <div className="text-left">
                        <h2 className="text-xl font-bold text-gray-800">{getSelectedEntityName()}</h2>
                        <span className="inline-block bg-gray-100 text-gray-600 text-xs font-medium px-3 py-1 rounded-full mt-1">
                            {activeTab === 'doctors' ? 'عميل' : (activeTab === 'suppliers' ? 'مورد' : 'مصمم')}
                        </span>
                        <div className="mt-4 text-sm">
                            <p className="text-gray-400">تاريخ التقرير</p>
                            <p className="font-bold text-gray-700">{new Date().toLocaleDateString('ar-EG')}</p>
                        </div>
                    </div>
                </div>

                {/* Balance Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 print-summary p-4 rounded-xl bg-gray-50">
                    {dateRange.start && (
                        <div className="text-center p-3">
                            <p className="text-xs text-gray-500 mb-1">الرصيد السابق</p>
                            <p className={clsx("text-lg font-bold", individualStatement.totals.openingBalance > 0 ? "text-amber-600" : individualStatement.totals.openingBalance < 0 ? "text-blue-600" : "text-gray-400")}>
                                {Math.abs(individualStatement.totals.openingBalance).toLocaleString()}
                            </p>
                        </div>
                    )}
                    <div className="text-center p-3">
                        <p className="text-xs text-gray-500 mb-1">إجمالي المدين</p>
                        <p className="text-lg font-bold text-rose-600">{individualStatement.totals.totalDebit.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-3">
                        <p className="text-xs text-gray-500 mb-1">إجمالي الدائن</p>
                        <p className="text-lg font-bold text-emerald-600">{individualStatement.totals.totalCredit.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                        <p className="text-xs text-gray-500 mb-1">الرصيد الحالي</p>
                        <p className={clsx("text-xl font-black", individualStatement.totals.balance > 0 ? "text-rose-600" : "text-emerald-600")}>
                            {Math.abs(individualStatement.totals.balance).toLocaleString()}
                            <span className="text-xs font-normal text-gray-400 mr-1">ج.م</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            {individualStatement.totals.balance > 0
                                ? (activeTab === 'doctors' ? 'مطلوب سداده' : 'مستحق له')
                                : (activeTab === 'doctors' ? 'رصيد دائن' : 'مدفوع زيادة')}
                        </p>
                    </div>
                </div>

                {/* Statement Search */}
                <div className="mb-4 print-hidden">
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="ابحث برقم الحالة، اسم المريض، أو الخدمة..."
                            value={statementSearch}
                            onChange={e => setStatementSearch(e.target.value)}
                            className="w-full pr-10 pl-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                        />
                    </div>
                </div>

                {/* Statement Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-slate-800 text-white">
                            <tr>
                                <th className="p-3 rounded-tr-lg font-semibold text-sm w-12 text-center print-hidden">تضمين</th>
                                <th className="p-3 font-semibold text-sm">البيان</th>
                                <th className="p-3 font-semibold text-sm w-40">الخدمات</th>
                                <th className="p-3 font-semibold text-sm w-16">العدد</th>
                                <th className="p-3 font-semibold text-sm w-28">تاريخ الاستلام</th>
                                <th className="p-3 font-semibold text-sm w-28">مدين</th>
                                <th className="p-3 rounded-tl-lg font-semibold text-sm w-28">دائن</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {/* Opening Balance Row */}
                            {dateRange.start && individualStatement.totals.openingBalance !== 0 && (
                                <tr className="bg-amber-50 border-b border-amber-100">
                                    <td className="p-3 print-hidden"></td>
                                    <td className="p-3">
                                        <div className="font-bold text-amber-800">رصيد سابق (مرحّل)</div>
                                        <div className="text-xs text-amber-600">الرصيد من الفترات السابقة</div>
                                    </td>
                                    <td className="p-3 text-amber-600">-</td>
                                    <td className="p-3 text-amber-600">-</td>
                                    <td className="p-3 font-mono text-amber-700">{new Date(dateRange.start).toLocaleDateString('en-GB')}</td>
                                    <td className="p-3 font-mono font-bold text-amber-700">
                                        {individualStatement.totals.openingBalance > 0 ? individualStatement.totals.openingBalance.toLocaleString() : '-'}
                                    </td>
                                    <td className="p-3 font-mono font-bold text-amber-700">
                                        {individualStatement.totals.openingBalance < 0 ? Math.abs(individualStatement.totals.openingBalance).toLocaleString() : '-'}
                                    </td>
                                </tr>
                            )}

                            {(() => {
                                const filteredItems = statementSearch
                                    ? individualStatement.items.filter(item =>
                                        item.description.toLowerCase().includes(statementSearch.toLowerCase()) ||
                                        (item.services || '').toLowerCase().includes(statementSearch.toLowerCase()) ||
                                        (item.details || '').toLowerCase().includes(statementSearch.toLowerCase())
                                    )
                                    : individualStatement.items;
                                return filteredItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="p-12 text-center text-gray-400">
                                            <div className="flex flex-col items-center gap-2">
                                                <Search size={32} className="text-gray-300" />
                                                <span>{statementSearch ? `لا توجد نتائج لـ "${statementSearch}"` : 'لا توجد معاملات في هذه الفترة'}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredItems.map((item, idx) => (
                                        <tr 
                                            key={idx} 
                                            onClick={() => handleStatementRowClick(item)}
                                            className={clsx(
                                                "border-b border-gray-50 transition-colors", 
                                                (item.status === 'Rejected' || item.status === 'Cancelled') && "bg-red-50/70 text-red-800", 
                                                item.isHidden && "opacity-50 grayscale",
                                                (item.description?.includes('حالة #') || (item.status && item.description?.includes('#'))) ? "cursor-pointer hover:bg-blue-50/50" : "hover:bg-gray-50"
                                            )}
                                        >
                                            <td className="p-3 text-center print-hidden">
                                                <input
                                                    type="checkbox"
                                                    checked={!item.isHidden}
                                                    onChange={() => toggleTransactionVisibility(item.id)}
                                                    className="w-4 h-4 text-emerald-600 bg-gray-100 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                                                    title="تضمين في كشف الحساب والطباعة"
                                                />
                                            </td>
                                            <td className="p-3">
                                                <div className={clsx("font-medium", (item.status === 'Rejected' || item.status === 'Cancelled') ? "text-red-700 line-through decoration-red-300" : "text-gray-800")}>{item.description}</div>
                                                {item.details && <div className={clsx("text-xs mt-0.5 truncate max-w-xs", (item.status === 'Rejected' || item.status === 'Cancelled') ? "text-red-400" : "text-gray-500")}>{item.details}</div>}
                                                {item.status === 'Rejected' && <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded mt-1">❌ مرفوض</span>}
                                                {item.status === 'Cancelled' && <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded mt-1">🚫 ملغي</span>}
                                            </td>
                                            <td className="p-3 text-gray-600 text-xs">{item.services || '-'}</td>
                                            <td className="p-3 text-gray-600 font-medium text-center">{item.count ? `(${item.count})` : '-'}</td>
                                            <td className="p-3 font-mono text-gray-600">{new Date(item.date).toLocaleDateString('en-GB')}</td>
                                            <td className="p-3 font-mono font-bold text-rose-600">
                                                {item.type === 'debit' ? item.amount.toLocaleString() : '-'}
                                            </td>
                                            <td className="p-3 font-mono font-bold text-emerald-600">
                                                {item.type === 'credit' ? item.amount.toLocaleString() : '-'}
                                            </td>
                                        </tr>
                                    ))
                                );
                            })()}
                        </tbody>
                        <tfoot className="bg-gray-100 font-bold border-t-2 border-gray-300">
                            <tr>
                                <td colSpan={5} className="p-3 text-gray-700">الإجمالي</td>
                                <td className="p-3 text-rose-600 font-mono">{individualStatement.totals.totalDebit.toLocaleString()}</td>
                                <td className="p-3 text-emerald-600 font-mono">{individualStatement.totals.totalCredit.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* Footer */}
                <div className="mt-8 pt-6 border-t border-gray-100 text-center text-gray-400 text-xs">
                    <p className="font-medium">ORCA Dental Lab ERP System</p>
                    <p className="mt-1">للاستفسارات والملاحظات يرجى التواصل مع الإدارة المالية</p>
                </div>
            </div>
            {/* Hidden Bulk Print Component */}

            {/* Modals */}
            <AnimatePresence>
                {editingOrder && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl">
                            <div className="p-8">
                                <div className="flex justify-between items-center mb-8 border-b border-surface-100 pb-4">
                                    <div className='flex items-center gap-4'>
                                        <div className='bg-primary-100 p-3 rounded-xl text-primary-600'><FileSpreadsheet size={24} /></div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-surface-900">{canEditOrder ? 'تعديل بيانات الأوردر' : 'تفاصيل الأوردر'}</h2>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-surface-500 text-sm">رقم الحالة:</span>
                                                <span className="bg-surface-100 px-2 py-0.5 rounded text-sm font-mono font-bold text-surface-700">#{editingOrder.caseId}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setEditingOrder(null)} aria-label="Close" className="p-2 rounded-full hover:bg-surface-100 text-surface-400 transition-colors"><X size={24} /></button>
                                </div>
                                <OrderForm 
                                    onSubmit={handleOrderSubmit} 
                                    onCancel={() => setEditingOrder(null)} 
                                    initialData={editingOrder} 
                                    readOnly={!canEditOrder} 
                                />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
