import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { MessageCircle, Send, CheckCheck, Clock } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { doctorPortalService } from '../../services/doctorPortalService';
import type { DoctorSupportData } from '../../layouts/DoctorPortalLayout';
import { PortalError, PortalSkeleton } from '../../components/doctors/PortalStates';
import SupportConversation from '../../components/doctors/SupportConversation';
import { db, type DoctorOrderSummary } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { subscribeToPush } from '../../lib/pushNotifications';


export default function DoctorSupport() {
    const { t, locale, language } = useDoctorLanguage();
    const { user } = useAuth();
    const quickTopics = [t.deliveryTopic, t.adjustmentTopic, t.accountInquiry, t.pickupTopic];
    const [params, setParams] = useSearchParams();
    const caseId = params.get('case') || '';
    const { messages, threads, loading, failed, reload } = useOutletContext<DoctorSupportData>();
    const selectedThread = threads.find(thread => !thread.closed_at && (thread.order_id ?? '') === caseId);
    const [cases, setCases] = useState<DoctorOrderSummary[]>([]);
    const [body, setBody] = useState('');
    const [attachment, setAttachment] = useState<File>();
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<'sendMessageError' | ''>('');
    const [caseLoadFailed, setCaseLoadFailed] = useState(false);

    useEffect(() => {
        let active = true;
        void db.getMyDoctorOrders().then(result => { if (active) setCases(result); })
            .catch(() => { if (active) setCaseLoadFailed(true); });
        return () => { active = false; };
    }, []);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || (!body.trim() && !attachment) || body.length > 4000) return;
        setBusy(true);
        setError('');
        setSent(false);
        try {
            await doctorPortalService.writeChat('start', { body, orderId: caseId, file: attachment });
            setBody('');
            setAttachment(undefined);
            setSent(true);
            await reload();
            if (user?.auth_id && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                void subscribeToPush(user.auth_id, language);
            }
        } catch {
            setError('sendMessageError');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="portal-page max-w-3xl">
            <div>
                <h1 className="portal-title">{t.contactLab}</h1>
                <p className="portal-muted">
                    {t.contactLabIntro}
                </p>
            </div>

            <Card initial={false} className="portal-card">
                <form className="space-y-3" onSubmit={submit}>
                    <h2 className="font-semibold">{selectedThread ? t.replyToConversation : t.newConversation}</h2>
                    <label className="portal-field">{t.conversationCase}
                        <select className="portal-input" value={caseId}
                            onChange={event => setParams(event.target.value ? { case: event.target.value } : {})}>
                            <option value="">{t.generalConversation}</option>
                            {caseId && !cases.some(order => order.id === caseId) && <option value={caseId}>{t.linkedMessage}</option>}
                            {cases.map(order => <option key={order.id} value={order.id}>{order.caseId} · {order.patientName}</option>)}
                        </select>
                    </label>
                    {caseLoadFailed && <p role="alert" className="portal-muted">{t.loadCasesError}</p>}
                    <div className="flex flex-wrap gap-1.5" aria-label={t.quickTopics}>
                        {quickTopics.map(topic => (
                            <button
                                key={topic}
                                type="button"
                                onClick={() => {
                                    setSent(false);
                                    setBody(current => (current ? `${current}\n${topic}` : topic).slice(0, 4000));
                                }}
                                className="portal-chip"
                            >
                                {topic}
                            </button>
                        ))}
                    </div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                        {t.messageLabel}
                        <textarea
                            id="doctor-support-message" aria-label={t.messageLabel}
                            maxLength={4000}
                            rows={4}
                            value={body}
                            onChange={event => { setBody(event.target.value); setSent(false); }}
                            className="block w-full mt-2 p-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                        />
                    </label>
                    <div className="flex items-center justify-between gap-3">
                        <label className="portal-chip cursor-pointer">
                            {attachment?.name || (language === 'ar' ? 'أرفق صورة أو PDF' : 'Attach image or PDF')}
                            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file && file.size <= 10 * 1024 * 1024) setAttachment(file);
                                else if (file) setError('sendMessageError');
                            }} />
                        </label>
                        {attachment && <button type="button" className="portal-chip" disabled={busy} onClick={() => setAttachment(undefined)}>
                            {language === 'ar' ? 'إزالة' : 'Remove'}
                        </button>}
                        <button
                            disabled={busy || (!body.trim() && !attachment)}
                            className="portal-primary"
                        >
                            <Send size={16} className="rtl:rotate-180" />
                            <span>{busy ? t.sendingMessage : t.sendMessage}</span>
                        </button>
                    </div>
                    {sent && <p role="status" className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{t.messageSent}</p>}
                    {error && <p role="alert" className="text-xs font-bold text-red-600 dark:text-red-400">{t[error]}</p>}
                </form>
            </Card>

            <div className="space-y-3">
                <div className="flex justify-end">
                    <button type="button" onClick={() => void reload()} className="min-h-11 px-3 text-sm font-bold text-blue-600 dark:text-blue-400">
                        {t.refreshReplies}
                    </button>
                </div>
                {loading && <PortalSkeleton label={t.loadingMessages} />}
                {!loading && failed && <PortalError message={t.loadMessagesError} retry={() => void reload()} />}
                {!loading && !failed && messages.length === 0 && threads.length === 0 && (
                    <Card initial={false} className="portal-card space-y-2 text-center">
                        <MessageCircle size={30} aria-hidden="true" className="mx-auto text-blue-700 dark:text-blue-300" />
                        <p className="font-semibold">{t.noMessages}</p>
                        <p className="portal-muted">{t.noMessagesHelp}</p>
                        <button type="button" className="portal-primary" onClick={() => document.getElementById('doctor-support-message')?.focus()}>{t.openComposer}</button>
                    </Card>
                )}
                {threads.map(thread => <SupportConversation key={thread.id} thread={thread} text={t} rtl={language === 'ar'} reload={reload} />)}
                {messages.map(message => (
                    <Card initial={false} key={message.id} className="portal-card space-y-3">
                        <p className="portal-muted text-xs">
                            {message.case_id ? <bdi dir="ltr">{message.case_id}</bdi> : t.generalInquiry} — {new Date(message.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
                        </p>
                        <p className="text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-100">{message.body}</p>
                        {message.reply ? (
                            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 p-3 space-y-1">
                                <p className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-300"><CheckCheck size={14} />{t.labReply}</p>
                                <p className="text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-100">{message.reply}</p>
                            </div>
                        ) : (
                            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Clock size={14} />{t.awaitingReply}</p>
                        )}
                    </Card>
                ))}
            </div>

            <Link to="/doctor/my-orders" className="portal-chip">{t.backToCases}</Link>
        </div>
    );
}
