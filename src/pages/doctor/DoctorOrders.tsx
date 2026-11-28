import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { doctorPickupLabels, formatDoctorText } from '../../translations/doctorPortal';
import CaseAttachments from '../../components/orders/CaseAttachments';
import { ACCEPTED_TYPES, SCAN_ACCEPTED_TYPES } from '../../lib/storage';
import { Link } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { db, type DoctorOrderSummary } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui/Card';
import { Star, Search, MessageCircle, Check, Smile, FolderOpen, Copy, X, ChevronDown, Package, Palette, PencilLine, ScanLine, Shapes, Clock } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { PortalSkeleton, PortalError } from '../../components/doctors/PortalStates';
import { useCopyCaseReference } from '../../hooks/useCopyCaseReference';
import DoctorDesignReview from '../../components/doctors/DoctorDesignReview';
import DoctorTryInResponse from '../../components/doctors/DoctorTryInResponse';
import { doctorPortalService, type PortalDesignReview, type PortalTryInRequest } from '../../services/doctorPortalService';

type FilterTab = 'all' | 'in_progress' | 'in_delivery' | 'delivered' | 'issues';

function stageIndex(order: DoctorOrderSummary) {
    switch (order.productionStatus) {
        case 'final_delivered': return 4;
        case 'final_ready': return 3;
        case 'in_production':
        case 'try_in_ready':
        case 'waiting_doctor':
        case 'finalization': return 2;
        case 'designing': return 1;
        default: return 0;
    }
}

function caseFilter(order: DoctorOrderSummary): Exclude<FilterTab, 'all'> {
    if (order.issueState !== 'none') return 'issues';
    if (stageIndex(order) === 4) return 'delivered';
    if (stageIndex(order) === 3 || order.shipmentStatus === 'dispatched') return 'in_delivery';
    return 'in_progress';
}

function relativeTime(timestamp: number, now: number, locale: string, justNow: string) {
    const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
    if (!minutes) return justNow;
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' });
    if (minutes < 60) return formatter.format(-minutes, 'minute');
    if (minutes < 1440) return formatter.format(-Math.floor(minutes / 60), 'hour');
    return formatter.format(-Math.floor(minutes / 1440), 'day');
}

function RatingDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
    const { t } = useDoctorLanguage();
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { ref.current?.showModal(); }, []);
    return <dialog ref={ref} aria-label={t.rateCaseQuality} onCancel={onClose}
        className="m-auto w-11/12 max-w-md rounded-2xl bg-transparent p-0 text-inherit backdrop:bg-slate-950/70">
        {children}
    </dialog>;
}

export default function DoctorOrders() {
    const { t, locale } = useDoctorLanguage();
    const { user } = useAuth();
    const { success, error: toastError } = useToast();
    const copy = useCopyCaseReference();
    const [orders, setOrders] = useState<DoctorOrderSummary[]>([]);
    const [reviews, setReviews] = useState<PortalDesignReview[]>([]);
    const [tryInRequests, setTryInRequests] = useState<PortalTryInRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [updated, setUpdated] = useState(0);
    const [now, setNow] = useState(Date.now);
    const [filesOrderId, setFilesOrderId] = useState('');
    const [expandedId, setExpandedId] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
    const [ratingOrder, setRatingOrder] = useState<DoctorOrderSummary | null>(null);
    const [rating, setRating] = useState(5);
    const [feedbackNotes, setFeedbackNotes] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [isSubmittingRating, setIsSubmittingRating] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const pending = useRef(false);
    const fileTriggers = useRef(new Map<string, HTMLButtonElement>());
    const quickFeedbackTags = [
        { tag: t.feedbackFit, Icon: Check }, { tag: t.feedbackShade, Icon: Palette },
        { tag: t.feedbackAnatomy, Icon: Shapes }, { tag: t.feedbackDelivery, Icon: Package },
        { tag: t.feedbackOcclusion, Icon: PencilLine }, { tag: t.feedbackContact, Icon: ScanLine },
    ];

    const loadOrders = useCallback(async (silent = false) => {
        if (!user?.entityId || pending.current) return;
        pending.current = true;
        if (!silent) setLoading(true);
        try {
            const [cases, designReviews, trialReplies] = await Promise.all([
                db.getMyDoctorOrders(), doctorPortalService.designReviews(), doctorPortalService.tryInRequests(),
            ]);
            setOrders(cases);
            setReviews(designReviews);
            setTryInRequests(trialReplies);
            const refreshed = Date.now();
            setNow(refreshed);
            setUpdated(refreshed);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            pending.current = false;
            setLoading(false);
        }
    }, [user?.entityId]);

    useEffect(() => {
        void loadOrders();
        const refresh = () => { if (document.visibilityState === 'visible' && navigator.onLine) void loadOrders(true); };
        const timer = window.setInterval(refresh, 60000);
        const clock = window.setInterval(() => setNow(Date.now()), 30000);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('online', refresh);
        return () => {
            window.clearInterval(timer);
            window.clearInterval(clock);
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('online', refresh);
        };
    }, [loadOrders]);

    const handleRateSubmit = async () => {
        if (!ratingOrder || isSubmittingRating) return;
        setIsSubmittingRating(true);
        try {
            const tags = selectedTags.length ? formatDoctorText(t.feedbackSummary, selectedTags.join(locale === 'ar-EG' ? '، ' : ', ')) : '';
            await db.submitMyOrderFeedback(ratingOrder.id, rating, [tags, feedbackNotes.trim()].filter(Boolean).join('\n'));
            success(t.feedbackThanks);
            setRatingOrder(null);
            void loadOrders(true);
        } catch {
            toastError(t.feedbackError);
        } finally {
            setIsSubmittingRating(false);
        }
    };

    const toggleFeedbackTag = (tag: string) => setSelectedTags(previous => previous.includes(tag) ? previous.filter(item => item !== tag) : [...previous, tag]);
    const filters: { id: FilterTab; label: string }[] = [
        { id: 'all', label: t.allCases }, { id: 'in_progress', label: t.inProgress },
        { id: 'in_delivery', label: t.filterReady }, { id: 'delivered', label: t.stageDelivered }, { id: 'issues', label: t.needsAttention },
    ];
    const counts = { all: orders.length, in_progress: 0, in_delivery: 0, delivered: 0, issues: 0 };
    orders.forEach(order => { counts[caseFilter(order)] += 1; });
    const term = searchTerm.trim().toLocaleLowerCase(locale);
    const filteredOrders = orders.filter(order => (activeFilter === 'all' || caseFilter(order) === activeFilter)
        && [order.patientName, order.caseId].some(value => value.toLocaleLowerCase(locale).includes(term)));

    return (
        <div className="portal-page max-w-4xl">
            <div>
                <h1 className="portal-title">{t.ordersTitle}</h1>
                <p className="portal-muted">{t.ordersIntro}</p>
                <p className="portal-muted mt-2 min-h-5 text-xs">{updated ? formatDoctorText(t.updatedRelative, relativeTime(updated, now, locale, t.justNow)) : ''}</p>
            </div>

            <div className="portal-order-filters space-y-2">
                <div role="group" aria-label={t.caseFilters} className="flex gap-2 overflow-x-auto p-1">
                    {filters.map(({ id, label }) => (
                        <button key={id} type="button" aria-pressed={activeFilter === id} onClick={() => setActiveFilter(id)} className="portal-chip shrink-0 whitespace-nowrap">
                            {label} <span className="tabular-nums opacity-90">{counts[id].toLocaleString(locale)}</span>
                        </button>
                    ))}
                </div>
                <div className="relative">
                    <Search aria-hidden="true" size={18} className="pointer-events-none absolute start-3 top-3.5 text-slate-500 dark:text-slate-400" />
                    <input ref={searchRef} aria-label={t.searchOrders} placeholder={t.searchOrders} value={searchTerm}
                        onChange={event => setSearchTerm(event.target.value)} className="portal-input portal-search" />
                    {searchTerm && <button type="button" aria-label={t.clearSearch} onClick={() => { setSearchTerm(''); searchRef.current?.focus(); }} className="portal-action absolute inset-y-0 end-0"><X size={18} /></button>}
                </div>
            </div>

            {loading && <PortalSkeleton label={t.loadingCases} />}
            {!loading && failed && <PortalError message={t.loadCasesError} retry={() => void loadOrders()} />}
            {!loading && !failed && filteredOrders.length === 0 && (
                <Card initial={false} className="portal-card space-y-3 text-center">
                    <Package size={30} aria-hidden="true" className="mx-auto text-blue-700 dark:text-blue-300" />
                    <h2 className="font-semibold">{orders.length ? t.noMatchingCases : t.noCases}</h2>
                    <p className="portal-muted">{orders.length ? t.changeFilters : t.firstCaseHelp}</p>
                    {orders.length
                        ? <button type="button" className="portal-primary" onClick={() => { setSearchTerm(''); setActiveFilter('all'); searchRef.current?.focus(); }}>{t.resetCaseFilters}</button>
                        : <Link className="portal-primary" to="/doctor/new-request">{t.newCase}</Link>}
                </Card>
            )}

            <div className="space-y-3">
                {filteredOrders.map(order => {
                    const state = caseFilter(order);
                    const workflowIndex = stageIndex(order);
                    const atTryIn = order.productionStatus === 'waiting_doctor' || order.productionStatus === 'try_in_ready';
                    const preparingTryIn = order.hasTryIn && order.productionStatus === 'in_production';
                    const stageLabels = [
                        t.stageReceived, t.stageDesignShort, ...(order.hasTryIn ? [t.trialStep] : []),
                        t.stageProductionShort, t.stageReady, t.stageDelivered,
                    ];
                    const index = workflowIndex + (order.hasTryIn && workflowIndex >= 2 && !atTryIn && !preparingTryIn ? 1 : 0);
                    const stage = state === 'issues' ? t.needsAttention
                        : order.productionStatus === 'waiting_doctor' ? t.stageTryIn
                        : order.productionStatus === 'try_in_ready' ? t.trialReady
                        : preparingTryIn ? t.preparingTryIn
                        : state === 'in_delivery' && order.shipmentStatus === 'dispatched' ? t.dispatched
                        : stageLabels[index];
                    const filesOpen = filesOrderId === order.id;
                    const review = reviews.find(item => item.order_id === order.id);
                    const tryInRequest = tryInRequests.find(item => item.order_id === order.id);
                    const expanded = expandedId === order.id;
                    const submitted = Date.parse(order.createdAt);
                    return <Card initial={false} key={order.id} className="portal-card space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-x-3">
                            <h2 className="min-w-0 break-words text-lg font-bold" dir="auto">{order.patientName}</h2>
                            <button type="button" className="portal-action max-w-full gap-1 text-xs text-blue-700 dark:text-blue-300"
                                aria-label={t.copyCaseReference + ' ' + order.caseId} onClick={() => void copy(order.caseId)}>
                                <bdi dir="ltr" className="break-all tabular-nums">{order.caseId}</bdi><Copy aria-hidden="true" size={14} />
                            </button>
                        </div>
                        <div className="portal-muted flex flex-wrap gap-x-3 text-xs">
                            {order.doctorName && order.doctorName !== user?.name && <span dir="auto">{order.doctorName}</span>}
                            {Number.isFinite(submitted) && <span>{formatDoctorText(t.submittedRelative, relativeTime(submitted, now, locale, t.justNow))}</span>}
                        </div>
                        <span className="portal-status" data-status={state}>{stage}</span>
                        {tryInRequest && <DoctorTryInResponse request={tryInRequest} reload={() => loadOrders(true)} />}
                        {review?.state === 'pending' && (
                            <button type="button" aria-expanded={filesOpen} aria-controls={'files-' + order.id}
                                className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 text-start text-sm font-bold text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                                onClick={() => {
                                    setFilesOrderId(filesOpen ? '' : order.id);
                                    if (!filesOpen) requestAnimationFrame(() =>
                                        document.getElementById('files-' + order.id)?.focus());
                                }}>
                                <Clock size={16} aria-hidden="true" />
                                {t.designInputRequired}
                            </button>
                        )}
                        {order.pickupStatus && <p className="portal-muted">{doctorPickupLabels(t)[order.pickupStatus]}</p>}
                        {state !== 'issues' && <>
                            <button type="button" className="portal-action w-full justify-between rounded-xl bg-slate-100 px-3 text-xs font-semibold dark:bg-slate-800 md:hidden"
                                aria-controls={'stages-' + order.id} aria-expanded={expanded} onClick={() => setExpandedId(expanded ? '' : order.id)}>
                                <span>{stage} <span className="sr-only">{expanded ? t.hideStages : t.showStages}</span></span>
                                <span aria-hidden="true" className="h-1.5 w-1/3 overflow-hidden rounded-full bg-slate-300 dark:bg-slate-700">
                                    <span className="block h-full rounded-full bg-blue-700 dark:bg-blue-400" style={{ width: ((index + 1) / stageLabels.length) * 100 + '%' }} />
                                </span>
                                <ChevronDown size={16} aria-hidden="true" className={expanded ? 'rotate-180' : ''} />
                            </button>
                            <ol id={'stages-' + order.id} aria-label={t.caseProgress} className={`${expanded ? 'grid' : 'hidden'} gap-1 text-center md:grid ${order.hasTryIn ? 'grid-cols-6' : 'grid-cols-5'}`}>
                                {stageLabels.map((label, step) => <li key={label} aria-current={index === step ? 'step' : undefined} className="portal-muted text-xs leading-snug">
                                    <span className={`mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full font-bold ${step <= index ? 'bg-blue-700 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{step < index ? <Check size={15} aria-hidden="true" /> : (step + 1).toLocaleString(locale)}</span>
                                    {label}
                                </li>)}
                            </ol>
                        </>}
                        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                            <Link className="portal-chip" to={'/doctor/support?case=' + encodeURIComponent(order.id)}><MessageCircle size={16} aria-hidden="true" />{t.messageTheLab}</Link>
                            <button ref={node => { if (node) fileTriggers.current.set(order.id, node); else fileTriggers.current.delete(order.id); }}
                                type="button" aria-expanded={filesOpen} aria-controls={'files-' + order.id} className="portal-chip" onClick={() => setFilesOrderId(filesOpen ? '' : order.id)}>
                                <FolderOpen size={16} aria-hidden="true" />{t.caseFiles}
                            </button>
                            {state === 'delivered' && !order.feedback && <button type="button" className="portal-chip" onClick={() => { setRatingOrder(order); setRating(5); setSelectedTags([]); setFeedbackNotes(''); }}><Star size={16} aria-hidden="true" />{t.rateCase}</button>}
                        </div>
                        {order.feedback && state === 'delivered' && <p className="portal-muted text-xs">{t.yourRating} <bdi dir="ltr">{order.feedback.rating} / 5</bdi></p>}
                        {filesOpen && <section id={'files-' + order.id} tabIndex={-1} className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60" aria-label={t.caseFiles}>
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="font-bold">{t.caseFiles}</h3>
                                <button type="button" className="portal-action text-sm font-semibold" onClick={() => { setFilesOrderId(''); fileTriggers.current.get(order.id)?.focus(); }}><X size={16} aria-hidden="true" />{t.hideFiles}</button>
                            </div>
                            {order.stlUrl && /^https?:\/\//i.test(order.stlUrl) && <a className="portal-chip" href={order.stlUrl} target="_blank" rel="noopener noreferrer">{t.scanLink}</a>}
                            {order.imagesUrl && /^https?:\/\//i.test(order.imagesUrl) && <a className="portal-chip" href={order.imagesUrl} target="_blank" rel="noopener noreferrer">{t.photosLink}</a>}
                            <CaseAttachments portalText={t} orderId={order.id} kind="instruction" canUpload accept={ACCEPTED_TYPES + ',' + SCAN_ACCEPTED_TYPES} label={t.scanAttachments} />
                            {review && <DoctorDesignReview key={review.revision_id} review={review} reload={() => loadOrders(true)} />}
                        </section>}
                    </Card>;
                })}
            </div>
            {ratingOrder && (
                <RatingDialog onClose={() => setRatingOrder(null)}>
                    <Card initial={false} className="w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 rounded-3xl border border-slate-200 dark:border-slate-800">
                        <div className="text-center">
                            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 mx-auto flex items-center justify-center mb-2 font-bold">
                                <Smile size={26} />
                            </div>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">{t.rateCaseQuality}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {t.caseLabel} <bdi dir="ltr">{ratingOrder.caseId}</bdi> {t.patientLabel} {ratingOrder.patientName}
                            </p>
                        </div>

                        {/* Interactive Stars */}
                        <div className="flex justify-center gap-0 py-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(star)}
                                    aria-label={formatDoctorText(t.starRating, star.toLocaleString(locale))}
                                    aria-pressed={star === rating} className="portal-action cursor-pointer"
                                >
                                    <Star
                                        size={36}
                                        className={star <= rating ? "text-amber-400 fill-amber-400" : "text-slate-200 dark:text-slate-700 fill-slate-100 dark:fill-slate-800"}
                                    />
                                </button>
                            ))}
                        </div>

                        {/* Quick Tags Chips */}
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">
                                {t.quickFeedback}
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {quickFeedbackTags.map(({ tag, Icon }) => {
                                    const isSelected = selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            aria-pressed={isSelected}
                                            type="button"
                                            onClick={() => toggleFeedbackTag(tag)}
                                            className={`portal-action text-xs font-bold px-2.5 rounded-xl ${
                                                isSelected
                                                    ? 'bg-blue-700 text-white'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            <Icon size={15} aria-hidden="true" /> {tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Optional Notes */}
                        <div>
                            <label htmlFor="case-feedback-notes" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                {t.optionalFeedback}
                            </label>
                            <textarea id="case-feedback-notes"
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-xs h-20 resize-none dark:text-white"
                                placeholder={t.feedbackPlaceholder}
                                value={feedbackNotes}
                                onChange={e => setFeedbackNotes(e.target.value)}
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setRatingOrder(null)}
                                className="flex-1 rounded-xl text-xs"
                            >
                                {t.cancel}
                            </Button>
                            <Button
                                type="button"
                                disabled={isSubmittingRating}
                                onClick={handleRateSubmit}
                                className="portal-primary flex-1"
                            >
                                {isSubmittingRating ? t.saving : t.sendRating}
                            </Button>
                        </div>
                    </Card>
                </RatingDialog>
            )}
        </div>
    );
}
