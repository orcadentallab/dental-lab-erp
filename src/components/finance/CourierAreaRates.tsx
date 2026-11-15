import ShippingAreaSelect from './ShippingAreaSelect';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';

export default function CourierAreaRates({ courierId }: { courierId: string }) {
    const toast = useToast();
    const [area, setArea] = useState('');
    const [price, setPrice] = useState('');
    const [rates, setRates] = useState<{ id: string; area: string; amount: number }[]>([]);
    const [version, setVersion] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let current = true;
        supabase.rpc('get_courier_area_rates', { p_courier: courierId, p_month: null })
            .then(({ data, error: failure }) => {
                if (!current) return;
                setError(failure?.message ?? '');
                setRates(data?.rates ?? []);
            });
        return () => { current = false; };
    }, [courierId, version]);
    const field = 'block w-full rounded-lg border border-surface-200 bg-white px-2 py-2 dark:bg-surface-800';
    return <fieldset className="space-y-3 rounded-xl border border-surface-200 p-3" disabled={busy}>
        <legend className="px-2 font-semibold">أسعار الشحن حسب المنطقة</legend>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
            <label>المنطقة<ShippingAreaSelect value={area} onChange={setArea} /></label>
            <label>السعر الأساسي<input type="number" min="0" step="0.01" className={field} value={price} onChange={e => setPrice(e.target.value)} /></label>
        </div>
        <button type="button" disabled={!area.trim() || price === ''} className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={async () => {
                setBusy(true);
                const { error: failure } = await supabase.rpc('save_courier_area_rate', {
                    p_courier: courierId, p_area: area, p_amount: Number(price),
                });
                setBusy(false);
                if (failure) toast.error(failure.message);
                else { setVersion(previous => previous + 1); setArea(''); setPrice(''); toast.success('تم حفظ سعر المنطقة'); }
            }}>حفظ سعر المنطقة</button>
        {error && <p role="alert">{error}</p>}
        <ul className="flex flex-wrap gap-2">
            {rates.map(rate => <li key={rate.id}><button type="button" className="rounded-lg border px-2 py-1 text-sm"
                onClick={() => { setArea(rate.area); setPrice(String(rate.amount)); }}>{rate.area} · {rate.amount} ج.م</button></li>)}
        </ul>
    </fieldset>;
}
