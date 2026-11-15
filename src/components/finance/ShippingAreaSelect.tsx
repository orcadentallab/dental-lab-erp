import { useEffect, useId, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';

let areaRequest: Promise<string[]> | undefined;
const areaKey = (value: string) => value.trim().replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ـ/g, '').toLowerCase();

export default function ShippingAreaSelect({ value, onChange, canAdd = false }: {
    value: string;
    onChange: (area: string) => void;
    canAdd?: boolean;
}) {
    const [areas, setAreas] = useState<string[]>([]);
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [prefix, setPrefix] = useState('');
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [saveError, setSaveError] = useState('');
    const listId = useId();
    useEffect(() => {
        let current = true;
        areaRequest ??= Promise.resolve(supabase.from('shipping_areas').select('name').order('name')).then(({ data, error }) => {
            if (error) { areaRequest = undefined; throw error; }
            return (data ?? []).map(row => String(row.name));
        });
        areaRequest.then(items => { if (current) setAreas(items); }).catch(() => { if (current) setFailed(true); });
        return () => { current = false; };
    }, []);
    const query = search.trim();
    const matches = ['', ...areas].filter(area => !query || areaKey(area).includes(areaKey(query)) || (query === 'القاهرة الجديدة' && /التجمع|الرحاب/.test(area)));
    const close = () => { setOpen(false); setSearch(''); setHighlighted(-1); };
    const closeAdd = () => { setAdding(false); setNewName(''); setPrefix(''); setSaveError(''); };
    const choose = (area: string) => { onChange(area); close(); };
    const addArea = async () => {
        const name = newName.trim().replace(/\s+/g, ' ');
        if (saving || !prefix || !name) return;
        const existing = areas.find(area => areaKey(area) === areaKey(name));
        if (existing) { setSaveError(`المنطقة مسجلة باسم «${existing}»`); return; }
        setSaving(true);
        setSaveError('');
        try {
            const { error } = await supabase.rpc('add_shipping_area', { p_name: name, p_prefix: Number(prefix) });
            if (error) throw error;
            areaRequest = undefined;
            setAreas(previous => [...previous, name].sort((a, b) => a.localeCompare(b, 'ar')));
            choose(name);
            closeAdd();
        } catch (error) {
            setSaveError((error as { message?: string })?.message || 'تعذر إضافة المنطقة');
        } finally {
            setSaving(false);
        }
    };
    return <span className="relative mt-1 block" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
        <span className="flex items-center gap-2">
        <span className="relative block min-w-0 flex-1">
            <input role="combobox" aria-label="اختيار المنطقة" aria-autocomplete="list" aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open && highlighted >= 0 && matches[highlighted] !== undefined ? `${listId}-${highlighted}` : undefined}
                autoComplete="off" placeholder={open ? 'ابحث عن منطقة' : 'اختار المنطقة'}
                className="w-full rounded-lg border bg-white py-2 ps-3 pe-9 text-sm dark:bg-slate-900"
                value={open ? search : value}
                onFocus={() => { if (!adding) setOpen(true); }} onClick={() => { closeAdd(); setOpen(true); }}
                onChange={event => { setSearch(event.target.value); setOpen(true); setHighlighted(0); }}
                onKeyDown={event => {
                    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        setOpen(true);
                        setHighlighted(index => event.key === 'ArrowDown'
                            ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0));
                    }
                    if (event.key === 'Enter' && open) {
                        event.preventDefault();
                        if (highlighted >= 0 && matches[highlighted] !== undefined) choose(matches[highlighted]);
                    }
                }} />
            <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-slate-500" />
        </span>
        {canAdd && <button type="button" aria-label="إضافة منطقة جديدة" title="إضافة منطقة جديدة" aria-expanded={adding}
            onClick={() => {
                if (adding) { closeAdd(); return; }
                close();
                setAdding(true);
            }}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200">
            <Plus size={19} aria-hidden="true" />
        </button>}
        </span>
        {open && <span className="absolute inset-x-0 top-full z-30 mt-1 block rounded-lg border bg-white shadow-lg dark:bg-slate-900">
            <span id={listId} role="listbox" aria-label="المناطق" className="block max-h-44 overflow-y-auto p-1">
                {matches.map((area, index) => <span key={area} id={`${listId}-${index}`} role="option"
                    aria-selected={area === value}
                    className={`block cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${index === highlighted ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                    onPointerDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); choose(area); }}>
                    {area || 'بدون منطقة'}
                </span>)}
            </span>
            {!matches.length && <small className="block px-3 py-2">مفيش منطقة مطابقة.</small>}
        </span>}
        {adding && <span className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <input aria-label="اسم المنطقة الجديدة" placeholder="اسم المنطقة الجديدة" autoFocus
                className="min-w-32 flex-1 rounded border bg-white p-1.5 text-sm dark:bg-slate-900"
                value={newName} maxLength={100} onChange={event => { setNewName(event.target.value); setSaveError(''); }}
                onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); void addArea(); }
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAdd(); }
                }} />
            <select aria-label="نطاق كود المنطقة الجديدة" value={prefix} onChange={event => setPrefix(event.target.value)}
                className="rounded border bg-white p-1 text-sm dark:bg-slate-900">
                <option value="">اختار نطاق الكود</option>
                {[1, 2, 3, 5, 6].map(number => <option key={number} value={number}>{number * 1000 + 1}–{number * 1000 + 999}</option>)}
            </select>
            <button type="button" disabled={saving || !prefix || !newName.trim()} onClick={() => void addArea()}
                className="rounded bg-teal-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                إضافة
            </button>
            <button type="button" disabled={saving} onClick={closeAdd} className="px-1 text-sm">إلغاء</button>
        </span>}
        {failed && <small role="alert">تعذر تحميل قائمة المناطق.</small>}
        {saveError && <small role="alert">{saveError}</small>}
    </span>;
}
