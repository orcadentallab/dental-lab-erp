import { useEffect, useState, type FormEvent } from 'react';
import { db, type Doctor, type User } from '../services/db';
import { getScanVisitDevices, getScanVisits, recordScanVisit, type ScanVisit } from '../services/supabase/scanVisits';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Clock3, ScanLine, Plus } from 'lucide-react';

const field = 'mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-cyan-700 sm:text-sm';

export default function ScanVisits() {
    const toast = useToast();
    const { user } = useAuth();
    const isRepresentative = user?.role === 'representative';
    const [visits, setVisits] = useState<ScanVisit[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [machines, setMachines] = useState<Awaited<ReturnType<typeof getScanVisitDevices>>>([]);
    const [doctorId, setDoctorId] = useState('');
    const [selectedRep, setSelectedRep] = useState('');
    const [scannerChoice, setScannerChoice] = useState('');
    const [scannerFilter, setScannerFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);
    const [requestId, setRequestId] = useState(() => crypto.randomUUID());

    useEffect(() => {
        void Promise.all([getScanVisits(), db.getDoctors(), isRepresentative ? Promise.resolve([]) : db.getUsers(), getScanVisitDevices()])
            .then(([rows, doctors, users, machines]) => {
                setVisits(rows);
                setDoctors(doctors);
                setUsers(users);
                setMachines(machines);
            }).catch(() => setLoadError('تعذر تحميل سجل زيارات السكان')).finally(() => setLoading(false));
    }, [isRepresentative]);

    const branches = doctors.find(doctor => doctor.id === doctorId)?.branches ?? [];
    const representativeId = isRepresentative ? user.id : selectedRep;
    const activeMachines = machines.filter(machine => machine.is_active);
    const lastDevice = visits.find(visit => visit.representative_id === representativeId && activeMachines.some(machine => machine.id === visit.scanner_id))?.scanner_id;
    const scannerId = scannerChoice || lastDevice || (activeMachines.length === 1 ? activeMachines[0].id : '');

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        const value = (name: string) => String(values.get(name) ?? '').trim();
        const visit = {
            id: requestId,
            doctor_id: doctorId, representative_id: representativeId, scanner_id: scannerId,
            branch: branches.find(branch => branch.id === value('branch'))?.name ?? null,
            visit_minutes: Number(value('visitMinutes')), case_count: Number(value('caseCount')),
            notes: value('notes'), fee: Number(value('fee')),
        };
        setSaving(true);
        try {
            await recordScanVisit(visit);
            setVisits(await getScanVisits());
            setRequestId(crypto.randomUUID());
            form.reset();
            setDoctorId('');
            toast.success('تم تسجيل زيارة السكان');
        } catch (error) {
            const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
                ? error.message : 'تعذر تسجيل زيارة السكان';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    }

    const visible = visits.filter(visit => !scannerFilter || visit.scanner_id === scannerFilter);
    const reps = users.filter(user => user.role === 'representative');
    const scannerName = (id: string) => machines.find(machine => machine.id === id)?.name_ar ?? '—';
    if (loading || loadError) return <p className="rounded-xl bg-white p-5">{loadError || 'جاري التحميل…'}</p>;

    return <main dir="rtl" className="space-y-5 text-slate-800">
        <header className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-100 text-cyan-900"><ScanLine aria-hidden="true" size={22} /></span><h1 className="text-2xl font-bold">زيارات السكان</h1></header>
        <form onSubmit={event => void submit(event)} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4"><Plus size={18} aria-hidden="true" /><h2 className="font-bold">تسجيل زيارة</h2></div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <label className="sm:col-span-2">الطبيب<select name="doctor" required value={doctorId} onChange={event => setDoctorId(event.target.value)} className={field}><option value="">اختر الطبيب</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>
                {branches.length > 0 && <label className="sm:col-span-2">الفرع<select key={doctorId} name="branch" required className={field}><option value="">اختر الفرع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
                <label>المدة التقريبية (دقيقة)<input name="visitMinutes" type="number" min="1" step="1" required className={field} /></label>
                <label>عدد الحالات<input name="caseCount" type="number" min="1" step="1" required className={field} /></label>
                <label>الرسوم (ج.م)<input name="fee" type="number" min="0" step="0.01" placeholder="مجانية" className={field} /></label>
                <label>الجهاز<select name="scanner" required value={scannerId} onChange={event => setScannerChoice(event.target.value)} className={field}><option value="">اختر السكانر</option>{activeMachines.map(machine => <option key={machine.id} value={machine.id}>{machine.name_ar}</option>)}</select></label>
                {!isRepresentative && <label>المندوب<select name="representative" required value={selectedRep} onChange={event => { setSelectedRep(event.target.value); setScannerChoice(''); }} className={field}><option value="">اختر المندوب</option>{reps.filter(rep => rep.isActive !== false).map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>}
                <details className="self-end sm:col-span-2"><summary className="cursor-pointer py-2 text-sm font-semibold text-cyan-800">إضافة ملاحظات</summary><label>الملاحظات<textarea name="notes" className={field} rows={2} /></label></details>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                <span className="text-sm text-slate-600">{isRepresentative ? `المندوب: ${user.name}` : ''}</span>
                <button disabled={saving} className="min-h-11 rounded-xl bg-cyan-800 px-5 font-bold text-white hover:bg-cyan-900 focus-visible:ring-2 focus-visible:ring-cyan-700 disabled:opacity-50">حفظ الزيارة</button>
            </footer>
        </form>
        <section className="space-y-3 rounded-2xl border bg-white p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="font-bold">سجل الزيارات</h2><p className="mt-1 flex items-center gap-1 text-sm text-slate-600"><Clock3 size={14} aria-hidden="true" /> {visible.length} زيارة · {visible.reduce((sum, visit) => sum + (visit.case_count ?? 0), 0)} حالة مسجّلة · {visible.reduce((sum, visit) => sum + visit.visit_minutes, 0)} دقيقة</p></div>
                <label>تصفية بالجهاز<select value={scannerFilter} onChange={event => setScannerFilter(event.target.value)} className={field}><option value="">كل الأجهزة</option>{machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name_ar}</option>)}</select></label>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-slate-50"><tr>{['التوقيت','الطبيب والفرع','المندوب','الجهاز','المدة التقريبية','عدد الحالات','الرسوم','ملاحظات'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
                <tbody>{visible.map(visit => <tr key={visit.id} className="border-t">
                    <td className="p-2">{new Date(visit.visited_at).toLocaleString('ar-EG')}</td>
                    <td className="p-2">{doctors.find(doctor => doctor.id === visit.doctor_id)?.name ?? '—'}{visit.branch && ` · ${visit.branch}`}</td>
                    <td className="p-2">{visit.representative_id === user?.id ? user.name : users.find(user => user.id === visit.representative_id)?.name ?? '—'}</td>
                    <td className="p-2">{scannerName(visit.scanner_id)}</td>
                    <td className="p-2">{visit.visit_minutes} د</td>
                    <td className="p-2">{visit.case_count ?? '—'}</td>
                    <td className="p-2">{visit.fee > 0 ? `${visit.fee} ج.م` : 'مجانية'}</td>
                    <td className="p-2">{visit.notes || '—'}</td>
                </tr>)}</tbody></table></div>
            {visible.length === 0 && <p className="text-sm text-slate-500">مفيش زيارات مسجلة للجهاز المحدد.</p>}
        </section>
    </main>;
}
