import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { doctorPortalService, type PortalTryInRequest } from '../../services/doctorPortalService';

export default function DoctorTryInResponse({ request, reload }: {
    request: PortalTryInRequest;
    reload: () => Promise<void>;
}) {
    const { t } = useDoctorLanguage();
    const [askingForChanges, setAskingForChanges] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    async function respond(action: 'approve' | 'changes') {
        setBusy(true);
        setFailed(false);
        try {
            await doctorPortalService.respondToTryIn(request, action, action === 'changes' ? note : '');
            await reload();
        } catch {
            setFailed(true);
            await reload();
        } finally {
            setBusy(false);
        }
    }

    return <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <h3 className="flex items-center gap-2 text-sm font-bold">
            <Clock size={16} aria-hidden="true" />{t.tryInInputRequired}
        </h3>
        <div className="flex flex-wrap gap-2">
            <button type="button" className="portal-primary" disabled={busy} onClick={() => void respond('approve')}>{t.approveTryIn}</button>
            <button type="button" className="portal-chip" disabled={busy} aria-pressed={askingForChanges}
                onClick={() => setAskingForChanges(value => !value)}>{t.requestTryInChanges}</button>
        </div>
        {askingForChanges && <form className="space-y-2" onSubmit={event => {
            event.preventDefault();
            if (note.trim() && !busy) void respond('changes');
        }}>
            <label className="portal-field">{t.tryInChangeNotes}
                <textarea required className="portal-input" rows={3} maxLength={1000} value={note}
                    onChange={event => setNote(event.target.value)} />
            </label>
            <button className="portal-primary" disabled={busy || !note.trim()}>{t.sendDesignChanges}</button>
        </form>}
        {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-200">{t.tryInResponseFailed}</p>}
    </section>;
}
