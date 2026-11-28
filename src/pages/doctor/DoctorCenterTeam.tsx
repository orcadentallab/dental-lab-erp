import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { useToast } from '../../context/ToastContext';
import { PortalError, PortalSkeleton } from '../../components/doctors/PortalStates';
import { Card } from '../../components/ui/Card';
import { doctorPortalService, type PortalContext } from '../../services/doctorPortalService';
import { doctorPasswordService } from '../../services/auth/doctorPasswordService';
import { doctorPortalQaEnabled } from '../../lib/doctorPortalQa';

export default function DoctorCenterTeam() {
    const { t } = useDoctorLanguage();
    const { success } = useToast();
    const [context, setContext] = useState<PortalContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [error, setError] = useState<'invitationCreateError' | 'copyLinkHint' | ''>('');
    const [busy, setBusy] = useState('');
    const [link, setLink] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try { setContext(await doctorPortalService.context()); }
        catch { setFailed(true); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const invite = async (memberId: string) => {
        if (busy) return;
        setBusy(memberId);
        setError('');
        try { setLink((await doctorPasswordService.createInvitation(memberId)).url); }
        catch { setError('invitationCreateError'); }
        finally { setBusy(''); }
    };

    const members = context?.is_center ? context.members.filter(member => member.id !== context.doctor_id) : [];
    return <div className="portal-page max-w-3xl">
        <div><h1 className="portal-title">{t.centerTeam}</h1><p className="portal-muted">{t.centerTeamIntro}</p></div>
        {loading && <PortalSkeleton label={t.loadingTeam} />}
        {!loading && failed && <PortalError message={t.loadTeamError} retry={() => void load()} />}
        {error && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">{t[error]}</p>}
        {link && <Card initial={false} className="portal-card space-y-2">
            <label className="portal-field">{t.invitationLink}
                <input readOnly dir="ltr" className="portal-input" value={link} onFocus={event => event.target.select()} />
            </label>
            <button type="button" className="portal-primary" onClick={async () => {
                try { await navigator.clipboard.writeText(link); success(t.caseCopied); } catch { setError('copyLinkHint'); }
            }}>{t.copyLink}</button>
        </Card>}
        {!loading && !failed && members.length === 0 && <Card initial={false} className="portal-card space-y-2 text-center">
            <Users size={30} aria-hidden="true" className="mx-auto text-blue-700 dark:text-blue-300" />
            <p className="font-semibold">{context?.is_center ? t.teamEmpty : t.centerOnly}</p>
            <p className="portal-muted">{t.linkExistingDentist}</p>
            <Link className="portal-primary" to="/doctor/support">{t.messageTheLab}</Link>
        </Card>}
        {members.map(member => <Card initial={false} key={member.id} className="portal-card flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold" dir="auto">{member.name}</h2><p className="portal-muted"><bdi dir="ltr">{member.phone} — {member.doctor_code}</bdi></p></div>
            {member.has_account ? <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t.accountLinked}</p>
                : doctorPortalQaEnabled && <button type="button" disabled={!!busy} className="portal-primary" onClick={() => void invite(member.id)}>{busy === member.id ? t.creatingInvitation : t.inviteDentist}</button>}
        </Card>)}
    </div>;
}
