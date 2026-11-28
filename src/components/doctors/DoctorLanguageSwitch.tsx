import { useDoctorLanguage } from '../../context/DoctorLanguageContext';

export default function DoctorLanguageSwitch() {
    const { language, setLanguage, t } = useDoctorLanguage();
    return (
        <div role="group" aria-label={t.language} dir="ltr" className="inline-flex items-center rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
            <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage?.('en')} className="min-h-11 min-w-11 rounded-lg text-xs font-bold aria-pressed:bg-white aria-pressed:text-blue-700 dark:aria-pressed:bg-slate-700 dark:aria-pressed:text-blue-300">{t.english}</button>
            <button type="button" lang="ar" aria-pressed={language === 'ar'} onClick={() => setLanguage?.('ar')} className="min-h-11 min-w-11 rounded-lg text-xs font-bold aria-pressed:bg-white aria-pressed:text-blue-700 dark:aria-pressed:bg-slate-700 dark:aria-pressed:text-blue-300">{t.arabic}</button>
        </div>
    );
}
