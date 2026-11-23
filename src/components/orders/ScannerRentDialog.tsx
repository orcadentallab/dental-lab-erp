import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../../context/ToastContext';
import { financeService } from '../../services/financeService';
import { isoToday } from '../../utils/smartDate';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { DoctorSelect } from './DoctorSelect';

export default function ScannerRentDialog({ onClose }: { onClose: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const savingRef = useRef(false);
    const [isSaving, setIsSaving] = useState(false);
    const [doctorId, setDoctorId] = useState('');
    const [doctorError, setDoctorError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(isoToday);
    const [caseName, setCaseName] = useState('');
    const [notes, setNotes] = useState('');
    const { success } = useToast();

    useEffect(() => {
        const dialog = dialogRef.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (savingRef.current) return;
        if (!doctorId) {
            setDoctorError('يرجى اختيار الطبيب');
            return;
        }
        const charge = Number(amount);
        if (!Number.isFinite(charge) || charge <= 0 || !date) return;

        savingRef.current = true;
        setIsSaving(true);
        setSaveError('');
        try {
            const name = caseName.trim();
            const reason = ['Scanner Rent', name && `اسم الحالة: ${name}`, notes.trim()].filter(Boolean).join(' - ');
            await financeService.addAdjustment({
                entity_type: 'doctor',
                entity_id: doctorId,
                amount: charge,
                type: 'charge',
                date,
                reason,
            });
        } catch {
            setSaveError('تعذر تسجيل إيجار السكانر. حاول مرة أخرى.');
            return;
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
        success('تم تسجيل إيجار السكانر على حساب الطبيب');
        onClose();
    }

    return (
        <dialog
            ref={dialogRef}
            dir="rtl"
            aria-labelledby="scanner-rent-title"
            onCancel={event => {
                event.preventDefault();
                if (!savingRef.current) onClose();
            }}
            className="m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-5 text-surface-900 shadow-xl backdrop:bg-black/50"
        >
            <h2 id="scanner-rent-title" className="mb-4 text-lg font-bold">إيجار السكانر</h2>
            <form onSubmit={handleSubmit}>
                <fieldset disabled={isSaving} className="space-y-4">
                    <div>
                        <div className="mb-1 text-sm font-medium">الطبيب</div>
                        <DoctorSelect value={doctorId} error={doctorError} onChange={id => {
                            setDoctorId(id);
                            setDoctorError('');
                        }} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-sm font-medium">
                            <span>المبلغ</span>
                            <Input type="number" min="0.01" max="9999999999.99" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required />
                        </label>
                        <label className="space-y-1 text-sm font-medium">
                            <span>التاريخ</span>
                            <Input type="date" value={date} onChange={event => setDate(event.target.value)} required />
                        </label>
                    </div>
                    <label className="block space-y-1 text-sm font-medium">
                        <span>اسم الحالة (اختياري)</span>
                        <Input value={caseName} onChange={event => setCaseName(event.target.value)} />
                    </label>
                    <label className="block space-y-1 text-sm font-medium">
                        <span>ملاحظات (اختياري)</span>
                        <Input value={notes} onChange={event => setNotes(event.target.value)} />
                    </label>
                    {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>إلغاء</Button>
                        <Button type="submit">{isSaving ? 'جاري التسجيل…' : 'تسجيل الإيجار'}</Button>
                    </div>
                </fieldset>
            </form>
        </dialog>
    );
}
