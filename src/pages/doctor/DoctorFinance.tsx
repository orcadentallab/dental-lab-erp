import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doctorPortalService, type PortalMonth } from '../../services/doctorPortalService';
export default function DoctorFinance() {
    const [previous, setPrevious] = useState(false); const [month, setMonth] = useState<PortalMonth | null>(null); const [error, setError] = useState('');
    useEffect(() => { let active = true; doctorPortalService.month(previous).then(data => { if (active) setMonth(data); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [previous]);
    const money = (value: number) => `${Number(value).toLocaleString('ar-EG')} ج.م`;
    return <div className="space-y-5" dir="rtl"><h1 className="text-2xl font-bold">حساب الشهر</h1><p className="text-sm text-slate-500">ملخص حركة الشهر للقراءة فقط. لأي تفاصيل إضافية، ابعت للمعمل.</p>
        <div className="flex gap-2" role="group" aria-label="اختيار الشهر">{[false, true].map(value => <button type="button" key={String(value)} aria-pressed={previous === value} onClick={() => { if (previous !== value) { setMonth(null); setError(''); setPrevious(value); } }} className={`px-5 py-3 rounded-xl ${previous === value ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 border'}`}>{value ? 'الشهر السابق' : 'الشهر الحالي'}</button>)}</div>
        {error && <p role="alert" className="text-red-600">{error}</p>}{!month && !error && <p role="status">جاري تحميل حساب الشهر…</p>}
        {month && <><h2 className="font-bold">{new Date(`${month.month}T12:00:00`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[['الحالات المسجلة محاسبيًا', month.charges], ['الدفعات المسجلة', month.payments], ['التسويات', month.adjustments], ['فرق حركة الشهر', month.difference]].map(([label, value]) => <div key={String(label)} className="bg-white dark:bg-slate-800 p-4 rounded-xl border"><p className="text-sm text-slate-500">{label}</p><p className="text-lg font-bold mt-2">{money(Number(value))}</p></div>)}</div>
            <p className="text-xs text-slate-500">فرق حركة الشهر يخص هذا الشهر فقط. لمعرفة الرصيد الكامل أو أي كشف أقدم، تواصل مع المعمل.</p>
            {month.is_center && <section className="bg-white dark:bg-slate-800 rounded-xl p-4 space-y-2"><h3 className="font-bold">تفصيل الحالات حسب الطبيب</h3>{month.by_doctor.map(row => <p key={row.id} className="flex justify-between"><span>{row.name}</span><span>حالات: {money(row.amount)} — دفعات للحالات: {money(row.paid)}</span></p>)}</section>}
            <section className="space-y-3"><h3 className="font-bold">حالات الشهر</h3>{month.cases.length ? month.cases.map((item, i) => <div key={`${item.case_id}-${i}`} className="bg-white dark:bg-slate-800 border rounded-xl p-4 flex flex-wrap gap-3 justify-between"><div><p className="font-bold">{item.patient_name}</p><p className="text-sm text-slate-500">{item.case_id} {month.is_center && `— ${item.doctor_name}`} — {item.date}</p></div><p>{money(item.amount)}</p></div>) : <p>لا توجد حالات مسجلة محاسبيًا في هذا الشهر.</p>}</section></>}
        <Link to="/doctor/support" className="inline-block bg-blue-600 text-white rounded-xl px-5 py-3">استفسار عن الحساب</Link></div>;
}
