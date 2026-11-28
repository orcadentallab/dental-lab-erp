import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Eye, Paperclip, Send, X } from 'lucide-react';
import type { DoctorPortalText } from '../../translations/doctorPortal';
import { doctorPortalService, type ChatWrite, type SupportThread } from '../../services/doctorPortalService';
import { refreshDoctorChat } from '../../hooks/useDoctorChat';
import { notifyNotificationStateChange } from '../../services/supabase/notificationService';

export function ChatUnread({ count = 0 }: { count?: number }) {
    return count > 0 ? <span className="rounded-full bg-teal-700 px-2 py-0.5 text-xs font-bold tabular-nums text-white"
        aria-label={`${count} رسائل غير مقروءة`}>{count > 99 ? '99+' : count}</span> : null;
}

export function DoctorChatComposer({ submit, placeholder, button, error, attachLabel, rtl }: {
    submit: (body: string, file?: File) => Promise<unknown>;
    placeholder: string;
    button: string;
    error: string;
    attachLabel: string;
    rtl: boolean;
}) {
    const [body, setBody] = useState('');
    const [file, setFile] = useState<File>();
    const [busy, setBusy] = useState(false);
    const sending = useRef(false);
    const [failure, setFailure] = useState('');
    async function send(event: FormEvent) {
        event.preventDefault();
        if (sending.current || (!body.trim() && !file)) return;
        sending.current = true;
        setBusy(true);
        setFailure('');
        try {
            await submit(body, file);
            setBody('');
            setFile(undefined);
        } catch {
            setFailure(error);
        } finally {
            sending.current = false;
            setBusy(false);
        }
    }
    return <form className="space-y-2 border-t border-surface-200 p-3" onSubmit={send}>
        <textarea className="w-full resize-y rounded-xl border border-surface-300 bg-surface-50 p-3 text-sm outline-none focus:ring-2 focus:ring-teal-500"
            dir="auto" value={body} rows={2} maxLength={4000} disabled={busy} aria-label={placeholder} placeholder={placeholder}
            onChange={event => setBody(event.target.value)}
            onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                }
            }} />
        {file && <div className="flex min-w-0 items-center gap-2 text-sm">
            <bdi className="truncate">{file.name}</bdi>
            <button type="button" onClick={() => setFile(undefined)} aria-label={rtl ? 'إزالة المرفق' : 'Remove attachment'}><X size={16} /></button>
        </div>}
        {failure && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{failure}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-surface-200 px-3 text-sm focus-within:ring-2 focus-within:ring-teal-500">
                <Paperclip size={16} />{attachLabel}
                <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy}
                    onChange={event => {
                        const selected = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (!selected) return;
                        if (selected.size > 10 * 1024 * 1024) {
                            setFailure(rtl ? 'الحد الأقصى للمرفق ١٠ ميجابايت.' : 'Attachments must be 10 MB or smaller.');
                            return;
                        }
                        setFailure('');
                        setFile(selected);
                    }} />
            </label>
            <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-40"
                disabled={busy || (!body.trim() && !file)}><Send size={16} />{button}</button>
        </div>
    </form>;
}

export default function DoctorChatThread({ thread, lab, text, rtl, refresh }: {
    thread: SupportThread;
    lab?: boolean;
    text: DoctorPortalText;
    rtl: boolean;
    refresh: () => Promise<unknown>;
}) {
    const last = thread.posts.at(-1)?.id;
    const end = useRef<HTMLDivElement>(null);
    const [closing, setClosing] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!thread.unread || !last) return;
        void doctorPortalService.markChatRead(thread.id, last).then(() => {
            notifyNotificationStateChange();
            refreshDoctorChat();
        }).catch(() => undefined);
    }, [thread.id, thread.unread, last]);
    useEffect(() => {
        const container = end.current?.parentElement;
        if (container) container.scrollTop = container.scrollHeight;
    }, [last]);

    async function write(action: 'reply' | 'close', input: ChatWrite = {}) {
        await doctorPortalService.writeChat(action, { ...input, threadId: thread.id });
        await refresh();
        refreshDoctorChat();
    }

    const locale = rtl ? 'ar-EG' : 'en-GB';
    const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
    return <section className="flex min-h-0 flex-col bg-surface-0" aria-label={text.conversation}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-200 p-3">
            <div className="min-w-0">
                <p className="truncate font-bold" dir="auto">{thread.subject || (lab ? thread.doctor_name : text.conversation)}</p>
                <p className="text-xs text-surface-500"><bdi>{thread.case_id || text.generalConversation}</bdi> · {thread.closed_at ? text.conversationClosed : text.conversationOpen}</p>
            </div>
            {!thread.closed_at && <button type="button" className="rounded-lg border border-surface-200 px-3 py-2 text-xs font-semibold"
                disabled={closing} onClick={async () => {
                    setClosing(true);
                    setFailed(false);
                    try { await write('close'); } catch { setFailed(true); } finally { setClosing(false); }
                }}>{text.resolveConversation}</button>}
        </header>
        {lab && <div className="flex items-center gap-2 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 dark:bg-teal-950 dark:text-teal-100">
            <Eye size={15} /> ظاهر للطبيب
        </div>}
        <div className="min-h-32 flex-1 space-y-2 overflow-y-auto bg-surface-50 p-3" style={{ maxHeight: '48vh' }}>
            {thread.posts.map((post, index) => {
                const sent = post.from_lab === Boolean(lab);
                const date = new Date(post.created_at);
                const day = dayFormat.format(date);
                const previous = thread.posts[index - 1];
                return <div key={post.id}>
                    {(!previous || dayFormat.format(new Date(previous.created_at)) !== day) &&
                        <p className="my-2 text-center text-xs font-medium text-surface-500">{day}</p>}
                    <div className={`flex ${sent ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[88%] min-w-0 rounded-2xl px-3 py-2 ${sent
                            ? 'rounded-ee-none bg-teal-700 text-white'
                            : 'rounded-es-none border border-surface-200 bg-surface-0 text-surface-900'}`}>
                            <p className="mb-0.5 text-xs font-semibold opacity-90">{post.from_lab ? text.labReply : thread.doctor_name}</p>
                            {(post.body !== '📎' || !post.attachment_path) && <p dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{post.body}</p>}
                            {post.attachment_path && <button type="button"
                                className="flex max-w-full items-center gap-2 truncate rounded-md border border-current px-2 py-1 text-xs"
                                onClick={async () => {
                                    setFailed(false);
                                    try { await doctorPortalService.downloadChatAttachment(post.attachment_path!, post.attachment_name ?? 'attachment'); }
                                    catch { setFailed(true); }
                                }}><Download size={14} className="shrink-0" /><bdi className="truncate">{post.attachment_name}</bdi></button>}
                            <time className="block pt-0.5 text-[11px] opacity-90" dateTime={post.created_at}>{timeFormat.format(date)}</time>
                        </div>
                    </div>
                </div>;
            })}
            <div ref={end} />
        </div>
        {failed && <p role="alert" className="px-3 text-sm text-red-700 dark:text-red-300">{text.sendMessageError}</p>}
        {!thread.closed_at && <DoctorChatComposer rtl={rtl} button={text.sendMessage} error={text.sendMessageError}
            placeholder={lab ? `رسالة إلى د. ${thread.doctor_name}` : text.messageLabel}
            attachLabel={rtl ? 'أرفق صورة أو PDF' : 'Attach image or PDF'}
            submit={(body, file) => write('reply', { body, file })} />}
    </section>;
}
