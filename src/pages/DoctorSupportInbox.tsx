import { useCallback, useEffect, useState, type FormEvent } from 'react';
import SupportConversation from '../components/doctors/SupportConversation';
import { doctorPortal } from '../translations/doctorPortal';
import { doctorPortalService, type LabSupportCase, type LabSupportRecipient, type SupportThread } from '../services/doctorPortalService';

export default function DoctorSupportInbox() {
    const [threads, setThreads] = useState<SupportThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [recipients, setRecipients] = useState<LabSupportRecipient[]>([]);
    const [cases, setCases] = useState<LabSupportCase[]>([]);
    const [doctorId, setDoctorId] = useState('');
    const [orderId, setOrderId] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [casesLoading, setCasesLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [composerError, setComposerError] = useState('');
    const [sent, setSent] = useState(false);
    const activeThread = threads.find(thread =>
        !thread.closed_at && thread.doctor_id === doctorId && (thread.order_id ?? '') === orderId);
    const reload = useCallback(async () => {
        try {
            setThreads(await doctorPortalService.threads());
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (!doctorId) return;
        let current = true;
        void doctorPortalService.labCases(doctorId)
            .then(result => { if (current) setCases(result); })
            .catch(() => { if (current) setComposerError('تعذّر تحميل حالات الطبيب. اختار الطبيب مرة تانية للمحاولة.'); })
            .finally(() => { if (current) setCasesLoading(false); });
        return () => { current = false; };
    }, [doctorId]);

    async function openComposer() {
        setIsComposing(true);
        setComposerError('');
        setSent(false);
        try {
            setRecipients(await doctorPortalService.labRecipients());
        } catch {
            setComposerError('تعذّر تحميل حسابات الأطباء.');
        }
    }

    async function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (sending || !doctorId || !body.trim()) return;
        setSending(true);
        setComposerError('');
        try {
            await doctorPortalService.startLabConversation(doctorId, orderId, subject, body);
            setDoctorId('');
            setOrderId('');
            setCases([]);
            setSubject('');
            setBody('');
            setIsComposing(false);
            setSent(true);
            await reload();
        } catch {
            setComposerError('تعذّر إرسال الرسالة. راجع الطبيب والحالة المختارة.');
        } finally {
            setSending(false);
        }
    }

    return <main dir="rtl" className="portal-page max-w-3xl p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="portal-title">محادثات الأطباء</h1>
            <div className="flex flex-wrap gap-2">
                <button type="button" className="portal-chip" onClick={() => void reload()}>تحديث</button>
                <button type="button" className="portal-primary" onClick={() => void openComposer()}>محادثة مع طبيب</button>
            </div>
        </header>
        {sent && <p role="status" className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">تم إرسال الرسالة للطبيب.</p>}
        {isComposing && <form className="portal-card space-y-3" onSubmit={send}>
            <h2 className="font-semibold">{activeThread ? 'رد على المحادثة المفتوحة' : 'محادثة جديدة'}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="portal-field">الطبيب أو المركز
                    <select required className="portal-input" value={doctorId} disabled={sending} onChange={event => {
                        if (event.target.value === doctorId) return;
                        setDoctorId(event.target.value);
                        setOrderId('');
                        setCases([]);
                        setCasesLoading(Boolean(event.target.value));
                        setComposerError('');
                    }}>
                        <option value="">اختار حساب الطبيب</option>
                        {recipients.map(item => <option key={item.id} value={item.id}>{item.name} · {item.doctor_code}</option>)}
                    </select>
                </label>
                <label className="portal-field">ربط بحالة
                    <select className="portal-input" value={orderId} disabled={!doctorId || casesLoading || sending}
                        onChange={event => setOrderId(event.target.value)}>
                        <option value="">{casesLoading ? 'جاري تحميل الحالات…' : 'محادثة عامة'}</option>
                        {cases.map(item => <option key={item.id} value={item.id}>{item.case_id} · {item.patient_name}</option>)}
                    </select>
                </label>
            </div>
            {!activeThread && <label className="portal-field">عنوان المحادثة (اختياري)
                <input className="portal-input" maxLength={120} value={subject} disabled={sending}
                    onChange={event => setSubject(event.target.value)} placeholder="مثال: متابعة حساب الشهر" />
            </label>}
            <label className="portal-field">الرسالة للطبيب
                <textarea className="portal-input" rows={3} required maxLength={4000} value={body} disabled={sending}
                    onChange={event => setBody(event.target.value)} />
            </label>
            {composerError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{composerError}</p>}
            <div className="flex flex-wrap gap-2">
                <button className="portal-primary" disabled={sending || casesLoading || !doctorId || !body.trim()}>إرسال للطبيب</button>
                <button type="button" className="portal-chip" disabled={sending} onClick={() => setIsComposing(false)}>إلغاء</button>
            </div>
        </form>}
        {loading && <p role="status">جاري التحميل…</p>}
        {failed && <p role="alert">تعذّر تحميل المحادثات.</p>}
        {!loading && !failed && threads.length === 0 && <p className="portal-muted">مفيش محادثات لسه.</p>}
        {threads.map(thread => <SupportConversation key={thread.id} thread={thread} text={doctorPortal.ar} lab reload={reload} />)}
    </main>;
}
