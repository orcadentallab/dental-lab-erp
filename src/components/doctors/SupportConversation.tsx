import { useState, type FormEvent } from 'react';
import { doctorPortalService, type SupportThread } from '../../services/doctorPortalService';
import type { DoctorPortalText } from '../../translations/doctorPortal';

export default function SupportConversation({ thread, text, lab, reload }: {
    thread: SupportThread;
    text: DoctorPortalText;
    lab?: boolean;
    reload: () => Promise<unknown>;
}) {
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    async function write(action: 'reply' | 'close') {
        setBusy(true);
        setFailed(false);
        try {
            await doctorPortalService.writeThread(action, { threadId: thread.id, body });
            setBody('');
            await reload();
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    }

    function reply(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (body.trim() && !busy) void write('reply');
    }

    return <details className="portal-card space-y-3" open={!thread.closed_at}>
        <summary className="cursor-pointer font-semibold">
            {lab && <span className="me-2">{thread.doctor_name}</span>}
            {thread.subject && <span className="me-2" dir="auto">{thread.subject}</span>}
            {thread.case_id ? <bdi>{thread.case_id}</bdi> : text.generalConversation}
            <span className="portal-muted ms-2 font-normal">{thread.closed_at ? text.conversationClosed : text.conversationOpen}</span>
        </summary>
        <div className="space-y-2" aria-label={text.conversation}>
            {thread.posts.map(post => <div key={post.id}
                className={`max-w-[90%] rounded-xl px-3 py-2 ${post.from_lab === Boolean(lab) ? 'ms-auto bg-blue-50 dark:bg-blue-950' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <div className="portal-muted text-xs">{post.from_lab ? text.labReply : thread.doctor_name}</div>
                <p className="whitespace-pre-wrap break-words text-sm" dir="auto">{post.body}</p>
                <time className="portal-muted text-xs" dateTime={post.created_at}>{new Date(post.created_at).toLocaleString()}</time>
            </div>)}
        </div>
        {!thread.closed_at && <form onSubmit={reply} className="space-y-2">
            <label className="portal-field">{text.messageLabel}
                <textarea className="portal-input" rows={2} maxLength={4000} value={body}
                    onChange={event => setBody(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
                <button className="portal-primary" disabled={busy || !body.trim()}>{text.sendMessage}</button>
                <button type="button" className="portal-chip" disabled={busy} onClick={() => void write('close')}>{text.resolveConversation}</button>
            </div>
        </form>}
        {failed && <p role="alert" className="text-sm text-red-700">{text.sendMessageError}</p>}
    </details>;
}
