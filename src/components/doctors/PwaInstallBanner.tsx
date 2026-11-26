import { useEffect, useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useDoctorLanguage } from '../../context/DoctorLanguageContext';

export const PWA_INSTALL_DISMISSED_KEY = 'orca-pwa-install-dismissed';

export interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
    interface Window {
        __orcaDeferredInstallPrompt?: BeforeInstallPromptEvent | null;
    }
    interface Navigator {
        standalone?: boolean;
    }
}

export function isStandaloneMode(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches === true || window.navigator.standalone === true;
}

export function isIosSafari(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
    const isIos = /iPad|iPhone|iPod/i.test(userAgent)
        || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIos) return false;
    const isWebKit = /WebKit/i.test(userAgent);
    const isOtherIosBrowser = /CriOS|FxiOS|OPiOS|EdgiOS/i.test(userAgent);
    return isWebKit && !isOtherIosBrowser;
}

function readDismissed(): boolean {
    try {
        return localStorage.getItem(PWA_INSTALL_DISMISSED_KEY) === '1';
    } catch {
        return false;
    }
}

function persistDismissed() {
    try {
        localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, '1');
    } catch {
        // Ignore storage quota or private browsing errors.
    }
}

export default function PwaInstallBanner() {
    const { t } = useDoctorLanguage();
    const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
    const [standalone, setStandalone] = useState<boolean>(() => isStandaloneMode());
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
        () => (typeof window !== 'undefined' ? window.__orcaDeferredInstallPrompt ?? null : null),
    );
    const [iosSafari] = useState<boolean>(() => isIosSafari());

    useEffect(() => {
        const onBeforeInstall = (event: Event) => {
            event.preventDefault();
            const promptEvent = event as BeforeInstallPromptEvent;
            window.__orcaDeferredInstallPrompt = promptEvent;
            setDeferredPrompt(promptEvent);
        };
        const onAppInstalled = () => {
            window.__orcaDeferredInstallPrompt = null;
            setDeferredPrompt(null);
            setStandalone(true);
            persistDismissed();
            setDismissed(true);
        };
        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onAppInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onAppInstalled);
        };
    }, []);

    if (standalone || dismissed) return null;

    const handleDismiss = () => {
        persistDismissed();
        setDismissed(true);
    };

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        try {
            await deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            window.__orcaDeferredInstallPrompt = null;
            setDeferredPrompt(null);
            if (choice.outcome === 'accepted') {
                persistDismissed();
                setDismissed(true);
            } else {
                handleDismiss();
            }
        } catch {
            handleDismiss();
        }
    };

    if (deferredPrompt) {
        return (
            <aside
                aria-label={t.pwaInstallTitle}
                className="portal-card mb-4 flex items-center justify-between gap-3 border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/40"
            >
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white">
                        <Smartphone size={20} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.pwaInstallTitle}</p>
                        <p className="portal-muted text-xs">{t.pwaInstallSubtitle}</p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => void handleInstall()} className="portal-primary">
                        <Download size={16} aria-hidden="true" />
                        <span>{t.pwaInstallAction}</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        aria-label={t.pwaInstallDismiss}
                        className="portal-action text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>
            </aside>
        );
    }

    if (iosSafari) {
        return (
            <aside
                aria-label={t.pwaIosTitle}
                className="portal-card mb-4 space-y-2.5 border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/40"
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white">
                            <Smartphone size={18} aria-hidden="true" />
                        </div>
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.pwaIosTitle}</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        aria-label={t.pwaInstallDismiss}
                        className="portal-action text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>
                <ol className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200">
                    <li className="flex items-center gap-2">
                        <Share size={15} aria-hidden="true" className="shrink-0 text-blue-700 dark:text-blue-300" />
                        <span>{t.pwaIosStep1}</span>
                    </li>
                    <li className="flex items-center gap-2">
                        <PlusSquare size={15} aria-hidden="true" className="shrink-0 text-blue-700 dark:text-blue-300" />
                        <span>{t.pwaIosStep2}</span>
                    </li>
                </ol>
                <p className="rounded-xl bg-white/80 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                    {t.pwaIosPushNote}
                </p>
                <div className="flex justify-end">
                    <button type="button" onClick={handleDismiss} className="portal-chip">
                        {t.pwaGotIt}
                    </button>
                </div>
            </aside>
        );
    }

    return null;
}
