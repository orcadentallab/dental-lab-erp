import { ar } from './ar';
import type { TranslationKeys } from './ar';
import { en } from './en';
import { useLanguage } from '../context/LanguageContext';

export const translations: Record<'ar' | 'en', TranslationKeys> = {
    ar,
    en,
};

// Hook to get translations based on current language
export function useTranslation() {
    const { language, isRTL } = useLanguage();
    const t = translations[language];

    return { t, language, isRTL };
}

// Helper function to get nested translation key
export function getNestedValue(obj: Record<string, unknown>, path: string): string {
    const keys = path.split('.');
    let result: unknown = obj;

    for (const key of keys) {
        if (result && typeof result === 'object' && key in result) {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            result = (result as Record<string, unknown>)[key];
        } else {
            return path; // Return the path if not found
        }
    }

    return typeof result === 'string' ? result : path;
}
