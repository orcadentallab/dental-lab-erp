import { useDoctorLanguage } from '../context/DoctorLanguageContext';
import { useToast } from '../context/ToastContext';

export function useCopyCaseReference() {
    const { t } = useDoctorLanguage();
    const { success, error } = useToast();
    return async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            success(t.caseCopied);
        } catch {
            error(t.copyUnsuccessful);
        }
    };
}
