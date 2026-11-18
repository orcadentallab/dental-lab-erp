import { useEffect, useState } from 'react';
import ShippingCostReport from './ShippingCostReport';
import { Link, useSearchParams } from 'react-router-dom';
import { Truck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase';

interface CourierInvoice {
    id: string;
    period_month: string;
    invoice_ref: string;
    minimum_amount: number;
    invoice_amount: number;
    shipment_amount: number;
    shipment_charges: Record<string, { amount: number; code: string; cases: { case_id: string; allocated: number }[] }>;
    paid: number;
    payments: { transaction_id: string; amount: number; date: string; description: string }[];
    status: 'draft' | 'confirmed';
    version: number;
    notes: string | null;
}

type AreaRate = { id: string; area: string; amount: number };
type AreaPricing = { rates: AreaRate[]; assignments: Record<string, AreaRate> };

interface CourierStatement {
    couriers: { id: string; name: string; active: boolean }[];
    invoices: CourierInvoice[];
    shipments: { id: string; code: string; tracking: string | null; status: string; previous_cost: number | null; area?: string | null; direction?: string; base_cost?: number | null }[];
    available_payments: { id: string; date: string; description: string; available: number }[];
}

const money = (amount: number) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(amount);
const shipmentStatuses: Record<string, string> = {
    packing: 'تغليف', ready_for_pickup: 'جاهزة للاستلام', dispatched: 'مع المندوب',
    delivered: 'مسلّمة', failed: 'تعذر التوصيل', returned: 'مرتجعة', cancelled: 'ملغاة',
};
const field = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-surface-600 dark:bg-surface-800';

export default function CourierStatements({ showPayableStatements, fromAccounts = false }: { showPayableStatements: boolean; fromAccounts?: boolean }) {
    const { user } = useAuth();
    const toast = useToast();
    const [params] = useSearchParams();
    const linkedCourier = params.get('courier');
    const linkedMonth = params.get('month');
    const [courier, setCourier] = useState(linkedCourier ?? '');
    const [month, setMonth] = useState(() => linkedMonth || new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit',
    }).format(new Date()));
    const [data, setData] = useState<CourierStatement | null>(null);
    const [error, setError] = useState('');
    const [loadedKey, setLoadedKey] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);
    const [reference, setReference] = useState('');
    const [minimum, setMinimum] = useState('7000');
    const [invoiceAmount, setInvoiceAmount] = useState('');
    const [reason, setReason] = useState('');
    const [charges, setCharges] = useState<Record<string, string>>({});
    const [payment, setPayment] = useState('');
    const [paymentAmount, setPaymentAmount] = useState('');
    const [pricing, setPricing] = useState<AreaPricing>({ rates: [], assignments: {} });

    useEffect(() => {
        if (linkedCourier && linkedMonth) {
            setCourier(linkedCourier);
            setMonth(linkedMonth);
        }
    }, [linkedCourier, linkedMonth]);

    useEffect(() => {
        let current = true;
        const period = month ? month + '-01' : null;
        setError('');
        Promise.all([
            supabase.rpc('get_courier_statement', { p_courier: courier || null, p_month: period }),
            supabase.rpc('get_courier_area_rates', { p_courier: courier || null, p_month: period }),
        ]).then(([statementResponse, pricingResponse]) => {
                const result = statementResponse.data;
                const failure = statementResponse.error ?? pricingResponse.error;
                if (!current) return;
                if (failure) {
                    setError(failure.message);
                    return;
                }
                const statement = result as CourierStatement;
                const invoice = statement.invoices.find(item => item.period_month === month + '-01');
                setData(statement);
                setPricing(pricingResponse.data as AreaPricing);
                setLoadedKey(`${courier}:${month}:${refresh}`);
                setReference(invoice?.invoice_ref ?? '');
                setMinimum(String(invoice?.minimum_amount ?? 7000));
                setInvoiceAmount(invoice ? String(invoice.invoice_amount) : '');
                setReason(invoice?.status === 'draft' ? invoice.notes ?? '' : '');
                setCharges(Object.fromEntries(Object.entries(invoice?.shipment_charges ?? {}).map(([id, charge]) => [id, String(charge.amount)])));
                setEditing(false);
                setPayment('');
                setPaymentAmount('');
            });
        return () => { current = false; };
    }, [courier, month, refresh]);

    const invoice = data?.invoices.find(item => item.period_month === month + '-01');
    const confirmed = invoice?.status === 'confirmed';
    const canEdit = !confirmed || editing;
    const admin = user?.role === 'admin';
    const estimatedCharges = confirmed ? {} : Object.fromEntries(
        (data?.shipments ?? []).flatMap(item => {
            const cost = pricing.assignments[item.id]?.amount ?? item.base_cost;
            return cost == null ? [] : [[item.id, String(cost)]];
        }),
    );
    const displayedCharges = Object.fromEntries((data?.shipments ?? []).map(({ id }) => [id, charges[id] ?? estimatedCharges[id] ?? '']));
    const entered = Object.fromEntries(Object.entries(displayedCharges).filter(([, value]) => value !== '').map(([id, value]) => [id, Number(value)]));
    const total = Object.values(entered).reduce((sum, amount) => sum + amount, 0);
    const shortfall = Math.max(0, Number(minimum) - total);
    const difference = Math.round((Number(invoiceAmount) - total - shortfall) * 100) / 100;
    const due = confirmed ? Math.max(0, invoice.invoice_amount - invoice.paid) : 0;
    const availablePayments = data?.available_payments.filter(item => !invoice?.payments.some(link => link.transaction_id === item.id)) ?? [];

    const submitInvoice = async (confirm: boolean) => {
        if (busy || !courier || !month || !reference.trim() || minimum === '' || invoiceAmount === '') return;
        setBusy(true);
        const { error: failure } = await supabase.rpc('save_courier_monthly_invoice', {
            p_courier: courier, p_month: month + '-01', p_ref: reference, p_minimum: Number(minimum), p_invoice: Number(invoiceAmount),
            p_charges: entered, p_confirm: confirm, p_version: invoice?.version ?? 0, p_reason: reason || null,
        });
        setBusy(false);
        if (failure) toast.error(failure.message);
        else { toast.success(confirm ? 'تم اعتماد فاتورة الشحن' : 'تم حفظ المسودة'); setRefresh(value => value + 1); }
    };

    const assignArea = async (shipmentId: string, rateId: string) => {
        if (busy) return;
        setBusy(true);
        const { error: failure } = await supabase.rpc('assign_courier_shipment_area', {
            p_shipment: shipmentId, p_rate: rateId || null,
        });
        if (failure) toast.error(failure.message);
        else {
            const rate = pricing.rates.find(item => item.id === rateId);
            setPricing(previous => {
                const assignments = { ...previous.assignments };
                if (rate) assignments[shipmentId] = rate;
                else delete assignments[shipmentId];
                return { ...previous, assignments };
            });
            setCharges(previous => {
                const next = { ...previous };
                if (!invoice?.shipment_charges[shipmentId] && (
                    next[shipmentId] === undefined || next[shipmentId] === String(pricing.assignments[shipmentId]?.amount)
                )) delete next[shipmentId];
                return next;
            });
        }
        setBusy(false);
    };

    const saveFutureRate = async (area: string, value: string) => {
        if (!admin || busy || !courier || !value.trim()) return;
        setBusy(true);
        try {
            const { error } = await supabase.rpc('save_courier_area_rate', {
                p_courier: courier, p_area: area, p_amount: Number(value),
            });
            if (error) throw error;
            toast.success('تم حفظ سعر المنطقة للشحنات الجديدة');
        } catch (error) {
            toast.error((error as { message?: string })?.message || 'تعذر حفظ سعر المنطقة');
        } finally {
            setBusy(false);
        }
    };

    const linkPayment = async () => {
        if (!invoice || !payment || !Number(paymentAmount) || busy) return;
        setBusy(true);
        const { error: failure } = await supabase.rpc('link_courier_invoice_payment', {
            p_invoice: invoice.id, p_transaction: payment, p_amount: Number(paymentAmount),
        });
        setBusy(false);
        if (failure) toast.error(failure.message);
        else { toast.success('تم ربط السداد المسجل'); setRefresh(value => value + 1); }
    };

    const unlinkPayment = async (transactionId: string, note: string) => {
        if (!invoice || !note.trim() || busy) return;
        setBusy(true);
        const { error: failure } = await supabase.rpc('unlink_courier_invoice_payment', {
            p_invoice: invoice.id, p_transaction: transactionId, p_reason: note,
        });
        setBusy(false);
        if (failure) toast.error(failure.message);
        else { toast.success('تم فك الربط وحركة السداد ما زالت مسجلة'); setRefresh(value => value + 1); }
    };

    return (
        <div dir="rtl" className="mx-auto min-w-0 max-w-7xl space-y-4 text-surface-900 dark:text-surface-100">
            <h1 className="flex items-center gap-2 text-xl font-bold"><Truck size={22} aria-hidden="true" /> كشف حساب شركات الشحن</h1>
            <nav aria-label="أقسام كشوف الحساب" className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-200 bg-surface-50 p-3 text-sm dark:bg-surface-800">
                <Link to={fromAccounts ? "/accounts?tab=doctors" : "/statements?tab=doctors"}>{fromAccounts ? "العملاء" : "الأطباء"}</Link>
                {showPayableStatements && <><Link to={fromAccounts ? "/accounts?tab=suppliers" : "/statements?tab=suppliers"}>{fromAccounts ? "المعامل الخارجية" : "الموردين"}</Link>{fromAccounts && <Link to="/accounts?tab=materials">شركات الخامات</Link>}<Link to={fromAccounts ? "/accounts?tab=designers" : "/statements?tab=designers"}>المصممين</Link></>}
                <span aria-current="page" className="font-bold text-teal-800">شركات الشحن</span>
            </nav>
            <section className="grid gap-3 rounded-2xl border border-surface-200 bg-white p-4 dark:bg-surface-900 sm:grid-cols-2">
                <label>شركة الشحن<select className={field} value={courier} onChange={event => {
                    setCourier(event.target.value); setError(''); setData(previous => previous && { ...previous, invoices: [], shipments: [], available_payments: [] });
                }} disabled={busy}>
                    <option value="">اختار شركة الشحن</option>
                    {data?.couriers.map(item => <option key={item.id} value={item.id}>{item.name}{item.active === false ? ' (غير فعالة)' : ''}</option>)}
                </select></label>
                <label>شهر الفاتورة<input type="month" className={field} value={month} onChange={event => {
                    setMonth(event.target.value); setError(''); setData(previous => previous && { ...previous, invoices: [], shipments: [], available_payments: [] });
                }} disabled={busy} /></label>
            </section>
            {month && <ShippingCostReport month={month} />}
            {error && <p role="alert" className="text-red-700">{error}</p>}
            {courier && month && !error && loadedKey !== `${courier}:${month}:${refresh}` && <p role="status">جاري تحميل كشف الحساب…</p>}
            {courier && month && data && !error && loadedKey === `${courier}:${month}:${refresh}` && <>
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                        ['فاتورة الشركة', invoiceAmount === '' ? '—' : money(Number(invoiceAmount))],
                        ['فرق الحد الأدنى', money(shortfall)],
                        ['السداد المرتبط', confirmed ? money(invoice.paid) : '—'],
                        ['المتبقي', confirmed ? money(due) : '—'],
                    ].map(([label, value]) => <div key={label} className="rounded-xl border border-surface-200 bg-surface-50 p-3 dark:bg-surface-800">
                        <dt className="text-xs font-semibold text-surface-600 dark:text-surface-300">{label}</dt>
                        <dd className="mt-1 text-lg font-bold tabular-nums">{value}</dd>
                    </div>)}
                </dl>
                <section className="rounded-2xl border border-surface-200 bg-white p-4 dark:bg-surface-900">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-bold">{confirmed ? 'فاتورة معتمدة' : 'مطابقة فاتورة الشهر'}</h2>
                        {admin && confirmed && !editing && <button type="button" onClick={() => setEditing(true)} className="rounded-lg border px-3 py-1">تصحيح الفاتورة</button>}
                    </div>
                    <form onSubmit={event => { event.preventDefault(); void submitInvoice(confirmed || (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'confirm'); }} className="space-y-4">
                        <fieldset disabled={!canEdit || busy} className="grid gap-3 sm:grid-cols-3">
                            <label>رقم الفاتورة<input required className={field} value={reference} onChange={event => setReference(event.target.value)} /></label>
                            <label>الحد الأدنى الشهري<input required className={field} type="number" min="0" step="0.01" value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
                            <label>إجمالي فاتورة الشركة<input required className={field} type="number" min="0" step="0.01" value={invoiceAmount} onChange={event => setInvoiceAmount(event.target.value)} /></label>
                        </fieldset>
                        <div className="overflow-x-auto">
                            <table className="w-full text-right text-sm">
                                <thead><tr className="border-b"><th>الشحنة</th><th>الحالة</th><th>المنطقة والسعر الأساسي</th><th>التكلفة في الفاتورة</th></tr></thead>
                                <tbody>
                                    {data.shipments.map(item => {
                                        const area = pricing.assignments[item.id]?.area ?? item.area;
                                        const charge = charges[item.id];
                                        return <tr key={item.id} className="border-b">
                                        <td className="py-2">{item.code}{item.direction === 'to_lab' && <small className="block">استلام من الطبيب</small>}{item.tracking && <small className="block">{item.tracking}</small>}</td>
                                        <td>{shipmentStatuses[item.status] ?? item.status}</td>
                                        <td className="p-1">
                                            <select className={field} aria-label={`منطقة ${item.code}`} disabled={confirmed || busy}
                                                value={pricing.assignments[item.id]?.id ?? ''} onChange={event => void assignArea(item.id, event.target.value)}>
                                                <option value="">{item.area || 'اختار المنطقة'}</option>
                                                {pricing.rates.map(rate => <option key={rate.id} value={rate.id}>{rate.area} · {money(rate.amount)}</option>)}
                                                {pricing.assignments[item.id] && !pricing.rates.some(rate => rate.id === pricing.assignments[item.id].id) &&
                                                    <option value={pricing.assignments[item.id].id}>{pricing.assignments[item.id].area} · {money(pricing.assignments[item.id].amount)}</option>}
                                            </select>
                                            {area && item.base_cost == null && !pricing.assignments[item.id] && <small className="block text-amber-700">الشحنة بدون سعر أساسي</small>}
                                        </td>
                                        <td className="p-1"><input className={field} aria-label={`تكلفة ${item.code}`} type="number" min="0" step="0.01"
                                            placeholder={item.previous_cost === null ? 'غير معروفة' : `السابق ${item.previous_cost}`}
                                            value={displayedCharges[item.id] ?? ''} disabled={!canEdit || busy}
                                            onChange={event => setCharges(previous => ({ ...previous, [item.id]: event.target.value }))} />
                                            {admin && canEdit && area && charge?.trim() && Number.isFinite(Number(charge)) && Number(charge) >= 0 &&
                                                <button type="button" disabled={busy} className="mt-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                                                    onClick={() => void saveFutureRate(area, charge)}>حفظ سعر المنطقة للشحنات الجديدة</button>}
                                        </td>
                                    </tr>;
                                    })}
                                </tbody>
                            </table>
                            {!data.shipments.length && <p className="py-3 text-sm text-slate-600">مفيش شحنات مسجلة للشهر ده.</p>}
                        </div>
                        <dl className="grid gap-3 rounded-xl bg-surface-50 p-3 text-sm dark:bg-surface-800 sm:grid-cols-3">
                            <div><dt>تكلفة الشحنات المطابقة</dt><dd className="font-bold">{money(total)}</dd></div>
                            <div><dt>المتوقع على المعمل</dt><dd className="font-bold">{money(total + shortfall)}</dd></div>
                            <div><dt>فرق المطابقة</dt><dd className="font-bold">{invoiceAmount === '' ? '—' : money(difference)}</dd></div>
                        </dl>
                        {confirmed && invoice.notes && !editing && <p className="text-sm">ملاحظات المطابقة · {invoice.notes}</p>}
                        {canEdit && <>
                            <label>ملاحظات المطابقة أو سبب التصحيح<textarea className={field} required={confirmed} value={reason} onChange={event => setReason(event.target.value)} /></label>
                            <div className="flex flex-wrap gap-2">
                                {!confirmed && <button disabled={busy} value="draft" className="rounded-lg border px-3 py-2">حفظ مسودة</button>}
                                {admin && <button disabled={busy} value="confirm" className="rounded-lg bg-teal-700 px-3 py-2 text-white">{confirmed ? 'حفظ التصحيح' : 'اعتماد الفاتورة'}</button>}
                            </div>
                        </>}
                    </form>
                    {confirmed && <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">توزيع التكلفة على الأوردرات</summary>
                        {Object.entries(invoice.shipment_charges).map(([id, item]) => <div key={id} className="mt-2 border-t pt-2">
                            <strong>{item.code} · {money(item.amount)}</strong>
                            {item.cases.map(order => <p key={order.case_id}>{order.case_id} · {money(order.allocated)}</p>)}
                        </div>)}
                    </details>}
                </section>
                {confirmed && <section className="space-y-3 rounded-2xl border border-surface-200 bg-white p-4 dark:bg-surface-900">
                    <h2 className="font-bold">السداد</h2>
                    <p>المسدد {money(invoice.paid)} · المتبقي {money(due)}</p>
                    {invoice.payments.map(item => <div key={item.transaction_id} className="border-b pb-2 text-sm">
                        <p>{item.date} · {item.description} · {money(item.amount)}</p>
                        {admin && <details><summary className="cursor-pointer text-slate-600">فك ربط السداد</summary>
                            <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
                                event.preventDefault();
                                void unlinkPayment(item.transaction_id, String(new FormData(event.currentTarget).get('reason') ?? ''));
                            }}>
                                <label>السبب<input className={field} name="reason" required /></label>
                                <button className="rounded-lg border px-3 py-2" disabled={busy}>تأكيد فك الربط</button>
                            </form>
                        </details>}
                    </div>)}
                    {due > 0 && <form className="grid items-end gap-2 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); void linkPayment(); }}>
                        <label>سداد مسجل في المالية<select className={field} required value={payment} onChange={event => {
                            setPayment(event.target.value);
                            const selected = availablePayments.find(item => item.id === event.target.value);
                            setPaymentAmount(selected ? String(Math.min(due, selected.available)) : '');
                        }}>
                            <option value="">اختار السداد</option>
                            {availablePayments.map(item => <option key={item.id} value={item.id}>{item.date} · {item.description} · {money(item.available)}</option>)}
                        </select></label>
                        <label>المبلغ المرتبط<input className={field} required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /></label>
                        <button disabled={busy || !availablePayments.length} className="rounded-lg border px-3 py-2">ربط السداد</button>
                    </form>}
                    {due > 0 && !availablePayments.length && <p className="text-sm text-slate-600">سجّل الدفع من <Link className="underline" to="/finance/transactions">المالية</Link> كسداد للمورد، ثم اربطه هنا.</p>}
                </section>}
                <section className="space-y-2 rounded-2xl border border-surface-200 bg-white p-4 dark:bg-surface-900">
                    <h2 className="font-bold">سجل الفواتير</h2>
                    {data.invoices.map(item => <button key={item.id} type="button" disabled={busy} onClick={() => setMonth(item.period_month.slice(0, 7))}
                        className="block w-full rounded-lg border p-2 text-right text-sm">
                        {item.period_month.slice(0, 7)} · {item.invoice_ref} · {item.status === 'draft' ? 'مسودة' : `متبقي ${money(item.invoice_amount - item.paid)}`}
                    </button>)}
                    {!data.invoices.length && <p className="text-sm text-slate-600">مفيش فواتير مسجلة للشركة.</p>}
                </section>
            </>}
        </div>
    );
}
