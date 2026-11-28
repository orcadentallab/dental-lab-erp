import { useEffect, useState } from 'react';
import { ArrowRight, MessageCircle, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { doctorPortal } from '../translations/doctorPortal';
import { doctorPortalService, type LabSupportCase, type LabSupportRecipient } from '../services/doctorPortalService';
import { refreshDoctorChat, useDoctorChat } from '../hooks/useDoctorChat';
import DoctorChatThread, { ChatUnread, DoctorChatComposer } from '../components/doctors/DoctorChatThread';
import { DoctorCaseChat } from '../components/doctors/CaseDoctorChat';

export default function DoctorSupportInbox() {
    const { user } = useAuth();
    const [params, setParams] = useSearchParams();
    if (!getCapabilities(user).has('view_doctor_chat')) {
        const orderId = params.get('case') || undefined;
        const threadId = params.get('thread') || undefined;
        return (threadId || orderId) ? <main dir="rtl" className="mx-auto max-w-3xl">
            <DoctorCaseChat key={threadId || orderId} orderId={orderId} threadId={threadId} lab />
        </main> : <p className="p-5">افتح محادثة من الحالة المكلّف بيها.</p>;
    }
    return <StaffInbox selectedId={params.get('thread')} orderId={params.get('case')}
        selectThread={id => setParams(id ? { thread: id } : {})} />;
}

function StaffInbox({ selectedId, orderId, selectThread }: {
    selectedId: string | null; orderId: string | null; selectThread: (id?: string) => void;
}) {
    const { threads, loading, failed, refresh } = useDoctorChat();
    const [search, setSearch] = useState('');
    const [composing, setComposing] = useState(false);
    const query = search.trim().toLocaleLowerCase();
    const visible = threads.filter(thread => [thread.doctor_name, thread.case_id, thread.subject, thread.posts.at(-1)?.body]
        .some(value => value?.toLocaleLowerCase().includes(query)));
    const selected = selectedId ? threads.find(thread => thread.id === selectedId) : undefined;
    const unread = threads.reduce((total, thread) => total + thread.unread, 0);
    return <main dir="rtl" className="mx-auto max-w-7xl space-y-4 px-3 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">محادثات الأطباء</h1><ChatUnread count={unread} />
            </div>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
                onClick={() => setComposing(value => !value)}><Plus size={18} /> محادثة جديدة</button>
        </header>
        {composing && <LabChatComposer onSent={async id => {
            selectThread(id);
            setComposing(false);
            await refresh();
            refreshDoctorChat();
        }} />}
        <div dir="ltr" className="grid min-h-[25rem] overflow-hidden rounded-2xl border border-surface-200 bg-surface-0 shadow-sm md:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
            <aside dir="rtl" className={`border-e border-surface-200 md:block ${selectedId ? 'hidden' : ''}`} aria-label="قائمة المحادثات">
                <div className="border-b border-surface-200 p-3">
                    <label className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-50 px-3 focus-within:ring-2 focus-within:ring-teal-500">
                        <Search size={17} className="text-surface-500" />
                        <input className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
                            aria-label="بحث المحادثات" placeholder="ابحث بطبيب أو رقم حالة" value={search} onChange={event => setSearch(event.target.value)} />
                    </label>
                </div>
                {loading && <p className="p-4 text-sm" role="status">جاري التحميل…</p>}
                {failed && <p className="p-4 text-sm" role="alert">تعذّر تحميل المحادثات. <button type="button" className="underline" onClick={() => void refresh()}>حاول تاني</button></p>}
                {!loading && !failed && !visible.length && <p className="p-4 text-sm text-surface-500">{query ? 'مفيش نتائج للبحث.' : 'مفيش محادثات لسه.'}</p>}
                <ul className="max-h-[63vh] overflow-y-auto">
                    {visible.map(thread => <li key={thread.id} className="border-b border-surface-100">
                        <button type="button" onClick={() => selectThread(thread.id)} aria-current={selectedId === thread.id}
                            className={`flex w-full items-center gap-3 p-3 text-right hover:bg-surface-50 ${selectedId === thread.id ? 'bg-teal-50 ring-1 ring-inset ring-teal-300 dark:bg-teal-950' : ''}`}>
                            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-teal-100 text-xs font-bold text-teal-900" aria-hidden="true">
                                {thread.doctor_name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('')}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold">{thread.doctor_name}</span>
                                <span className="block truncate text-xs text-surface-600" dir="auto">{thread.posts.at(-1)?.body}</span>
                                <span className="text-[11px] text-surface-500"><bdi>{thread.case_id || 'عام'}</bdi>{thread.closed_at ? ' · مغلقة' : ''}</span>
                            </span>
                            <ChatUnread count={thread.unread} />
                        </button>
                    </li>)}
                </ul>
            </aside>
            <div dir="rtl" className="min-w-0">
                {selectedId && <button type="button" className="m-2 flex items-center gap-2 rounded-lg border border-surface-200 px-3 py-2 text-xs md:hidden"
                    onClick={() => selectThread()}><ArrowRight size={16} /> كل المحادثات</button>}
                {selected ? <DoctorChatThread key={selected.id} thread={selected} lab text={doctorPortal.ar} rtl refresh={refresh} />
                    : orderId ? <DoctorCaseChat key={orderId} orderId={orderId} lab />
                    : <div className="grid min-h-64 place-content-center justify-items-center gap-2 text-sm text-surface-500">
                        <MessageCircle size={28} />{loading ? 'جاري التحميل…' : selectedId ? 'المحادثة غير متاحة.' : 'اختار محادثة من القائمة'}
                    </div>}
            </div>
        </div>
    </main>;
}

function LabChatComposer({ onSent }: { onSent: (id: string) => Promise<void> }) {
    const [recipients, setRecipients] = useState<LabSupportRecipient[]>([]);
    const [cases, setCases] = useState<LabSupportCase[]>([]);
    const [doctorId, setDoctorId] = useState('');
    const [orderId, setOrderId] = useState('');
    const [subject, setSubject] = useState('');
    const [failed, setFailed] = useState(false);
    const doctor = recipients.find(item => item.id === doctorId);
    useEffect(() => { void doctorPortalService.labRecipients().then(setRecipients).catch(() => setFailed(true)); }, []);
    useEffect(() => {
        if (!doctorId) return;
        let active = true;
        void doctorPortalService.labCases(doctorId)
            .then(result => { if (active) setCases(result); })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [doctorId]);
    return <section className="overflow-hidden rounded-2xl border border-surface-200 bg-surface-0">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">الطبيب أو المركز
                <select className="rounded-lg border border-surface-200 bg-surface-0 p-2" value={doctorId} onChange={event => {
                    setDoctorId(event.target.value); setOrderId(''); setCases([]);
                }}><option value="">اختار حساب الطبيب</option>
                    {recipients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
            <label className="grid gap-1 text-sm">الحالة
                <select className="rounded-lg border border-surface-200 bg-surface-0 p-2" value={orderId} disabled={!doctorId} onChange={event => setOrderId(event.target.value)}>
                    <option value="">محادثة عامة</option>{cases.map(item => <option key={item.id} value={item.id}>{item.case_id} · {item.patient_name}</option>)}
                </select></label>
            <label className="grid gap-1 text-sm">عنوان المحادثة (اختياري)
                <input className="rounded-lg border border-surface-200 bg-surface-0 p-2" maxLength={120} value={subject} onChange={event => setSubject(event.target.value)} />
            </label>
        </div>
        {failed && <p role="alert" className="px-4 text-sm text-red-700">تعذّر تحميل الأطباء أو الحالات.</p>}
        {doctor && <DoctorChatComposer key={doctor.id} rtl button="إرسال للطبيب" error="تعذّر إرسال الرسالة." attachLabel="أرفق صورة أو PDF"
            placeholder={`رسالة إلى د. ${doctor.name}`} submit={async (body, file) => {
                const id = await doctorPortalService.writeChat('start', { doctorId, orderId, subject, body, file });
                await onSent(id);
            }} />}
    </section>;
}
