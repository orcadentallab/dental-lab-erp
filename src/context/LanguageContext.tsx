import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';

export type Language = 'ar' | 'en';

type LanguageContextType = {
    language: Language;
    setLanguage: (lang: Language) => void;
    isRTL: boolean;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'dental-lab-language';

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<Language>(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return (stored === 'ar' || stored === 'en') ? stored : 'ar';
    });

    const isRTL = language === 'ar';

    useEffect(() => {
        const html = document.documentElement;
        html.dir = isRTL ? 'rtl' : 'ltr';
        html.lang = language;
        localStorage.setItem(STORAGE_KEY, language);
    }, [language, isRTL]);

    const setLanguage = useCallback((lang: Language) => {
        setLanguageState(lang);
    }, []);

    // Memoised for the same reason as the toast and auth contexts: a fresh
    // object here re-runs every consumer effect that depends on it.
    const value = useMemo(() => ({ language, setLanguage, isRTL }), [language, setLanguage, isRTL]);

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
