import { useState } from 'react';
import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { supabase } from '../../lib/supabase';
import { isolatedDesignHtml } from '../../lib/designPreview';
import { doctorPortalService, type PortalDesignReview } from '../../services/doctorPortalService';

export default function DoctorDesignReview({ review, reload }: { review: PortalDesignReview; reload: () => Promise<void> }) {
    const { t } = useDoctorLanguage();
    const [note, setNote] = useState('');
    const [changes, setChanges] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function openPreview() {
        if (!review.preview_path) return;
        setBusy(true);
        setError('');
        try {
            const { data, error: failure } = await supabase.storage.from('design-qc-files').createSignedUrl(review.preview_path, 60);
            if (failure || !data) throw new Error();
            const response = await fetch(data.signedUrl, { credentials: 'omit', cache: 'no-store' });
            if (!response.ok) throw new Error();
            setPreview(isolatedDesignHtml(await response.text()));
        } catch {
            setError(t.designPreviewFailed);
        } finally {
            setBusy(false);
        }
    }

    async function decide(action: 'approved' | 'changes') {
        setBusy(true);
        setError('');
        try {
            await doctorPortalService.decideDesign(review.revision_id, action, note);
            await reload();
        } catch {
            setError(t.designDecisionFailed);
        } finally {
            setBusy(false);
        }
    }

    const title = review.state === 'changes' ? t.designChangesSent
        : review.state === 'approved' ? t.designApproved : t.caseDesign;
    return <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
        <h3 className="font-semibold">{title}</h3>
        {review.note && <p className="portal-muted whitespace-pre-wrap" dir="auto">{review.note}</p>}
        <div className="flex flex-wrap gap-2">
            {review.preview_path
                ? <button type="button" className="portal-chip" disabled={busy} onClick={() => preview ? setPreview(null) : void openPreview()}>
                    {preview ? t.closeScanPreview : t.previewDesign}
                </button>
                : <span className="portal-muted">{t.designPreviewMissing}</span>}
            {review.state === 'pending' && <>
                <button type="button" className="portal-primary" disabled={busy} onClick={() => void decide('approved')}>{t.approveDesign}</button>
                <button type="button" className="portal-chip" disabled={busy} onClick={() => setChanges(value => !value)}>{t.requestDesignChanges}</button>
            </>}
        </div>
        {preview && <iframe title={t.previewDesign} sandbox="allow-scripts" referrerPolicy="no-referrer"
            className="h-80 w-full rounded-xl border bg-white" srcDoc={preview} />}
        {review.state === 'pending' && changes && <form className="space-y-2" onSubmit={event => {
            event.preventDefault();
            if (note.trim() && !busy) void decide('changes');
        }}>
            <label className="portal-field">{t.designChangeNotes}
                <textarea className="portal-input" rows={3} maxLength={1000} required value={note} onChange={event => setNote(event.target.value)} />
            </label>
            <button className="portal-primary" disabled={busy || !note.trim()}>{t.sendDesignChanges}</button>
        </form>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-200">{error}</p>}
    </section>;
}
