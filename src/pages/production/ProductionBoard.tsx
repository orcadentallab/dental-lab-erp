/**
 * The production board: every case on the floor, in the stage it is sitting in.
 *
 * One column per stage the lab performs. The age counter on each card is the
 * point of the screen -- a case that has been in a column for two days is the
 * bottleneck signal, and it is meant to be visible without anyone running a
 * report.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useToast } from '../../context/ToastContext';
import { db } from '../../services/db';
import {
    getOpenStageRuns, getStages,
    type StageRunCard, type ProductionStage,
} from '../../services/supabase/production';
import { ensureAbsoluteUrl } from '../../lib/urlUtils';
import {
    RefreshCw, AlertTriangle, Building2,
    LayoutGrid, Columns, ChevronLeft, ChevronRight, User,
    Search, X, Eye, EyeOff, ExternalLink, Calendar,
    Clock, FileText, Flame, RotateCcw,
} from 'lucide-react';

/** Anything sitting longer than this is called out rather than left to blend in. */
const STALE_HOURS = 24;

function ageHours(since: string | null): number | null {
    if (!since) return null;
    return (Date.now() - new Date(since).getTime()) / 3_600_000;
}

function ageLabel(since: string | null): string {
    const h = ageHours(since);
    if (h === null) return '—';
    if (h < 1) return `${Math.round(h * 60)} د`;
    if (h < 24) return `${Math.round(h)} س`;
    return `${Math.floor(h / 24)} يوم`;
}

/** Determine urgency relative to current date */
function getDeliveryUrgency(deliveryDate: string | null): {
    status: 'overdue' | 'today' | 'tomorrow' | 'normal' | 'none';
    label: string;
} {
    if (!deliveryDate) return { status: 'none', label: '' };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(deliveryDate);
    target.setHours(0, 0, 0, 0);

    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return { status: 'overdue', label: `متأخر (${Math.abs(diffDays)} يوم)` };
    }
    if (diffDays === 0) {
        return { status: 'today', label: 'تسليم اليوم' };
    }
    if (diffDays === 1) {
        return { status: 'tomorrow', label: 'تسليم غداً' };
    }
    return {
        status: 'normal',
        label: target.toLocaleDateString('ar-EG'),
    };
}

type FilterChip = 'all' | 'urgent' | 'stale' | 'external' | 'blocked' | 'rework';

export default function ProductionBoard() {
    const { error: toastError } = useToast();
    const [runs, setRuns] = useState<StageRunCard[]>([]);
    const [stages, setStages] = useState<ProductionStage[]>([]);
    const [suppliers, setSuppliers] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);

    // 1. View Mode (Grid vs Scroll)
    const [viewMode, setViewMode] = useState<'grid' | 'scroll'>(() => {
        const saved = localStorage.getItem('production_board_view');
        return saved === 'scroll' ? 'scroll' : 'grid';
    });

    // 2. Hide Empty Stages Toggle
    const [hideEmpty, setHideEmpty] = useState<boolean>(() => {
        return localStorage.getItem('production_board_hide_empty') === 'true';
    });

    // 3. Search & Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterChip, setFilterChip] = useState<FilterChip>('all');

    // 4. Selected Card for Drawer Details
    const [selectedRun, setSelectedRun] = useState<StageRunCard | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const handleViewModeChange = (mode: 'grid' | 'scroll') => {
        setViewMode(mode);
        try {
            localStorage.setItem('production_board_view', mode);
        } catch {
            // ignore localStorage errors
        }
    };

    const handleToggleHideEmpty = () => {
        setHideEmpty((prev) => {
            const next = !prev;
            try {
                localStorage.setItem('production_board_hide_empty', String(next));
            } catch {
                // ignore
            }
            return next;
        });
    };

    const handleScroll = (direction: 'right' | 'left') => {
        if (!scrollContainerRef.current) return;
        const delta = direction === 'left' ? -320 : 320;
        scrollContainerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    };

    const load = useCallback(async () => {
        try {
            const [r, s, sups] = await Promise.all([
                getOpenStageRuns(),
                getStages(),
                db.getSuppliers(),
            ]);
            setRuns(r);
            setStages(s);
            const supMap: Record<string, string> = {};
            (sups || []).forEach((sup) => {
                supMap[sup.id] = sup.name;
            });
            setSuppliers(supMap);
        } catch (e) {
            console.error('[ProductionBoard] load failed', e);
            toastError('تعذّر تحميل لوحة الإنتاج');
        } finally {
            setLoading(false);
        }
    }, [toastError]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const timer = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(timer);
    }, [load]);

    // Keyboard shortcut to close drawer on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedRun) {
                setSelectedRun(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedRun]);

    // Counts for filter chips
    const counts = useMemo(() => {
        return {
            all: runs.length,
            urgent: runs.filter((r) => r.priority === 'Urgent').length,
            stale: runs.filter((r) => (ageHours(r.queuedAt) ?? 0) > STALE_HOURS).length,
            external: runs.filter((r) => r.execution === 'external').length,
            blocked: runs.filter((r) => Boolean(r.blockedReason)).length,
            rework: runs.filter((r) => r.isRework).length,
        };
    }, [runs]);

    // Filtered runs based on search and selected chip
    const filteredRuns = useMemo(() => {
        return runs.filter((r) => {
            // Text search
            if (searchQuery.trim()) {
                const q = searchQuery.trim().toLowerCase();
                const matchCase = r.caseId.toLowerCase().includes(q);
                const matchPatient = (r.patientName || '').toLowerCase().includes(q);
                const matchDoctor = (r.doctorName || '').toLowerCase().includes(q);
                const extLabName = r.supplierName || (r.supplierId ? suppliers[r.supplierId] : '');
                const matchSupplier = extLabName.toLowerCase().includes(q);
                if (!matchCase && !matchPatient && !matchDoctor && !matchSupplier) {
                    return false;
                }
            }

            // Filter chip
            if (filterChip === 'urgent' && r.priority !== 'Urgent') return false;
            if (filterChip === 'stale' && (ageHours(r.queuedAt) ?? 0) <= STALE_HOURS) return false;
            if (filterChip === 'external' && r.execution !== 'external') return false;
            if (filterChip === 'blocked' && !r.blockedReason) return false;
            if (filterChip === 'rework' && !r.isRework) return false;

            return true;
        });
    }, [runs, searchQuery, filterChip, suppliers]);

    // Base stages to show
    const allColumns = useMemo(() => {
        const withWork = new Set(runs.map((r) => r.stageId));
        return stages.filter((s) => withWork.has(s.id) || s.scope === 'global');
    }, [stages, runs]);

    // Visible columns respecting the "Hide Empty" toggle
    const visibleColumns = useMemo(() => {
        if (!hideEmpty) return allColumns;
        const activeStageIds = new Set(filteredRuns.map((r) => r.stageId));
        return allColumns.filter((s) => activeStageIds.has(s.id));
    }, [allColumns, hideEmpty, filteredRuns]);

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header: Title, Floor KPIs, and Controls */}
            <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">لوحة الإنتاج</h1>
                    <div className="flex items-center gap-2 flex-wrap text-sm text-slate-500 mt-1">
                        <span>{runs.length} حالة على الأرض</span>
                        {counts.stale > 0 && (
                            <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                ⏳ {counts.stale} قاعدة أكتر من يوم
                            </span>
                        )}
                        {counts.urgent > 0 && (
                            <span className="text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">
                                🔥 {counts.urgent} مستعجل
                            </span>
                        )}
                        {counts.external > 0 && (
                            <span className="text-sky-700 font-bold bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                                🏢 {counts.external} عند معمل خارجي
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Hide Empty Stages Toggle */}
                    <button
                        onClick={handleToggleHideEmpty}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                            hideEmpty
                                ? 'bg-teal-50 text-teal-700 border-teal-300 shadow-sm'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                        title={hideEmpty ? 'إظهار جميع المراحل الفارغة' : 'إخفاء المراحل الفارغة من الشاشة'}
                    >
                        {hideEmpty ? <Eye className="w-3.5 h-3.5 text-teal-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                        <span>{hideEmpty ? 'إظهار الفارغة' : 'إخفاء الفارغة'}</span>
                    </button>

                    {/* View Switcher: Grid (2 Rows) vs Scroll (Kanban) */}
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                        <button
                            onClick={() => handleViewModeChange('grid')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                viewMode === 'grid'
                                    ? 'bg-white text-slate-800 shadow-sm border border-slate-200/80'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="عرض صفين مدمج (بدون سكرول أفقي)"
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            <span>صفين (مدمج)</span>
                        </button>
                        <button
                            onClick={() => handleViewModeChange('scroll')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                viewMode === 'scroll'
                                    ? 'bg-white text-slate-800 shadow-sm border border-slate-200/80'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="عرض شريط أفقي (طابور كانبان)"
                        >
                            <Columns className="w-3.5 h-3.5" />
                            <span>شريط أفقي</span>
                        </button>
                    </div>

                    {/* Scroll buttons for horizontal mode */}
                    {viewMode === 'scroll' && (
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5">
                            <button
                                onClick={() => handleScroll('right')}
                                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                                title="تحريك لليمين"
                                aria-label="تحريك لليمين"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleScroll('left')}
                                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                                title="تحريك لليسار"
                                aria-label="تحريك لليسار"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <button
                        onClick={() => void load()}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        aria-label="تحديث"
                        title="تحديث البيانات"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Quick Search & Smart Filters Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[240px]">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="ابحث برقم الحالة، اسم المريض، الطبيب، أو المعمل الخارجي…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pr-9 pl-8 py-2 text-xs md:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white transition-all text-slate-800 placeholder-slate-400"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                            title="مسح البحث"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Filter Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-thin">
                    <FilterChipButton
                        active={filterChip === 'all'}
                        onClick={() => setFilterChip('all')}
                        label="الكل"
                        count={counts.all}
                    />
                    <FilterChipButton
                        active={filterChip === 'urgent'}
                        onClick={() => setFilterChip('urgent')}
                        label="مستعجل"
                        count={counts.urgent}
                        icon={<Flame className="w-3 h-3 text-red-500" />}
                        badgeColor={counts.urgent > 0 ? 'bg-red-100 text-red-700' : undefined}
                    />
                    <FilterChipButton
                        active={filterChip === 'stale'}
                        onClick={() => setFilterChip('stale')}
                        label="أكتر من يوم"
                        count={counts.stale}
                        icon={<Clock className="w-3 h-3 text-amber-500" />}
                        badgeColor={counts.stale > 0 ? 'bg-amber-100 text-amber-800' : undefined}
                    />
                    <FilterChipButton
                        active={filterChip === 'external'}
                        onClick={() => setFilterChip('external')}
                        label="معمل خارجي"
                        count={counts.external}
                        icon={<Building2 className="w-3 h-3 text-sky-500" />}
                    />
                    <FilterChipButton
                        active={filterChip === 'blocked'}
                        onClick={() => setFilterChip('blocked')}
                        label="موقوفة"
                        count={counts.blocked}
                        icon={<AlertTriangle className="w-3 h-3 text-orange-500" />}
                        badgeColor={counts.blocked > 0 ? 'bg-orange-100 text-orange-800' : undefined}
                    />
                    <FilterChipButton
                        active={filterChip === 'rework'}
                        onClick={() => setFilterChip('rework')}
                        label="إعادة"
                        count={counts.rework}
                        icon={<RotateCcw className="w-3 h-3 text-amber-600" />}
                    />
                </div>
            </div>

            {/* Empty State */}
            {runs.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <p className="text-lg text-slate-600 font-bold">مفيش حالات في الإنتاج دلوقتي</p>
                    <p className="text-sm text-slate-400 mt-1">
                        الحالات بتظهر هنا أول ما تدخل الإنتاج
                    </p>
                </div>
            )}

            {/* If filters yielded 0 results while runs exist */}
            {runs.length > 0 && filteredRuns.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                    <p className="text-base text-slate-700 font-bold">لا توجد حالات تطابق البحث أو الفلتر المحدد</p>
                    <button
                        onClick={() => { setSearchQuery(''); setFilterChip('all'); }}
                        className="text-xs text-teal-700 bg-teal-50 hover:bg-teal-100 font-bold px-3 py-1.5 rounded-lg border border-teal-200 transition-colors"
                    >
                        إعادة ضبط الفلاتر
                    </button>
                </div>
            )}

            {/* Stages Columns: Grid mode (2 rows) OR Horizontal scroll mode */}
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
                    {visibleColumns.map((stage) => (
                        <StageColumn
                            key={stage.id}
                            stage={stage}
                            runs={filteredRuns}
                            suppliers={suppliers}
                            onSelectCard={setSelectedRun}
                            maxCardHeight="max-h-[380px]"
                        />
                    ))}
                </div>
            ) : (
                <div
                    ref={scrollContainerRef}
                    className="flex gap-4 overflow-x-auto pb-4 scroll-smooth"
                >
                    {visibleColumns.map((stage) => (
                        <div key={stage.id} className="min-w-[270px] w-[270px] flex-shrink-0">
                            <StageColumn
                                stage={stage}
                                runs={filteredRuns}
                                suppliers={suppliers}
                                onSelectCard={setSelectedRun}
                                maxCardHeight="max-h-[calc(100vh-270px)]"
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* Case Details Slide-over Drawer */}
            {selectedRun && (
                <CaseDetailsDrawer
                    run={selectedRun}
                    suppliers={suppliers}
                    onClose={() => setSelectedRun(null)}
                />
            )}
        </div>
    );
}

// ─── Filter Chip Button Component ──────────────────────────────────────────

interface FilterChipProps {
    active: boolean;
    onClick: () => void;
    label: string;
    count: number;
    icon?: ReactNode;
    badgeColor?: string;
}

function FilterChipButton({ active, onClick, label, count, icon, badgeColor }: FilterChipProps) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                active
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
            }`}
        >
            {icon}
            <span>{label}</span>
            <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    active
                        ? 'bg-white/20 text-white'
                        : badgeColor || 'bg-slate-200 text-slate-700'
                }`}
            >
                {count}
            </span>
        </button>
    );
}

// ─── Stage Column Component ────────────────────────────────────────────────

interface StageColumnProps {
    stage: ProductionStage;
    runs: StageRunCard[];
    suppliers?: Record<string, string>;
    onSelectCard: (run: StageRunCard) => void;
    maxCardHeight?: string;
}

function StageColumn({
    stage,
    runs,
    suppliers = {},
    onSelectCard,
    maxCardHeight = 'max-h-[380px]',
}: StageColumnProps) {
    const sortedItems = useMemo(() => {
        return [...runs.filter((r) => r.stageId === stage.id)].sort((a, b) => {
            // 1. in_progress first
            const inProgress = (r: StageRunCard) => (r.status === 'in_progress' ? 0 : 1);
            if (inProgress(a) !== inProgress(b)) return inProgress(a) - inProgress(b);

            // 2. Urgent first
            const urgent = (r: StageRunCard) => (r.priority === 'Urgent' ? 0 : 1);
            if (urgent(a) !== urgent(b)) return urgent(a) - urgent(b);

            // 3. nearest delivery date
            const due = (r: StageRunCard) => r.deliveryDate ?? '9999-12-31';
            if (due(a) !== due(b)) return due(a) < due(b) ? -1 : 1;

            // 4. oldest queued first
            return (a.queuedAt ?? '') < (b.queuedAt ?? '') ? -1 : 1;
        });
    }, [runs, stage.id]);

    const totalUnits = sortedItems.reduce((sum, r) => sum + (r.unitsIn || 0), 0);
    const isOverCapacity = Boolean(stage.dailyCapacityUnits && totalUnits > stage.dailyCapacityUnits);

    return (
        <div className="flex flex-col bg-slate-50/60 rounded-2xl border border-slate-200/80 p-2">
            {/* Stage Column Header */}
            <div
                className={`flex items-center justify-between mb-2 px-2.5 py-2 rounded-xl border ${
                    isOverCapacity ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200 shadow-sm'
                }`}
            >
                <div className="min-w-0 pr-1">
                    <h2 className="font-bold text-slate-800 text-sm truncate" title={stage.nameAr}>
                        {stage.nameAr}
                    </h2>
                    {stage.dailyCapacityUnits ? (
                        <div className="text-[10px] text-slate-500 font-semibold truncate">
                            السعة: {totalUnits} / {stage.dailyCapacityUnits} وحدة
                        </div>
                    ) : (
                        <div className="text-[10px] text-slate-400 font-medium">
                            {totalUnits} وحدة
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {isOverCapacity && (
                        <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                            حِمل زائد
                        </span>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 font-bold text-slate-700">
                        {sortedItems.length}
                    </span>
                </div>
            </div>

            {/* Stage Cards Container with vertical scroll */}
            <div className={`space-y-2 overflow-y-auto pr-1 pl-0.5 scrollbar-thin scrollbar-thumb-slate-300 ${maxCardHeight}`}>
                {sortedItems.length === 0 && (
                    <div className="text-xs text-slate-400 text-center py-8 border border-dashed border-slate-200 rounded-xl bg-white/50">
                        فاضية
                    </div>
                )}

                {sortedItems.map((r) => {
                    const isStale = (ageHours(r.queuedAt) ?? 0) > STALE_HOURS;
                    const isExternal = r.execution === 'external';
                    const urgency = getDeliveryUrgency(r.deliveryDate);

                    // Dynamic border styling based on delivery urgency
                    let urgencyBorderClass = 'border-slate-200';
                    if (urgency.status === 'overdue' || urgency.status === 'today') {
                        urgencyBorderClass = 'border-r-4 border-r-rose-500 border-slate-200';
                    } else if (urgency.status === 'tomorrow') {
                        urgencyBorderClass = 'border-r-4 border-r-amber-500 border-slate-200';
                    }

                    return (
                        <div
                            key={r.id}
                            onClick={() => onSelectCard(r)}
                            className={`rounded-xl border p-3 space-y-1.5 shadow-sm transition-all hover:shadow-md hover:border-teal-400 cursor-pointer ${urgencyBorderClass} ${
                                isExternal
                                    ? 'bg-sky-50/40'
                                    : isStale
                                    ? 'bg-amber-50/30'
                                    : 'bg-white'
                            }`}
                            title="انقر لعرض تفاصيل الحالة والمرفقات"
                        >
                            {/* Card Header: Case ID & Age */}
                            <div className="flex items-center justify-between gap-1.5">
                                <span className="font-bold text-slate-900 text-xs font-mono tracking-tight bg-slate-100/90 px-1.5 py-0.5 rounded border border-slate-200/80 shrink-0">
                                    #{r.caseId}
                                </span>
                                <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold shrink-0 ${
                                        isStale
                                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                            : 'text-slate-500 bg-slate-100/60'
                                    }`}
                                >
                                    {ageLabel(r.queuedAt)}
                                </span>
                            </div>

                            {/* Patient Name: Full row, prominent and easy to read */}
                            <div className="flex items-center gap-1.5 pt-0.5">
                                <User className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                                <span
                                    className="font-bold text-slate-800 text-xs sm:text-[13px] leading-tight truncate"
                                    title={r.patientName && r.patientName !== '—' ? `المريض: ${r.patientName}` : undefined}
                                >
                                    {r.patientName && r.patientName !== '—' ? r.patientName : 'بدون اسم مريض'}
                                </span>
                            </div>

                            {/* Doctor + Units */}
                            <div className="text-xs text-slate-600 flex items-center justify-between gap-1 pt-0.5">
                                <span className="truncate" title={`الطبيب: د. ${r.doctorName}`}>
                                    د. {r.doctorName}
                                </span>
                                <span className="font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] shrink-0">
                                    {r.unitsIn} وحدة
                                </span>
                            </div>

                            {/* Delivery Date & Urgency Indicator */}
                            {r.deliveryDate && (
                                <div className="text-[11px] flex items-center justify-between gap-1 pt-0.5">
                                    <span className="text-slate-400 font-mono">
                                        التسليم: {new Date(r.deliveryDate).toLocaleDateString('ar-EG')}
                                    </span>
                                    {urgency.status === 'overdue' && (
                                        <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1 rounded animate-pulse">
                                            متأخر!
                                        </span>
                                    )}
                                    {urgency.status === 'today' && (
                                        <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1 rounded">
                                            اليوم
                                        </span>
                                    )}
                                    {urgency.status === 'tomorrow' && (
                                        <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded">
                                            غداً
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Badges / Tags */}
                            <div className="flex flex-wrap gap-1 pt-1">
                                {r.priority === 'Urgent' && (
                                    <Tag className="bg-red-100 text-red-700 font-bold">مستعجل</Tag>
                                )}
                                {r.isRework && (
                                    <Tag className="bg-amber-100 text-amber-800">إعادة</Tag>
                                )}
                                {r.status === 'in_progress' && (
                                    <Tag className="bg-emerald-100 text-emerald-700 font-bold">
                                        {r.assigneeName ?? 'شغّالة'}
                                    </Tag>
                                )}
                                {isExternal && (() => {
                                    const labName = r.supplierName || (r.supplierId ? suppliers[r.supplierId] : null);
                                    return (
                                        <Tag className="bg-sky-100 text-sky-800 font-bold flex items-center gap-1 max-w-full">
                                            <Building2 className="w-3 h-3 shrink-0" />
                                            <span className="truncate" title={labName ? `المعمل: ${labName}` : undefined}>
                                                {labName || 'معمل خارجي'}
                                            </span>
                                        </Tag>
                                    );
                                })()}
                                {r.blockedReason && (
                                    <Tag className="bg-orange-100 text-orange-800 font-bold">
                                        <AlertTriangle className="w-3 h-3 inline mr-0.5" /> موقوفة
                                    </Tag>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Case Details Slide-over Drawer Component ──────────────────────────────

interface CaseDetailsDrawerProps {
    run: StageRunCard;
    suppliers: Record<string, string>;
    onClose: () => void;
}

function CaseDetailsDrawer({ run, suppliers, onClose }: CaseDetailsDrawerProps) {
    const extLabName = run.supplierName || (run.supplierId ? suppliers[run.supplierId] : null);
    const urgency = getDeliveryUrgency(run.deliveryDate);
    const isStale = (ageHours(run.queuedAt) ?? 0) > STALE_HOURS;

    const handleOpenLink = (rawUrl: string | null) => {
        if (!rawUrl) return;
        const valid = ensureAbsoluteUrl(rawUrl);
        if (valid) {
            window.open(valid, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <div className="fixed inset-0 z-50 overflow-hidden" dir="rtl">
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in"
            />

            {/* Slide-over panel */}
            <div className="fixed inset-y-0 left-0 max-w-full flex pl-0 md:pl-10">
                <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col border-r border-slate-200 animate-in slide-in-from-left duration-200">
                    {/* Drawer Header */}
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-mono font-bold text-slate-900">
                                #{run.caseId}
                            </span>
                            <span className="text-xs font-bold text-teal-800 bg-teal-100 px-2 py-0.5 rounded-lg border border-teal-200">
                                {run.stageNameAr}
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
                            aria-label="إغلاق"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Drawer Content */}
                    <div className="p-5 overflow-y-auto space-y-5 flex-1 scrollbar-thin">
                        {/* Urgent / Stale Warning Banner */}
                        {(run.priority === 'Urgent' || isStale || urgency.status === 'overdue') && (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1 text-xs">
                                {run.priority === 'Urgent' && (
                                    <div className="font-bold text-red-700 flex items-center gap-1.5">
                                        <Flame className="w-4 h-4 text-red-500" />
                                        <span>حالة مستعجلة — أولوية قصوى في التنفيذ</span>
                                    </div>
                                )}
                                {urgency.status === 'overdue' && (
                                    <div className="font-bold text-rose-700 flex items-center gap-1.5">
                                        <Calendar className="w-4 h-4 text-rose-500" />
                                        <span>موعد التسليم متأخر! ({run.deliveryDate})</span>
                                    </div>
                                )}
                                {isStale && (
                                    <div className="text-amber-800 flex items-center gap-1.5">
                                        <Clock className="w-4 h-4 text-amber-600" />
                                        <span>موجودة في هذه المرحلة منذ أكثر من {ageLabel(run.queuedAt)}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Patient & Doctor */}
                        <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-200 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">اسم المريض</span>
                                <span className="font-bold text-slate-900 text-sm">
                                    {run.patientName && run.patientName !== '—' ? run.patientName : 'غير محدد'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">الطبيب المعالج</span>
                                <span className="font-bold text-slate-800 text-sm">
                                    د. {run.doctorName}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400">عدد الوحدات</span>
                                <span className="font-bold text-slate-800 text-sm">
                                    {run.unitsIn} وحدة
                                </span>
                            </div>
                            {run.shade && (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">اللون (Shade)</span>
                                    <span className="font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs">
                                        {run.shade}
                                    </span>
                                </div>
                            )}
                            {run.deliveryDate && (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">تاريخ التسليم</span>
                                    <span className="font-mono font-bold text-slate-700 text-xs">
                                        {new Date(run.deliveryDate).toLocaleDateString('ar-EG')}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Services & Teeth */}
                        {(run.services.length > 0 || run.teeth.length > 0) && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">الخدمات والأسنان</h3>
                                {run.services.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {run.services.map((svc, idx) => (
                                            <span key={idx} className="text-xs bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 font-medium">
                                                {svc}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {run.teeth.length > 0 && (
                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                        <span className="text-xs text-slate-400">الأسنان:</span>
                                        {run.teeth.map((t, idx) => (
                                            <span key={idx} className="text-xs font-mono font-bold bg-teal-50 text-teal-800 px-2 py-0.5 rounded border border-teal-200">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Direct File Links / Quick Actions */}
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">المرفقات والملفات</h3>
                            <div className="grid grid-cols-1 gap-2">
                                {run.designUrl ? (
                                    <button
                                        onClick={() => handleOpenLink(run.designUrl)}
                                        className="flex items-center justify-between p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800 transition-colors text-xs font-bold"
                                    >
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-indigo-600" />
                                            <span>رابط التصميم (Design URL)</span>
                                        </div>
                                        <ExternalLink className="w-3.5 h-3.5 text-indigo-500" />
                                    </button>
                                ) : (
                                    <div className="text-xs text-slate-400 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center">
                                        لا يوجد رابط تصميم مرفوع
                                    </div>
                                )}

                                {run.stlUrl && (
                                    <button
                                        onClick={() => handleOpenLink(run.stlUrl)}
                                        className="flex items-center justify-between p-2.5 rounded-xl border border-teal-200 bg-teal-50/70 hover:bg-teal-100 text-teal-800 transition-colors text-xs font-bold"
                                    >
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-teal-600" />
                                            <span>ملف المسح ثلاثي الأبعاد (STL / Scan)</span>
                                        </div>
                                        <ExternalLink className="w-3.5 h-3.5 text-teal-500" />
                                    </button>
                                )}

                                {run.imagesUrl && (
                                    <button
                                        onClick={() => handleOpenLink(run.imagesUrl)}
                                        className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 transition-colors text-xs font-bold"
                                    >
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-slate-600" />
                                            <span>الصور السريرية (Clinical Photos)</span>
                                        </div>
                                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Instructions */}
                        {(run.instructions || run.doctorLabInstructions) && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">التعليمات والملاحظات</h3>
                                {run.instructions && (
                                    <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-900 leading-relaxed whitespace-pre-wrap">
                                        <div className="font-bold text-amber-800 mb-1">تعليمات الحالة:</div>
                                        {run.instructions}
                                    </div>
                                )}
                                {run.doctorLabInstructions && (
                                    <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-3 text-xs text-blue-900 leading-relaxed whitespace-pre-wrap">
                                        <div className="font-bold text-blue-800 mb-1">تفضيلات المعمل للطبيب:</div>
                                        {run.doctorLabInstructions}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Stage Details & Execution */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">بيانات التنفيذ بالمرحلة</h3>
                            <div className="space-y-1.5 text-xs text-slate-600">
                                <div className="flex justify-between">
                                    <span className="text-slate-400">نوع التنفيذ:</span>
                                    <span className="font-semibold text-slate-800">
                                        {run.execution === 'external' ? (extLabName ? `معمل خارجي: ${extLabName}` : 'معمل خارجي') : 'داخلي بالمعمل'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">المسؤول عن التنفيذ:</span>
                                    <span className="font-semibold text-slate-800">
                                        {run.assigneeName ?? 'متاح لأي فني مؤهل'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">تاريخ دخول المرحلة:</span>
                                    <span className="font-mono text-slate-700">
                                        {run.queuedAt ? new Date(run.queuedAt).toLocaleString('ar-EG') : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-400">مدة البقاء بالمرحلة:</span>
                                    <span className="font-bold text-slate-800">
                                        {ageLabel(run.queuedAt)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Drawer Footer */}
                    <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                        >
                            إغلاق النافذة
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Tag({ children, className }: { children: ReactNode; className: string }) {
    return (
        <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${className}`}>
            {children}
        </span>
    );
}
