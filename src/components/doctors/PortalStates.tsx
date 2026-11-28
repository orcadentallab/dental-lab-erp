import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export function PortalSkeleton({ label }: { label: string }) {
    return <Card initial={false} role="status" aria-label={label} className="portal-card min-h-32 animate-pulse space-y-3 motion-reduce:animate-none">
        <div className="h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-9 w-full rounded-xl bg-slate-100 dark:bg-slate-800" />
    </Card>;
}

export function PortalError({ message, retry }: { message: string; retry: () => void }) {
    const { t } = useDoctorLanguage();
    return <Card initial={false} className="portal-card space-y-3">
        <p role="alert" className="font-semibold text-rose-700 dark:text-rose-300">{message}</p>
        <Button type="button" variant="secondary" onClick={retry}>{t.portalRetry}</Button>
    </Card>;
}
