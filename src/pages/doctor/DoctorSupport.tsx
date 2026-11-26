import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { MessageCircle, Send, CheckCheck, Clock } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { doctorPortalService } from '../../services/doctorPortalService';
import type { DoctorSupportData } from '../../layouts/DoctorPortalLayout';
import { PortalError, PortalSkeleton } from '../../components/doctors/PortalStates';
import { useAuth } from '../../context/AuthContext';
import { subscribeToPush } from '../../lib/pushNotifications';


export default function DoctorSupport() {
    const { t, locale, language } = useDoctorLanguage();
    const { user } = useAuth();
    const quickTopics = [t.deliveryTopic, t.adjustmentTopic, t.accountInquiry, t.pickupTopic];
    const [params] = useSearchParams();
    const caseId = params.get('case') || undefined;
    const { messages, loading, failed, reload } = useOutletContext<DoctorSupportData>();
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<'sendMessageError' | ''>('');

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || !body.trim() || body.length > 4000) return;
        setBusy(true);
        setError('');
        setSent(false);
        try {
            await doctorPortalService.send(body, caseId);
            setBody('');
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
                    {caseId && (
                        <p className="text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded-lg px-3 py-2">
                            {t.linkedMessage}
                        </p>
                    )}
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
                            required
                            maxLength={4000}
                            rows={4}
                            value={body}
                            onChange={event => { setBody(event.target.value); setSent(false); }}
                            className="block w-full mt-2 p-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                        />
                    </label>
                    <div className="flex items-center justify-between gap-3">
                        <span className="portal-muted text-xs">{body.length} / 4000</span>
                        <button
                            disabled={busy || !body.trim()}
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
                {!loading && !failed && messages.length === 0 && (
                    <Card initial={false} className="portal-card space-y-2 text-center">
                        <MessageCircle size={30} aria-hidden="true" className="mx-auto text-blue-700 dark:text-blue-300" />
                        <p className="font-semibold">{t.noMessages}</p>
                        <p className="portal-muted">{t.noMessagesHelp}</p>
                        <button type="button" className="portal-primary" onClick={() => document.getElementById('doctor-support-message')?.focus()}>{t.openComposer}</button>
                    </Card>
                )}
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
