import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Package, Plus, Wallet, LogOut, MessageCircle, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useEffect, useState } from 'react';
import { db, type Doctor } from '../services/db';

export default function DoctorPortalLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { theme, setTheme } = useTheme();
    const [loadedDoctor, setDoctorInfo] = useState<Doctor | null>(null);
    const doctorInfo = loadedDoctor?.id === user?.entityId ? loadedDoctor : null;

    useEffect(() => {
        if (!user?.entityId) return;
        let current = true;
        db.getDoctor(user.entityId)
            .then(doc => { if (current && doc) setDoctorInfo(doc); })
            .catch(console.error);
        return () => { current = false; };
    }, [user?.entityId]);

    const handleLogout = async () => {
        await logout();
        navigate('/login', { replace: true });
    };

    // Lab WhatsApp Official Support Link
    const labWhatsAppNumber = import.meta.env.VITE_LAB_WHATSAPP_NUMBER;
    const whatsappHelpUrl = `https://wa.me/${labWhatsAppNumber}?text=${encodeURIComponent(
        `مرحباً معمل ORCA، أنا دكتور ${doctorInfo?.name || user?.name || ''} (${doctorInfo?.doctorCode || ''})، أحتاج استفساراً بخصوص الحالات.`
    )}`;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-sans selection:bg-blue-500/20" dir="rtl">
            {/* Top Header */}
            <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
                <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
                    {/* Logo & Brand */}
                    <div className="flex items-center gap-3">
                        <img
                            src="/orca-logo.png"
                            alt="ORCA Lab"
                            className="w-10 h-10 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 object-cover"
                        />
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-black text-blue-900 dark:text-blue-400 tracking-tight text-base">ORCA Lab</span>
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold px-2 py-0.5 rounded-full border border-blue-200/60 dark:border-blue-800/40">
                                    بوابة الأطباء
                                </span>
                            </div>
                            {doctorInfo && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate max-w-[180px] sm:max-w-xs">
                                    {doctorInfo.name} ({doctorInfo.doctorCode})
                                </p>
                            )}
                        </div>
                    </div>

                    {doctorInfo?.isCenter && !doctorInfo.parentId && <NavLink to="/doctor/team" className="text-sm text-blue-600 p-2">أطباء المركز</NavLink>}
                    {/* Quick Actions (WhatsApp Support, Theme toggle, Logout) */}
                    <div className="flex items-center gap-2">
                        <a
                            href={labWhatsAppNumber ? whatsappHelpUrl : '/doctor/support'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200/80 dark:border-emerald-800/60 text-xs font-bold transition-all shadow-sm"
                            title="تواصل مع خدمة عملاء المعمل عبر الواتساب"
                        >
                            <MessageCircle size={15} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="hidden sm:inline">دعم المعمل</span>
                        </a>

                        <button
                            type="button"
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            aria-label="تبديل الوضع الليلي"
                        >
                            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                        </button>

                        <button
                            type="button"
                            onClick={handleLogout}
                            className="p-2 rounded-xl text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="تسجيل الخروج"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 max-w-5xl w-full mx-auto p-4 pb-28 md:pb-12">
                <Outlet key={user?.entityId} />
            </main>

            {/* Bottom Navigation Bar (Optimized for Mobile/Tablet & Touch) */}
            <nav
                aria-label="قائمة التنقل السفلية للطبيب"
                className="fixed bottom-0 inset-x-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 shadow-lg shadow-slate-900/5 transition-colors"
            >
                <div className="max-w-md mx-auto h-16 px-6 flex items-center justify-between relative">
                    {/* Destination 1: Orders */}
                    <NavLink
                        to="/doctor/my-orders"
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center flex-1 gap-1 py-1 transition-all ${
                                isActive
                                    ? 'text-blue-600 dark:text-blue-400 font-bold scale-105'
                                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                            }`
                        }
                    >
                        <Package size={22} />
                        <span className="text-[11px]">حالاتي</span>
                    </NavLink>

                    {/* Destination 2: Prominent Center Button: New Case / Pickup Request */}
                    <div className="relative -top-5 flex-shrink-0">
                        <NavLink
                            to="/doctor/new-request"
                            className={({ isActive }) =>
                                `w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform transform active:scale-95 ${
                                    isActive
                                        ? 'bg-gradient-to-tr from-blue-700 to-indigo-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/50'
                                        : 'bg-gradient-to-tr from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white shadow-blue-500/30'
                                }`
                            }
                            aria-label="طلب حالة جديدة أو استلام مقاس"
                        >
                            <Plus size={28} strokeWidth={2.5} />
                        </NavLink>
                    </div>

                    <NavLink to="/doctor/support" className="flex flex-col items-center justify-center flex-1 text-blue-600 gap-1"><MessageCircle size={22} /><span className="text-[11px]">المعمل</span></NavLink>
                    {/* Destination 3: Finance & Account Statement */}
                    <NavLink
                        to="/doctor/account"
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center flex-1 gap-1 py-1 transition-all ${
                                isActive
                                    ? 'text-blue-600 dark:text-blue-400 font-bold scale-105'
                                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
                            }`
                        }
                    >
                        <Wallet size={22} />
                        <span className="text-[11px]">الحسابات</span>
                    </NavLink>
                </div>
            </nav>
        </div>
    );
}
