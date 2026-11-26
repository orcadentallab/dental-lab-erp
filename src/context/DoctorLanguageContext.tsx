import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useLanguage, type Language } from './LanguageContext';
import { doctorPortal } from '../translations/doctorPortal';
import { refreshPushSubscription } from '../lib/pushNotifications';
import { supabase } from '../lib/supabase';

const storageKey = 'orca-doctor-language';
const DoctorLanguageContext = createContext<{
    language: Language;
    setLanguage: (language: Language) => void;
} | null>(null);

export function DoctorLanguageProvider({ children }: { children: ReactNode }) {
    const staff = useLanguage();
    const { pathname } = useLocation();
    const [language, setLanguage] = useState<Language>(() => localStorage.getItem(storageKey) === 'ar' ? 'ar' : 'en');

    useLayoutEffect(() => {
        const html = document.documentElement;
        html.dataset.doctorLanguage = language;
        html.lang = language;
        html.dir = language === 'ar' ? 'rtl' : 'ltr';
        localStorage.setItem(storageKey, language);
        void supabase.auth.getSession().then(({ data }) => {
            if (data.session?.user?.id) {
                void refreshPushSubscription(data.session.user.id, language);
            }
        });

        return () => {
            delete html.dataset.doctorLanguage;
            html.lang = staff.language;
            html.dir = staff.isRTL ? 'rtl' : 'ltr';
        };
    }, [language, staff.language, staff.isRTL]);

    useLayoutEffect(() => {
        const t = doctorPortal[language];
        const titles: Record<string, string> = {
            '/login': t.loginTitle,
            '/doctor/my-orders': t.ordersTabTitle,
            '/doctor/new-request': t.requestTabTitle,
            '/doctor/account': t.accountTabTitle,
            '/doctor/support': t.contactLab,
            '/doctor/team': t.centerTeam,
        };
        document.title = `${titles[pathname] ?? t.portalName} | ${t.fullBrand}`;
    }, [language, pathname]);

    const value = useMemo(() => ({ language, setLanguage }), [language]);
    return <DoctorLanguageContext.Provider value={value}>{children}</DoctorLanguageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDoctorLanguage() {
    const context = useContext(DoctorLanguageContext);
    const language = context?.language ?? 'ar';
    return { language, setLanguage: context?.setLanguage, t: doctorPortal[language], isRTL: language === 'ar', locale: language === 'ar' ? 'ar-EG' : 'en-GB' };
}
