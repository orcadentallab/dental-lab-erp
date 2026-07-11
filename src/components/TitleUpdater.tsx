import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../translations';

export default function TitleUpdater() {
    const location = useLocation();
    const { t, language } = useTranslation();

    useEffect(() => {
        const getTitle = (pathname: string): string => {
            if (pathname === '/') return language === 'ar' ? 'الرئيسية' : 'Home';
            if (pathname === '/login') return language === 'ar' ? 'تسجيل الدخول' : 'Login';
            if (pathname === '/dashboard') return t.nav.dashboard;
            if (pathname === '/orders') return t.nav.orders;
            if (pathname === '/doctors') return t.nav.doctors;
            if (pathname === '/doctors/retention') return language === 'ar' ? 'متابعة وتنشيط الأطباء' : 'Doctor Retention';
            if (pathname === '/quality') return t.nav.quality;
            if (pathname === '/accounts') return t.nav.accounts;
            if (pathname === '/settings') return t.nav.settings;
            if (pathname === '/employees') return t.nav.staff;
            if (pathname.startsWith('/employees/')) return language === 'ar' ? 'تفاصيل الموظف' : 'Employee Details';
            if (pathname === '/finance') return t.nav.finance;
            if (pathname === '/suppliers') return t.nav.suppliers;
            if (pathname === '/case-registration') return t.nav.caseRegistration;
            if (pathname === '/balance-snapshot') return language === 'ar' ? 'لقطة الأرصدة' : 'Balance Snapshot';
            if (pathname === '/statements') return language === 'ar' ? 'الفواتير' : 'Statements';
            if (pathname === '/aging-report') return language === 'ar' ? 'أعمار الديون' : 'Aging Report';
            if (pathname === '/analytics') return t.nav.analytics;
            if (pathname === '/ai-analytics') return language === 'ar' ? 'التحليلات الذكية' : 'AI Analytics';
            if (pathname === '/users') return t.nav.users;
            if (pathname === '/services') return language === 'ar' ? 'الخدمات وأسعارها' : 'Services & Prices';
            if (pathname === '/issues-report') return language === 'ar' ? 'تقرير المشكلات' : 'Issues Report';
            if (pathname === '/marketing-analytics') return language === 'ar' ? 'تحليلات التسويق' : 'Marketing Analytics';
            if (pathname === '/designer-stats') return language === 'ar' ? 'إحصائيات المصممين' : 'Designer Stats';
            
            // Doctor portal
            if (pathname === '/doctor/new-request') return language === 'ar' ? 'طلب جديد' : 'New Order';
            if (pathname === '/doctor/my-orders') return language === 'ar' ? 'أوردراتي' : 'My Orders';
            if (pathname === '/doctor/account') return language === 'ar' ? 'حسابي' : 'My Account';

            return '';
        };

        const pageTitle = getTitle(location.pathname);
        if (pageTitle) {
            document.title = `${pageTitle} | ORCA Dental Lab`;
        } else {
            document.title = 'ORCA Dental Lab';
        }
    }, [location.pathname, language, t]);

    return null;
}
