import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function DoctorPasswordField({ label, value, onChange, note, isNew = false }: {
    label: string; value: string; onChange: (value: string) => void; note?: string; isNew?: boolean;
}) {
    const [visible, setVisible] = useState(false);
    const id = useId();
    return <div className="space-y-1">
        <label htmlFor={id} className="block text-sm">{label}</label>
        <div className="relative">
            <input id={id} aria-label={label} aria-describedby={note ? `${id}-note` : undefined} className="w-full p-3 pl-14 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 focus:ring-2 focus:ring-blue-500"
                type={visible ? 'text' : 'password'} autoComplete={isNew ? 'new-password' : 'current-password'} minLength={isNew ? 8 : undefined} maxLength={72} required value={value} onChange={event => onChange(event.target.value)} />
            <button type="button" aria-label={`${visible ? 'إخفاء' : 'إظهار'} ${label}`} aria-pressed={visible} onClick={() => setVisible(!visible)} className="absolute left-0 top-0 min-w-11 min-h-11 flex items-center justify-center text-slate-500 hover:text-blue-600 rounded-xl focus:ring-2 focus:ring-blue-500">
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
        </div>
        {note && <p id={`${id}-note`} className="text-xs text-slate-500">{note}</p>}
    </div>;
}
