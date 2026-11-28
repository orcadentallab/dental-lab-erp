import { useMemo, useRef, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Eye, Lock, MessageCircle, X } from 'lucide-react';
import { doctorPortal } from '../../translations/doctorPortal';
import { useDoctorChat, refreshDoctorChat } from '../../hooks/useDoctorChat';
import { doctorPortalService } from '../../services/doctorPortalService';
import DoctorChatThread, { ChatUnread, DoctorChatComposer } from './DoctorChatThread';

export function CaseDoctorChatButton({ onClick, count }: { onClick: () => void; count?: number }) {
    return <button type="button" onClick={onClick} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 text-xs font-bold text-teal-900 hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-100">
        <MessageCircle size={15} /> محادثة الطبيب <ChatUnread count={count} />
    </button>;
}

export function DoctorCaseChat({ orderId, threadId, lab, rtl = true, doctorName, inboxLink }: {
    orderId?: string; threadId?: string; lab?: boolean; rtl?: boolean; doctorName?: string; inboxLink?: boolean;
}) {
    const { threads, loading, failed, refresh } = useDoctorChat(orderId, threadId);
    const [selected, setSelected] = useState('');
    const thread = useMemo(() => threads.find(item => item.id === selected)
        ?? threads.find(item => !item.closed_at) ?? threads[0], [threads, selected]);
    const text = doctorPortal[rtl ? 'ar' : 'en'];
    if (loading) return <p className="p-4 text-sm" role="status">{rtl ? 'جاري تحميل المحادثة…' : 'Loading conversation…'}</p>;
    if (failed) return <div className="space-y-2 p-4 text-sm" role="alert">{rtl ? 'تعذّر تحميل المحادثة.' : 'Could not load the conversation.'}
        <button type="button" className="ms-2 underline" onClick={() => void refresh()}>{rtl ? 'حاول تاني' : 'Try again'}</button></div>;
    if (!thread && threadId) return <p className="p-4 text-sm">{rtl ? 'المحادثة غير متاحة لهذا الحساب.' : 'This conversation is unavailable.'}</p>;
    const canStart = orderId && !threads.some(item => !item.closed_at);
    return <div>
        {threads.length > 1 && <label className="flex items-center gap-2 border-b border-surface-200 p-2 text-xs">
            {rtl ? 'المحادثة' : 'Conversation'}
            <select className="min-w-0 flex-1 rounded-lg border border-surface-300 bg-surface-0 p-2"
                value={thread?.id} onChange={event => setSelected(event.target.value)}>
                {threads.map(item => <option key={item.id} value={item.id}>
                    {item.subject || (lab ? item.doctor_name : text.conversation)} · {item.closed_at ? text.conversationClosed : text.conversationOpen}
                </option>)}
            </select>
        </label>}
        {inboxLink && <Link to={thread ? `/directory/doctor-chat?thread=${thread.id}` : `/directory/doctor-chat?case=${orderId}`}
            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-teal-700 dark:text-teal-300">
            افتح في محادثات الأطباء <ArrowUpRight size={14} />
        </Link>}
        {thread && <DoctorChatThread key={thread.id} thread={thread} lab={lab} text={text} rtl={rtl} refresh={refresh} />}
        {canStart && <>
            {lab && !thread && <p className="flex items-center gap-2 bg-teal-50 p-3 text-xs font-semibold text-teal-900 dark:bg-teal-950 dark:text-teal-100"><Eye size={15} /> ظاهر للطبيب</p>}
            <p className="p-3 text-sm font-semibold">{rtl ? 'محادثة جديدة عن الحالة' : 'New conversation about this case'}</p>
            <DoctorChatComposer rtl={rtl} button={text.sendMessage} error={text.sendMessageError}
                placeholder={lab && doctorName ? `رسالة إلى د. ${doctorName}` : text.messageLabel}
                attachLabel={rtl ? 'أرفق صورة أو PDF' : 'Attach image or PDF'}
                submit={async (body, file) => {
                    const id = await doctorPortalService.writeChat('start', { orderId, body, file });
                    setSelected(id);
                    await refresh();
                    refreshDoctorChat();
                }} />
        </>}
    </div>;
}

export function CaseDoctorChatDrawer({ orderId, caseNumber, doctorName, notes, onClose, startInNotes = false }: {
    orderId: string; caseNumber: string; doctorName?: string; notes: ReactNode; onClose: () => void; startInNotes?: boolean;
}) {
    const [tab, setTab] = useState<'chat' | 'notes'>(startInNotes ? 'notes' : 'chat');
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { ref.current?.showModal(); }, []);
    return <dialog ref={ref} dir="rtl" aria-label="التواصل والملاحظات" onCancel={onClose}
        className="fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-dvh w-full max-w-2xl border-e border-surface-200 bg-surface-0 p-0 text-surface-900 shadow-2xl backdrop:bg-slate-950/55">
        <div className="flex items-center justify-between border-b border-surface-200 px-5 py-4">
            <div>
                <h2 className="text-lg font-bold">التواصل والملاحظات</h2>
                <p className="text-sm text-surface-500">الحالة <bdi>{caseNumber}</bdi></p>
            </div>
            <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-2 hover:bg-surface-100"><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3" role="tablist" aria-label="نوع المحادثة">
            <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}
                className={`flex items-center justify-center gap-2 rounded-lg border p-2 text-sm font-bold text-teal-800 dark:text-teal-200 ${tab === 'chat' ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-surface-200'}`}><Eye size={16} /> محادثة الطبيب</button>
            <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}
                className={`flex items-center justify-center gap-2 rounded-lg border p-2 text-sm font-bold text-amber-900 dark:text-amber-200 ${tab === 'notes' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950' : 'border-surface-200'}`}><Lock size={16} /> ملاحظات داخلية</button>
        </div>
        <div role="tabpanel">
            {tab === 'chat'
                ? <DoctorCaseChat orderId={orderId} lab doctorName={doctorName} inboxLink />
                : <>
                    <p className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                        <Lock size={15} /> للاستخدام الداخلي فقط. الطبيب لا يرى هذه الملاحظات.
                    </p>
                    {notes}
                </>}
        </div>
    </dialog>;
}
