import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, Compass, Loader2, Search, Stethoscope, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db, type Doctor, type Order, type Supplier } from '../services/db';
import { buildSmartSearchResults, searchDestinations } from '../lib/smartSearch';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { reachableDestinations, type Destination } from '../lib/navigation';

export default function GlobalSearch({ commandOnly = false }: { commandOnly?: boolean }) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const caps = getCapabilities(user);
    // Record search reaches every order, doctor and supplier in the lab, so
    // it is gated on the capability that actually grants that view. Without
    // this a doctor pressing Ctrl+K pulled the whole doctor directory --
    // `doctors_select` is `USING (true)`, so RLS does not stop it either.
    const canSearchRecords = caps.has('view_orders');
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [orders, setOrders] = useState<Order[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'delivered' | 'archived' | 'doctors'>('all');

    /**
     * Doctors and suppliers are small and load once: keeping them in memory is
     * what makes fuzzy Arabic matching and the "هل تقصد" suggestion possible.
     *
     * Orders do NOT load here. Pulling every order into the browser on focus
     * is the same shape of query that started timing out on the accounting
     * screen, and it only gets worse as the table grows. Orders are searched
     * on the server, debounced, twenty rows at a time.
     */
    const loadSearchData = async () => {
        if (hasLoaded || isLoading || !canSearchRecords) return;
        setIsLoading(true);
        try {
            const [loadedDoctors, loadedSuppliers] = await Promise.all([db.getDoctors(), db.getSuppliers()]);
            setDoctors(loadedDoctors);
            setSuppliers(loadedSuppliers);
            setHasLoaded(true);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!canSearchRecords || !isOpen) return;
        const term = query.trim();
        if (term.length < 2) { setOrders([]); return; }

        let alive = true;
        setIsSearching(true);
        const timer = setTimeout(() => {
            db.getOrders(1, 20, { search: term, includeArchived: true })
                .then(result => { if (alive) setOrders(result.data.filter(order => !order.isDeleted)); })
                .catch(error => { console.error('Order search failed', error); if (alive) setOrders([]); })
                .finally(() => { if (alive) setIsSearching(false); });
        }, 300);

        return () => { alive = false; clearTimeout(timer); setIsSearching(false); };
    }, [query, canSearchRecords, isOpen]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // event.key changes with the keyboard language (e.g. Arabic), while
            // event.code always identifies the physical K key.
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
                event.preventDefault();
                setIsOpen(true);
                void loadSearchData();
                setTimeout(() => inputRef.current?.focus(), 0);
            }
            if (event.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    const results = useMemo(() => buildSmartSearchResults(query, orders, doctors), [query, orders, doctors]);
    // Destinations are permission-filtered from the registry, so search can
    // never advertise a page the user would be bounced out of.
    const destinationResults = useMemo(() => {
        // Resolved paths, not catalogue paths: a result must open the page
        // it names for THIS user, not the area's default landing tab.
        const reachable = reachableDestinations(caps);
        return searchDestinations(query, reachable).slice(0, 5).map(match => match.destination);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, Array.from(caps).sort().join(',')]);
    const openOrder = (order: Order) => {
        setIsOpen(false);
        setQuery('');
        navigate(`/orders?${new URLSearchParams({ q: order.caseId, highlight: order.id, hideDelivered: '0', ...(order.isArchived ? { archived: '1' } : {}) }).toString()}`);
    };
    const openDoctor = (doctor: Doctor) => {
        setIsOpen(false);
        setQuery('');
        navigate(`/orders?${new URLSearchParams({ doctor: doctor.id, hideDelivered: '0' }).toString()}`);
    };

    const hasQuery = query.trim().length > 0;
    const recordResults = results.activeOrders.length + results.deliveredOrders.length + results.archivedOrders.length + results.doctors.length;
    const totalResults = recordResults + destinationResults.length;
    const orderMeta = (order: Order, archived = false) => {
        const supplier = suppliers.find(item => item.id === order.supplierId);
        const doctor = doctors.find(item => item.id === order.doctorId);
        return `${order.caseId} · ${supplier?.name || 'معمل داخلي'} · ${archived ? 'مؤرشفة' : getArabicOrderStatus(order.status)}${doctor ? ` · د. ${doctor.name}` : ''}`;
    };
    const filters = [
        { id: 'all', label: 'الكل', count: recordResults },
        { id: 'active', label: 'جارية', count: results.activeOrders.length },
        { id: 'delivered', label: 'متسلّمة', count: results.deliveredOrders.length },
        { id: 'archived', label: 'مؤرشفة', count: results.archivedOrders.length },
        { id: 'doctors', label: 'أطباء', count: results.doctors.length },
    ] as const;

    if (commandOnly && !isOpen) return null;

    return <div className={`${commandOnly ? 'fixed left-1/2 top-4 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2' : 'relative z-30 w-full max-w-xl'} print:hidden`} dir="rtl">
        <div className="relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} onFocus={() => { setIsOpen(true); void loadSearchData(); }}
                placeholder={canSearchRecords ? 'ابحث عن صفحة أو حالة أو طبيب...' : 'ابحث عن صفحة...'} aria-label="بحث شامل"
                className="h-11 w-full rounded-xl border border-teal-100 bg-white/90 pr-10 pl-20 text-sm text-slate-800 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" />
            <kbd className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">Ctrl K</kbd>
        </div>
        {isOpen && <div className="absolute mt-2 max-h-[70vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500">
                <span>{isLoading || isSearching ? 'جارٍ البحث...' : hasQuery ? `تم العثور على ${totalResults} نتيجة` : (canSearchRecords ? 'اكتب اسم صفحة، أو اسم مريض، أو رقم حالة' : 'اكتب اسم الصفحة التي تريدها')}</span>
                <button type="button" onClick={() => setIsOpen(false)} className="rounded p-1 hover:bg-slate-100" aria-label="إغلاق البحث"><X size={16} /></button>
            </div>
            {(isLoading || isSearching) && <div className="flex justify-center p-6 text-cyan-600"><Loader2 className="animate-spin" /></div>}
            {!isLoading && !isSearching && hasQuery && <>
                {destinationResults.length > 0 && <ResultGroup title="الوجهات" icon={<Compass size={15} />} items={destinationResults} empty="" render={(destination: Destination) => <button type="button" onClick={() => { setIsOpen(false); setQuery(''); navigate(destination.path); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm hover:bg-teal-50"><span className="font-bold text-slate-800">{destination.labelAr}</span><span className="shrink-0 text-xs text-slate-400">{destination.labelEn}</span></button>} />}
                {canSearchRecords && <>
                {canSearchRecords && results.suggestion && <button type="button" onClick={() => setQuery(results.suggestion!)} className="mx-2 mb-2 w-[calc(100%-1rem)] rounded-lg bg-cyan-50 px-3 py-2 text-right text-sm text-cyan-800 hover:bg-cyan-100">هل تقصد <strong>«{results.suggestion}»</strong>؟ اضغط لعرض النتائج بهذا الاسم.</button>}
                {canSearchRecords && <div className="mb-2 flex gap-1 overflow-x-auto px-2 pb-1">{filters.map(filter => <button key={filter.id} type="button" onClick={() => setActiveFilter(filter.id)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${activeFilter === filter.id ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-cyan-50'}`}>{filter.label} ({filter.count})</button>)}</div>}
                {(activeFilter === 'all' || activeFilter === 'active') && <ResultGroup title="الحالات الجارية" icon={<Search size={15} />} items={results.activeOrders} empty="لا توجد حالات جارية مطابقة" render={order => <OrderResult order={order} onClick={openOrder} meta={orderMeta(order)} />} />}
                {(activeFilter === 'all' || activeFilter === 'delivered') && <ResultGroup title="الحالات المتسلّمة" icon={<Search size={15} />} items={results.deliveredOrders} empty="لا توجد حالات متسلّمة مطابقة" render={order => <OrderResult order={order} onClick={openOrder} meta={orderMeta(order)} />} />}
                {(activeFilter === 'all' || activeFilter === 'archived') && <ResultGroup title="الحالات المؤرشفة" icon={<Archive size={15} />} items={results.archivedOrders} empty="لا توجد حالات مؤرشفة مطابقة" render={order => <OrderResult order={order} onClick={openOrder} meta={orderMeta(order, true)} />} />}
                {(activeFilter === 'all' || activeFilter === 'doctors') && <ResultGroup title="الأطباء" icon={<Stethoscope size={15} />} items={results.doctors} empty="لا يوجد طبيب مطابق" render={({ doctor, orderCount }) => <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-teal-50"><div className="min-w-0"><p className="font-bold text-slate-800">{doctor.name}</p><p className="mt-0.5 text-xs text-slate-500">{doctor.doctorCode} · {orderCount} حالة</p></div><button type="button" onClick={() => openDoctor(doctor)} className="shrink-0 rounded-md bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-100">عرض الحالات</button></div>} />}
                </>}
                {!totalResults && <p className="p-5 text-center text-sm text-slate-500">لم نجد نتيجة مطابقة. جرّب كتابة جزء من الاسم.</p>}
            </>}
        </div>}
    </div>;
}

function OrderResult({ order, onClick, meta }: { order: Order; onClick: (order: Order) => void; meta: string }) {
    return <button type="button" onClick={() => onClick(order)} className="flex w-full flex-col rounded-lg px-3 py-2 text-right text-sm hover:bg-teal-50"><span className="font-bold text-slate-800">{order.patientName}</span><span className="mt-0.5 text-xs text-slate-500">{meta}</span></button>;
}

function getArabicOrderStatus(status: Order['status']): string {
    const labels: Record<Order['status'], string> = {
        'Pending': 'قيد الانتظار', 'In Progress': 'قيد التنفيذ', 'Completed': 'مكتملة', 'Delivered': 'تم التسليم',
        'New Case': 'حالة جديدة', 'Under Design': 'تحت التصميم', 'Waiting Dr Approval': 'بانتظار موافقة الطبيب',
        'Under Production': 'تحت الإنتاج', 'Try In': 'بروفة', 'Try In Approved': 'البروفة موافق', 'Ready': 'جاهزة',
        'Returned for Adjustments': 'مرتجعة للتعديل', 'Rejected': 'مرفوضة', 'Doctor Rejected': 'مرفوضة من الطبيب',
        'Lab Rejected': 'مرفوضة من المعمل', 'Cancelled': 'ملغاة', 'Pending Review': 'بانتظار المراجعة',
    };
    return labels[status];
}

function ResultGroup<T>({ title, icon, items, empty, render }: { title: string; icon: ReactNode; items: T[]; empty: string; render: (item: T) => ReactNode }) {
    return <section className="border-t border-slate-100 px-2 py-2 first:border-t-0">
        <h3 className="flex items-center gap-2 px-1 py-1.5 text-xs font-bold text-teal-700">{icon}{title}</h3>
        {items.length ? <div className="space-y-1">{items.map((item, index) => <div key={index}>{render(item)}</div>)}</div> : empty ? <p className="px-1 py-1 text-xs text-slate-400">{empty}</p> : null}
    </section>;
}
