import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { marketingDictionary, type MarketingDictionary, type MarketingLang } from './marketingDictionary';

interface MarketingLanguageContextValue {
    lang: MarketingLang;
    setLang: (lang: MarketingLang) => void;
    isRTL: boolean;
    t: MarketingDictionary;
}

const MarketingLanguageContext = createContext<MarketingLanguageContextValue | null>(null);

export function MarketingLanguageProvider({ children }: { children: ReactNode }) {
    const [lang, setLang] = useState<MarketingLang>('en');
    const isRTL = lang === 'ar';

    useLayoutEffect(() => {
        const html = document.documentElement;
        const prevLang = html.lang;
        const prevDir = html.dir;

        html.lang = lang;
        html.dir = isRTL ? 'rtl' : 'ltr';

        return () => {
            html.lang = prevLang || 'ar';
            html.dir = prevDir || 'rtl';
        };
    }, [lang, isRTL]);

    const value = useMemo<MarketingLanguageContextValue>(
        () => ({
            lang,
            setLang,
            isRTL,
            t: marketingDictionary[lang],
        }),
        [lang, isRTL]
    );

    return (
        <MarketingLanguageContext.Provider value={value}>
            {children}
        </MarketingLanguageContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMarketingLanguage() {
    const ctx = useContext(MarketingLanguageContext);
    if (!ctx) {
        throw new Error('useMarketingLanguage must be used within MarketingLanguageProvider');
    }
    return ctx;
}
