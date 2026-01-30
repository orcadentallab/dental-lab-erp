import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../translations';
import { LayoutDashboard, ShoppingBag, Users, DollarSign, LogOut, Menu, X, Factory, FileText, Shield, Settings, BarChart3, Award, Briefcase, Brain, Plus } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const { t } = useTranslation();

    const navigation = [
        { name: t.nav.dashboard, href: '/', icon: LayoutDashboard, roles: ['admin', 'lab', 'representative', 'accountant', 'designer'] },
        { name: t.nav.orders, href: '/orders', icon: ShoppingBag, roles: ['admin', 'lab', 'representative', 'accountant', 'designer'] },
        { name: t.nav.quality, href: '/quality', icon: Award, roles: ['admin', 'representative'] },
        { name: t.nav.accounts, href: '/accounts', icon: FileText, roles: ['admin', 'accountant', 'lab', 'designer', 'representative'] },
        { name: t.nav.finance, href: '/finance', icon: DollarSign, roles: ['admin', 'accountant'] },
        { name: t.nav.analytics, href: '/analytics', icon: BarChart3, roles: ['admin'] },
        { name: 'التحليلات الذكية', href: '/ai-analytics', icon: Brain, roles: ['admin'] },
        { name: t.nav.doctors, href: '/doctors', icon: Users, roles: ['admin', 'representative'] },
        { name: t.nav.suppliers, href: '/suppliers', icon: Factory, roles: ['admin', 'accountant'] },
        { name: t.nav.staff, href: '/staff', icon: Briefcase, roles: ['admin', 'accountant', 'representative'] },
        { name: t.nav.users, href: '/users', icon: Shield, roles: ['admin'] },
        { name: t.nav.settings, href: '/settings', icon: Settings, roles: ['admin', 'lab', 'representative', 'accountant'] },
        // Doctor Portal
        { name: 'طلب جديد', href: '/doctor/new-request', icon: Plus, roles: ['doctor'] },
        { name: 'أوردراتي', href: '/doctor/my-orders', icon: ShoppingBag, roles: ['doctor'] },
        { name: 'حسابي', href: '/doctor/account', icon: DollarSign, roles: ['doctor'] },
    ];

    const filteredNav = navigation.filter(item => user && item.roles.includes(user.role));

    return (
        <>
            {/* Mobile Menu Button - Hidden in Print */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="md:hidden fixed top-4 right-4 z-50 p-2.5 bg-white/80 backdrop-blur-md border border-surface-200 rounded-xl shadow-lg text-surface-600 print:hidden"
            >
                {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Overlay */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 z-40 md:hidden print:hidden backdrop-blur-sm"
                        onClick={() => setIsOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar - Hidden in Print */}
            <div className={clsx(
                "fixed inset-y-0 right-0 z-40 w-72 bg-white/80 dark:bg-surface-900/90 backdrop-blur-xl border-l border-surface-200/50 dark:border-surface-700 shadow-2xl md:shadow-none transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:h-screen print:hidden",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}>
                <div className="flex flex-col h-full">

                    {/* Header */}
                    <div className="p-8 border-b border-surface-200/50 dark:border-surface-700/50 flex items-center gap-4">
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.5 }}
                            className="relative"
                        >
                            <div className="absolute inset-0 bg-primary-500/20 blur-lg rounded-full"></div>
                            <img src="/orca-logo.png" alt="ORCA Dental Lab" className="relative w-12 h-12 rounded-xl shadow-sm object-cover" />
                        </motion.div>
                        <div>
                            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-700 to-primary-500 dark:from-primary-400 dark:to-primary-200 tracking-tight">
                                ORCA Lab
                            </h1>
                            <p className="text-xs text-surface-500 dark:text-surface-400 font-medium tracking-wide">Professional ERP</p>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-hide">
                        {filteredNav.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;

                            return (
                                <Link
                                    key={item.href}
                                    to={item.href}
                                    onClick={() => setIsOpen(false)}
                                    className="block relative group"
                                >
                                    {isActive && (
                                        <motion.div
                                            layoutId="activeNav"
                                            className="absolute inset-0 bg-primary-50 dark:bg-primary-500/20 rounded-xl"
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    )}
                                    <div className={clsx(
                                        "relative flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all duration-200",
                                        isActive
                                            ? "text-primary-700 dark:text-primary-300 transform scale-[0.98]"
                                            : "text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-200 hover:bg-surface-50/50 dark:hover:bg-surface-800/50"
                                    )}>
                                        <Icon size={20} className={clsx("transition-colors", isActive && "text-primary-600 dark:text-primary-400")} />
                                        <span className="font-medium">{item.name}</span>
                                    </div>
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Footer */}
                    <div className="p-4 border-t border-surface-200/50 dark:border-surface-700/50 bg-gradient-to-t from-surface-50/50 to-transparent">
                        <div className="flex items-center gap-3 px-4 py-3 bg-white/50 dark:bg-surface-800/50 rounded-2xl mb-3 border border-surface-100 dark:border-surface-700 shadow-sm backdrop-blur-sm">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900 dark:to-primary-800 flex items-center justify-center font-bold text-sm text-primary-700 dark:text-primary-300 uppercase shadow-inner">
                                {(user?.role || 'user').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{user?.name || user?.username}</p>
                                <p className="text-xs text-surface-500 capitalize bg-surface-100 dark:bg-surface-700 px-2 py-0.5 rounded-full inline-block mt-0.5">{user?.role}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => logout()}
                            className={clsx(
                                "w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl transition-all duration-200",
                                "text-surface-500 hover:bg-red-50 hover:text-red-600 dark:text-surface-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 hover:shadow-lg hover:shadow-red-500/10"
                            )}
                        >
                            <LogOut size={18} />
                            <span className="font-medium text-sm">{t.nav.logout}</span>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
