import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { activeWorkspace, activeSidebarEntry, isReportRoute, REPORT_CATEGORIES } from '../lib/navigation';
import { useTranslation } from '../translations';

/**
 * The browser tab's title.
 *
 * This used to be a second, parallel list of every route in the app -- thirty
 * `if (pathname === ...)` lines maintained by hand. It drifted, as that shape
 * always does: the whole production area, the work calendar and the cash flow
 * report shipped with no title at all, because nobody remembered this file.
 *
 * It reads the navigation registry now, so a page added tomorrow is titled
 * the day it is added, by the same labels the sidebar shows.
 */
export default function TitleUpdater() {
    const { pathname } = useLocation();
    const { language } = useTranslation();
    const isArabic = language === 'ar';

    useEffect(() => {
        document.title = [resolveTitle(pathname, isArabic), 'ORCA Dental Lab']
            .filter(Boolean)
            .join(' | ');
    }, [pathname, isArabic]);

    return null;
}

function resolveTitle(pathname: string, isArabic: boolean): string {
    const label = (item: { labelAr: string; labelEn: string }) =>
        isArabic ? item.labelAr : item.labelEn;

    // Routes outside the authenticated shell have no registry entry.
    if (pathname === '/') return isArabic ? 'الرئيسية' : 'Home';
    if (pathname === '/login') return isArabic ? 'تسجيل الدخول' : 'Login';

    // Most specific first: a tab names the page better than its area does.
    const workspace = activeWorkspace(pathname);
    if (workspace) {
        // /employees/:id resolves to the Staff tab; say which page it is.
        if (workspace.tab.id === 'employees' && pathname !== workspace.tab.path) {
            return isArabic ? 'تفاصيل الموظف' : 'Employee Details';
        }
        return label(workspace.tab);
    }

    if (isReportRoute(pathname)) {
        const report = REPORT_CATEGORIES
            .flatMap(category => category.reports)
            .find(item => [item.path, ...(item.matches || [])].includes(pathname));
        if (report) return label(report);
    }

    const entry = activeSidebarEntry(pathname);
    if (entry) return label(entry);

    return '';
}
