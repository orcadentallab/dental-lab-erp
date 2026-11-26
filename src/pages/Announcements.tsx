import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Megaphone, Search, Send, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { db, type Doctor } from '../services/db';
import { useToast } from '../context/ToastContext';

const TITLE_MAX = 80;
const BODY_MAX = 180;

type AudienceKind = 'single' | 'selection' | 'all';

interface PreviewDoctor {
    id: string;
    name: string;
    subscription_count: number;
}

interface RecentAllSend {
    id: string;
    sent_at: string;
    title_ar: string;
    title_en: string;
    recipient_count: number;
}

interface PreviewResponse {
    recipient_count: number;
    doctors: PreviewDoctor[];
    recent_all_send: RecentAllSend | null;
}

interface AnnouncementLogRow {
    id: string;
    sent_at: string;
    title_en: string;
    title_ar: string;
    body_en: string;
    body_ar: string;
    audience_kind: string;
    audience_summary: string;
    recipient_count: number;
    delivered_count: number;
    failed_count: number;
}

export default function Announcements() {
    const { success, error: toastError } = useToast();

    const [titleAr, setTitleAr] = useState('');
    const [titleEn, setTitleEn] = useState('');
    const [bodyAr, setBodyAr] = useState('');
    const [bodyEn, setBodyEn] = useState('');

    const [audienceKind, setAudienceKind] = useState<AudienceKind>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Doctor[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedDoctors, setSelectedDoctors] = useState<Doctor[]>([]);

    const [previewLoading, setPreviewLoading] = useState(false);
    const [preview, setPreview] = useState<PreviewResponse | null>(null);
    const [sending, setSending] = useState(false);

    const [logs, setLogs] = useState<AnnouncementLogRow[]>([]);
    const [logsLoading, setLogsLoading] = useState(true);

    const loadLogs = useCallback(async () => {
        setLogsLoading(true);
        try {
            const { data, error } = await supabase
                .from('announcement_sends')
                .select('*')
                .order('sent_at', { ascending: false })
                .limit(30);
            if (!error && data) {
                setLogs(data as AnnouncementLogRow[]);
            }
        } finally {
            setLogsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadLogs();
    }, [loadLogs]);

    // Debounced doctor search for single / multi-select audience
    useEffect(() => {
        if (audienceKind === 'all') {
            setSearchResults([]);
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setSearching(true);
            try {
                const list = await db.getDoctors(searchTerm.trim() || undefined);
                if (!cancelled) setSearchResults(list.slice(0, 15));
            } catch {
                if (!cancelled) setSearchResults([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [audienceKind, searchTerm]);

    const addDoctor = (doc: Doctor) => {
        if (audienceKind === 'single') {
            setSelectedDoctors([doc]);
            return;
        }
        setSelectedDoctors((prev) => (prev.some((item) => item.id === doc.id) ? prev : [...prev, doc]));
    };

    const removeDoctor = (id: string) => {
        setSelectedDoctors((prev) => prev.filter((item) => item.id !== id));
    };

    const canSubmitForm =
        titleAr.trim().length > 0 &&
        titleEn.trim().length > 0 &&
        bodyAr.trim().length > 0 &&
        bodyEn.trim().length > 0 &&
        (audienceKind === 'all' || selectedDoctors.length > 0);

    const audienceSummary =
        audienceKind === 'all'
            ? 'كل الأطباء المشتركين'
            : selectedDoctors.length === 1
                ? selectedDoctors[0].name
                : `${selectedDoctors.length} أطباء محددين`;

    const handlePreview = async () => {
        if (!canSubmitForm || previewLoading) return;
        setPreviewLoading(true);
        try {
            const doctorIds = audienceKind === 'all' ? null : selectedDoctors.map((d) => d.id);
            const { data, error } = await supabase.rpc('get_promotional_push_preview', {
                p_audience_kind: audienceKind,
                p_doctor_ids: doctorIds,
            });
            if (error) throw new Error(error.message);
            setPreview(data as PreviewResponse);
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر حساب المستلمين');
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleConfirmSend = async () => {
        if (!preview || preview.recipient_count === 0 || sending) return;
        setSending(true);
        try {
            const { data, error } = await supabase.functions.invoke('send-push', {
                body: {
                    category: 'promotional',
                    title_en: titleEn.trim(),
                    title_ar: titleAr.trim(),
                    body_en: bodyEn.trim(),
                    body_ar: bodyAr.trim(),
                    audience_kind: audienceKind,
                    audience_summary: audienceSummary,
                    doctor_ids: audienceKind === 'all' ? [] : selectedDoctors.map((d) => d.id),
                },
            });
            if (error) throw new Error(error.message);
            const res = data as { delivered_count?: number; recipient_count?: number } | null;
            success(`تم إرسال الإعلان (${res?.delivered_count ?? 0} من ${res?.recipient_count ?? preview.recipient_count})`);
            setPreview(null);
            setTitleAr('');
            setTitleEn('');
            setBodyAr('');
            setBodyEn('');
            setSelectedDoctors([]);
            await loadLogs();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر إرسال الإشعار الترويجي');
        } finally {
            setSending(false);
        }
    };

    return (
        <div dir="rtl" className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
            <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-sm">
                    <Megaphone size={22} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">الإعلانات والعروض الترويجية</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        إرسال إشعارات ترويجية فورية للأطباء المشتركين (مستقلة عن إشعارات الحالات).
                    </p>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-5">
                <p className="rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-xs font-medium text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                    تذكير: استخدم أسلوبًا مهنيًا موجّهًا للأطباء، دون ذكر أي معامل خارجية أو مصطلحات فحص داخلي.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                            <label htmlFor="promo-title-ar">العنوان (عربي)</label>
                            <span className="tabular-nums text-slate-500">{titleAr.length} / {TITLE_MAX}</span>
                        </div>
                        <input
                            id="promo-title-ar"
                            type="text"
                            maxLength={TITLE_MAX}
                            value={titleAr}
                            onChange={(e) => setTitleAr(e.target.value)}
                            placeholder="مثال: عرض خاص على تيجان الزركونيا"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                            <label htmlFor="promo-title-en">العنوان (English)</label>
                            <span className="tabular-nums text-slate-500">{titleEn.length} / {TITLE_MAX}</span>
                        </div>
                        <input
                            id="promo-title-en"
                            dir="ltr"
                            type="text"
                            maxLength={TITLE_MAX}
                            value={titleEn}
                            onChange={(e) => setTitleEn(e.target.value)}
                            placeholder="e.g. Special Zirconia Crown Offer"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                            <label htmlFor="promo-body-ar">نص الإشعار (عربي)</label>
                            <span className="tabular-nums text-slate-500">{bodyAr.length} / {BODY_MAX}</span>
                        </div>
                        <textarea
                            id="promo-body-ar"
                            rows={3}
                            maxLength={BODY_MAX}
                            value={bodyAr}
                            onChange={(e) => setBodyAr(e.target.value)}
                            placeholder="اكتب نص الإعلان المختصر باللغة العربية..."
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                            <label htmlFor="promo-body-en">نص الإشعار (English)</label>
                            <span className="tabular-nums text-slate-500">{bodyEn.length} / {BODY_MAX}</span>
                        </div>
                        <textarea
                            id="promo-body-en"
                            dir="ltr"
                            rows={3}
                            maxLength={BODY_MAX}
                            value={bodyEn}
                            onChange={(e) => setBodyEn(e.target.value)}
                            placeholder="Write the short announcement message in English..."
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                    </div>
                </div>

                {/* Audience Picker */}
                <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">الجمهور المستهدف</p>
                    <div className="flex flex-wrap gap-2">
                        {([
                            { id: 'all', label: 'كل الأطباء المشتركين' },
                            { id: 'single', label: 'طبيب واحد' },
                            { id: 'selection', label: 'اختيار متعدد من الأطباء' },
                        ] as const).map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                                    setAudienceKind(option.id);
                                    if (option.id === 'single' && selectedDoctors.length > 1) {
                                        setSelectedDoctors([selectedDoctors[0]]);
                                    }
                                }}
                                className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors ${
                                    audienceKind === option.id
                                        ? 'border-primary-600 bg-primary-600 text-white'
                                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    {audienceKind !== 'all' && (
                        <div className="space-y-2.5">
                            {selectedDoctors.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {selectedDoctors.map((doc) => (
                                        <span
                                            key={doc.id}
                                            className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800 dark:bg-primary-950/60 dark:text-primary-200"
                                        >
                                            {doc.name}
                                            <button
                                                type="button"
                                                aria-label={`إزالة ${doc.name}`}
                                                onClick={() => removeDoctor(doc.id)}
                                                className="rounded-full p-0.5 hover:bg-primary-200/60"
                                            >
                                                <X size={13} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div className="relative">
                                <Search size={16} className="pointer-events-none absolute start-3 top-3 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="ابحث باسم الطبيب أو الكود..."
                                    className="w-full rounded-xl border border-slate-300 bg-white py-2 ps-9 pe-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                />
                            </div>

                            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 dark:border-slate-700 dark:divide-slate-800">
                                {searching && (
                                    <p className="p-3 text-xs text-slate-500">جاري البحث...</p>
                                )}
                                {!searching && searchResults.length === 0 && (
                                    <p className="p-3 text-xs text-slate-500">لا توجد نتائج مطابقة.</p>
                                )}
                                {!searching && searchResults.map((doc) => {
                                    const picked = selectedDoctors.some((item) => item.id === doc.id);
                                    return (
                                        <button
                                            key={doc.id}
                                            type="button"
                                            onClick={() => addDoctor(doc)}
                                            className="flex w-full items-center justify-between px-3 py-2 text-start text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                                        >
                                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                                                {doc.name} <span className="text-slate-400">({doc.doctorCode})</span>
                                            </span>
                                            {picked && <CheckCircle2 size={15} className="text-emerald-600" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-2">
                    <button
                        type="button"
                        disabled={!canSubmitForm || previewLoading}
                        onClick={() => void handlePreview()}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Send size={16} className="rtl:rotate-180" />
                        {previewLoading ? 'جاري احتساب المستلمين...' : 'معاينة وإرسال'}
                    </button>
                </div>
            </div>

            {/* Confirmation Dialog */}
            {preview && (
                <div role="dialog" aria-modal="true" aria-label="تأكيد إرسال الإعلان" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">تأكيد إرسال الإعلان الترويجي</h2>
                            <button type="button" onClick={() => setPreview(null)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
                                <X size={18} />
                            </button>
                        </div>

                        {preview.recent_all_send && (
                            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                <AlertTriangle size={18} className="shrink-0 text-amber-600" />
                                <div>
                                    <p className="font-bold">تنبيه: تم إرسال إعلان جماعي خلال آخر 24 ساعة</p>
                                    <p className="mt-0.5">
                                        &laquo;{preview.recent_all_send.title_ar}&raquo; ({new Date(preview.recent_all_send.sent_at).toLocaleString('ar-EG')})
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                            <Users size={18} className="text-primary-600" />
                            <span>
                                عدد الأجهزة المستلمة فعليًا (بعد تصفية إلغاء الاشتراك):{' '}
                                <strong className="tabular-nums">{preview.recipient_count}</strong>
                            </span>
                        </div>

                        {preview.recipient_count === 0 ? (
                            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                                لا يوجد أطباء مشتركين في الإشعارات الترويجية ضمن هذا الاختيار. لا يمكن الإرسال.
                            </p>
                        ) : (
                            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-700">
                                <p className="mb-1.5 font-bold text-slate-600 dark:text-slate-300">الأطباء المستهدفون ({preview.doctors.length}):</p>
                                <ul className="space-y-1">
                                    {preview.doctors.map((d) => (
                                        <li key={d.id} className="flex items-center justify-between text-slate-800 dark:text-slate-100">
                                            <span>{d.name}</span>
                                            <span className="text-slate-500 tabular-nums">{d.subscription_count} جهاز</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setPreview(null)}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
                            >
                                إلغاء
                            </button>
                            <button
                                type="button"
                                disabled={preview.recipient_count === 0 || sending}
                                onClick={() => void handleConfirmSend()}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Send size={14} className="rtl:rotate-180" />
                                {sending ? 'جاري الإرسال...' : 'تأكيد وإرسال الآن'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Past Sends Log */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">سجل الإعلانات المرسلة</h2>
                {logsLoading ? (
                    <p className="text-xs text-slate-500">جاري تحميل السجل...</p>
                ) : logs.length === 0 ? (
                    <p className="text-xs text-slate-500">لم يتم إرسال أي إعلانات ترويجية بعد.</p>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {logs.map((row) => (
                            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                                <div className="min-w-0 space-y-0.5">
                                    <p className="font-bold text-slate-900 dark:text-white">{row.title_ar} — <span dir="ltr" className="font-medium text-slate-600 dark:text-slate-300">{row.title_en}</span></p>
                                    <p className="text-slate-600 dark:text-slate-400">الجمهور: {row.audience_summary}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-200 tabular-nums">
                                    <span>المستهدف: <strong>{row.recipient_count}</strong></span>
                                    <span className="text-emerald-700 dark:text-emerald-400">تم التسليم: <strong>{row.delivered_count}</strong></span>
                                    {row.failed_count > 0 && (
                                        <span className="text-rose-700 dark:text-rose-400">فشل: <strong>{row.failed_count}</strong></span>
                                    )}
                                    <span className="text-slate-500">{new Date(row.sent_at).toLocaleString('ar-EG')}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
