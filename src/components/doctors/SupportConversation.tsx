import { useState } from 'react';
import type { SupportThread } from '../../services/doctorPortalService';
import type { DoctorPortalText } from '../../translations/doctorPortal';
import DoctorChatThread from './DoctorChatThread';

export default function SupportConversation({ thread, text, rtl, reload }: {
    thread: SupportThread;
    text: DoctorPortalText;
    rtl: boolean;
    reload: () => Promise<unknown>;
}) {
    const [open, setOpen] = useState(false);
    return <details className="portal-card" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-semibold">
            {thread.subject && <span className="me-2" dir="auto">{thread.subject}</span>}
            <bdi>{thread.case_id || text.generalConversation}</bdi>
            <span className="portal-muted ms-2 font-normal">{thread.closed_at ? text.conversationClosed : text.conversationOpen}</span>
            {thread.unread > 0 && <span className="ms-2 rounded-full bg-teal-700 px-2 py-0.5 text-xs text-white">
                {thread.unread > 99 ? '99+' : thread.unread}</span>}
        </summary>
        {open && <DoctorChatThread thread={thread} text={text} rtl={rtl} refresh={reload} />}
    </details>;
}
