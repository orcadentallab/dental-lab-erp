import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, MessageCircle, Moon, Package, Plus, Sun, Users, Wallet, WifiOff } from 'lucide-react';
import { useDoctorLanguage } from '../context/DoctorLanguageContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import DoctorLanguageSwitch from '../components/doctors/DoctorLanguageSwitch';
import { db, type Doctor } from '../services/db';
import { readPortalDraft } from '../lib/portalCaseDraft';
import { doctorPortalService, type PortalMessage, type SupportThread } from '../services/doctorPortalService';

export interface DoctorSupportData {
    messages: PortalMessage[];
    threads: SupportThread[];
    loading: boolean;
    failed: boolean;
    reload: () => Promise<void>;
}

function lastSeen(key: string) {
    try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

export default function DoctorPortalLayout() {
    const { user } = useAuth();
    return <DoctorPortalShell key={user?.entityId} />;
}

function DoctorPortalShell() {
    const { t } = useDoctorLanguage();
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const entityId = user?.entityId || '';
    const supportOpen = location.pathname === '/doctor/support';
    const seenKey = 'orca-doctor-support-seen:' + entityId;
    const [loadedDoctor, setDoctorInfo] = useState<Doctor | null>(null);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
    const [messages, setMessages] = useState<PortalMessage[]>([]);
    const [threads, setThreads] = useState<SupportThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [seen, setSeen] = useState(() => lastSeen(seenKey));
    const reloadSequence = useRef(0);
    const menu = useRef<HTMLDetailsElement>(null);
    const summary = useRef<HTMLElement>(null);
    const doctor = loadedDoctor?.id === entityId ? loadedDoctor : null;
    const legacyReply = messages.reduce((latest, message) => message.reply && message.replied_at
        ? Math.max(latest, Date.parse(message.replied_at) || 0) : latest, 0);
    const latestReply = threads.reduce((latest, thread) => thread.posts.reduce((time, post) =>
        post.from_lab ? Math.max(time, Date.parse(post.created_at) || 0) : time, latest), legacyReply);
    const unread = latestReply > seen && !(supportOpen && visible);

    const reload = useCallback(async () => {
        const sequence = ++reloadSequence.current;
        try {
            const [result, conversations] = await Promise.all([doctorPortalService.messages(), doctorPortalService.threads()]);
            if (sequence !== reloadSequence.current) return;
            setMessages(result);
            setThreads(conversations);
            setFailed(false);
        } catch {
            if (sequence === reloadSequence.current) setFailed(true);
        } finally {
            if (sequence === reloadSequence.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!entityId) return;
        let current = true;
        readPortalDraft(entityId);
        db.getDoctor(entityId).then(result => { if (current && result) setDoctorInfo(result); }).catch(console.error);
        return () => { current = false; };
    }, [entityId]);

    useEffect(() => {
        const connection = () => setOnline(navigator.onLine);
        const visibility = () => setVisible(document.visibilityState === 'visible');
        window.addEventListener('online', connection);
        window.addEventListener('offline', connection);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            window.removeEventListener('online', connection);
            window.removeEventListener('offline', connection);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, []);

    useEffect(() => {
        if (!entityId || !online || !visible) return;
        void reload();
        const timer = window.setInterval(() => void reload(), 60000);
        return () => window.clearInterval(timer);
    }, [entityId, online, visible, reload]);

    useEffect(() => {
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current) menu.current.open = false;
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, []);

    useEffect(() => { if (menu.current) menu.current.open = false; }, [location.key]);

    useEffect(() => {
        if (!entityId || !supportOpen || !visible || latestReply <= seen) return;
        try { localStorage.setItem(seenKey, String(latestReply)); } catch { /* The badge still clears for this session. */ }
        setSeen(latestReply);
    }, [entityId, latestReply, seen, seenKey, supportOpen, visible]);

    const supportData: DoctorSupportData = { messages, threads, loading, failed, reload };
    const nav = [
        { path: '/doctor/my-orders', label: t.myCases, Icon: Package },
        { path: '/doctor/new-request', label: t.newCaseNav, Icon: Plus },
        { path: '/doctor/support', label: t.supportNav, Icon: MessageCircle },
        { path: '/doctor/account', label: t.accountsNav, Icon: Wallet },
    ];
    const unreadDot = unread ? <span aria-label={t.unreadLabReply} role="img" className="absolute -end-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-600 ring-2 ring-white dark:bg-rose-400 dark:ring-slate-900" /> : null;

    return <div className="doctor-portal min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <a href="#doctor-main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3 focus:text-blue-700">{t.skipToContent}</a>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto flex h-16 max-w-5xl min-w-0 items-center justify-between gap-2 px-3 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                    <img src="/orca-logo.png" alt="" width="40" height="40" className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white object-cover" />
                    <div className="min-w-0"><p className="truncate text-sm font-bold">{t.brand}</p><p className="portal-muted truncate text-xs" dir="auto">{doctor?.name || user?.name}</p></div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <DoctorLanguageSwitch />
                    <button type="button" className="portal-action rounded-xl border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        aria-label={t.toggleTheme} title={t.toggleTheme} aria-pressed={theme === 'dark'}
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                    </button>
                    <details ref={menu} className="relative" onKeyDown={event => {
                        if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; summary.current?.focus(); }
                    }}>
                        <summary ref={node => { summary.current = node; }} className="portal-action cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700" aria-label={t.accountMenu}>
                            <span className="relative"><Users size={18} aria-hidden="true" />{unreadDot}</span><ChevronDown size={13} aria-hidden="true" />
                        </summary>
                        <div className="portal-card absolute end-0 top-full mt-2 grid min-w-48 gap-1">
                            <NavLink to="/doctor/account" className="portal-menu-link"><Wallet size={16} aria-hidden="true" />{t.accountsNav}</NavLink>
                            <NavLink to="/doctor/support" className="portal-menu-link"><span className="relative"><MessageCircle size={16} aria-hidden="true" />{unreadDot}</span>{t.supportNav}</NavLink>
                            {doctor?.isCenter && !doctor.parentId && <NavLink to="/doctor/team" className="portal-menu-link"><Users size={16} aria-hidden="true" />{t.centerTeam}</NavLink>}
                            <button type="button" className="portal-menu-link" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>
                                <LogOut size={16} aria-hidden="true" />{t.signOut}
                            </button>
                        </div>
                    </details>
                </div>
            </div>
        </header>

        {!online && <div role="status" className="mx-auto flex max-w-5xl items-center gap-2 bg-amber-100 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <WifiOff size={18} aria-hidden="true" className="shrink-0" />{t.portalOffline}
        </div>}

        <main id="doctor-main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 pt-5" style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
            <Outlet key={entityId} context={supportData} />
        </main>

        <nav aria-label={t.portalNavigation} className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 p-1.5">
                {nav.map(({ path, label, Icon }) => <NavLink to={path} className="portal-nav-link" key={path}>
                    <span className="relative"><Icon size={21} aria-hidden="true" />{path === '/doctor/support' && unreadDot}</span>
                    <span>{label}</span>
                </NavLink>)}
            </div>
        </nav>
    </div>;
}
