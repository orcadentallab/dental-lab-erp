import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../translations';
import { LayoutDashboard, ShoppingBag, Users, DollarSign, LogOut, Menu, X, Factory, FileText, Shield, Settings, BarChart3, Award, Briefcase, Brain, Plus, ChevronDown, Megaphone, Layers, Receipt, Clock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { db } from '../services/db';
import { getUserRoleDisplay, isDesignerUser } from '../lib/userRoles';

import type { LucideIcon } from 'lucide-react';

interface NavItem {
    name: string;
    href: string;
    icon: LucideIcon;
    roles: string[];
}

interface NavGroup {
    id: string;
    label: string;
    icon: LucideIcon;
    items: NavItem[];
    defaultOpen?: boolean;
}

export default function Sidebar() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const { t } = useTranslation();
    const [unregisteredCount, setUnregisteredCount] = useState(0);

    useEffect(() => {
        if (user?.role === 'admin' || user?.role === 'accountant') {
            const checkUnregistered = async () => {
                try {
                    const response = await db.getOrders();
                    const allOrders = Array.isArray(response) ? response : [];
                    const statuses = ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Rejected'];
                    const unreg = allOrders.filter((o) => !o.isRegistered && statuses.includes(o.status));
                    setUnregisteredCount(unreg.length);
                } catch (error) {
                    console.error('Failed to fetch unregistered orders', error);
                }
            };
            checkUnregistered();
        }
    }, [user?.role]);

    const navGroups: NavGroup[] = [
        {
            id: 'main',
            label: 'الرئيسية',
            icon: LayoutDashboard,
            defaultOpen: true,
            items: [
                { name: t.nav.dashboard, href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'lab', 'representative', 'accountant', 'designer'] },
                { name: t.nav.orders, href: '/orders', icon: ShoppingBag, roles: ['admin', 'lab', 'representative', 'accountant', 'designer'] },
            ]
        },
        {
            id: 'accounts',
            label: 'الحسابات',
            icon: DollarSign,
            defaultOpen: true,
            items: [
                { name: t.nav.finance, href: '/finance', icon: DollarSign, roles: ['admin', 'accountant'] },
                { name: t.nav.accounts, href: '/accounts', icon: FileText, roles: ['admin', 'accountant', 'lab', 'designer', 'representative'] },
                { name: 'الفواتير', href: '/statements', icon: Receipt, roles: ['admin', 'accountant'] },
                { name: 'أعمار الديون', href: '/aging-report', icon: Clock, roles: ['admin', 'accountant'] },
                { name: t.nav.caseRegistration, href: '/case-registration', icon: FileText, roles: ['admin', 'accountant'] },
            ]
        },
        {
            id: 'reports',
            label: 'التقارير',
            icon: BarChart3,
            defaultOpen: false,
            items: [
                { name: t.nav.analytics, href: '/analytics', icon: BarChart3, roles: ['admin'] },
                { name: 'تقرير المشكلات', href: '/issues-report', icon: BarChart3, roles: ['admin'] },
                { name: 'إحصائيات المصممين', href: '/designer-stats', icon: BarChart3, roles: ['admin'] },
                { name: 'التحليلات الذكية', href: '/ai-analytics', icon: Brain, roles: ['admin'] },
                { name: 'تحليلات التسويق', href: '/marketing-analytics', icon: Megaphone, roles: ['admin'] },
            ]
        },
        {
            id: 'management',
            label: 'الإدارة',
            icon: Settings,
            defaultOpen: false,
            items: [
                { name: t.nav.doctors, href: '/doctors', icon: Users, roles: ['admin', 'representative'] },
                { name: t.nav.suppliers, href: '/suppliers', icon: Factory, roles: ['admin', 'accountant'] },
                { name: t.nav.staff, href: '/staff', icon: Briefcase, roles: ['admin', 'accountant', 'representative'] },
                { name: 'الخدمات وأسعارها', href: '/services', icon: Layers, roles: ['admin'] },
                { name: t.nav.quality, href: '/quality', icon: Award, roles: ['admin', 'representative'] },
                { name: t.nav.users, href: '/users', icon: Shield, roles: ['admin'] },
                { name: t.nav.settings, href: '/settings', icon: Settings, roles: ['admin', 'lab', 'representative', 'accountant'] },
            ]
        },
        {
            id: 'doctor_portal',
            label: 'بوابة الطبيب',
            icon: Plus,
            defaultOpen: true,
            items: [
                { name: 'طلب جديد', href: '/doctor/new-request', icon: Plus, roles: ['doctor'] },
                { name: 'أوردراتي', href: '/doctor/my-orders', icon: ShoppingBag, roles: ['doctor'] },
                { name: 'حسابي', href: '/doctor/account', icon: DollarSign, roles: ['doctor'] },
            ]
        }
    ];

    const filteredGroups = navGroups
        .map(group => ({
            ...group,
            items: group.items.filter(item => user && (item.roles.includes(user.role) || (item.roles.includes('designer') && isDesignerUser(user))))
        }))
        .filter(group => group.items.length > 0);

    // Initialize open groups: default-open groups + group containing active route
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        navGroups.forEach(g => {
            if (g.defaultOpen) initial[g.id] = true;
        });
        return initial;
    });

    useEffect(() => {
        const activeGroup = filteredGroups.find(g =>
            g.items.some(item => item.href === location.pathname)
        );
        if (activeGroup) {
            setOpenGroups(prev => ({ ...prev, [activeGroup.id]: true }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    const toggleGroup = (groupId: string) => {
        setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="md:hidden fixed top-4 right-4 z-50 p-2.5 bg-cyan-600/90 backdrop-blur-md border border-cyan-500/50 rounded-xl shadow-lg text-white print:hidden hover:bg-cyan-700 transition-colors"
            >
                {isOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* Overlay */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-teal-900/40 z-40 md:hidden print:hidden backdrop-blur-sm"
                        onClick={() => setIsOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <div className={clsx(
                "fixed inset-y-0 right-0 w-[280px] bg-gradient-to-b from-teal-50 via-white to-teal-50/50 border-l border-teal-100 shadow-2xl md:shadow-xl md:shadow-teal-100/50 transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:h-screen print:hidden",
                isOpen ? "translate-x-0 z-[60]" : "translate-x-full z-40"
            )}>
                <div className="flex flex-col h-full">

                    {/* Header / Logo */}
                    <div className="px-6 py-6 border-b border-teal-100/80 bg-white/50 backdrop-blur-sm">
                        <div className="flex items-center gap-4">
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.4, ease: "easeOut" }}
                                className="relative flex-shrink-0"
                            >
                                <div className="absolute -inset-2 bg-cyan-400/20 blur-lg rounded-full"></div>
                                <img src="/orca-logo.png" alt="ORCA Dental Lab" className="relative w-11 h-11 rounded-xl shadow-md shadow-cyan-900/5 object-cover ring-1 ring-cyan-100" />
                            </motion.div>
                            <div className="min-w-0">
                                <h1 className="text-[16px] font-bold text-teal-900 tracking-tight leading-tight">
                                    ORCA Lab
                                </h1>
                                <p className="text-[11px] text-cyan-600 font-medium tracking-wide uppercase">Dental ERP v1.3</p>
                            </div>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-4 overflow-y-auto sidebar-scroll space-y-1">
                        {filteredGroups.map((group) => {
                            const isGroupOpen = openGroups[group.id] ?? false;
                            const hasActiveItem = group.items.some(item => location.pathname === item.href);
                            const GroupIcon = group.icon;

                            return (
                                <div key={group.id} className="mb-1">
                                    {/* Group Header */}
                                    <button
                                        onClick={() => toggleGroup(group.id)}
                                        className={clsx(
                                            "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-200 group cursor-pointer border border-transparent",
                                            hasActiveItem && !isGroupOpen
                                                ? "bg-white shadow-sm border-teal-100"
                                                : "hover:bg-teal-50/80"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={clsx(
                                                "p-1.5 rounded-lg transition-colors",
                                                hasActiveItem ? "bg-cyan-50 text-cyan-600" : "bg-transparent text-teal-400 group-hover:text-cyan-600 group-hover:bg-cyan-50/50"
                                            )}>
                                                <GroupIcon size={16} />
                                            </div>
                                            <span className={clsx(
                                                "text-[12px] font-semibold tracking-wide transition-colors",
                                                hasActiveItem
                                                    ? "text-teal-900"
                                                    : "text-slate-500 group-hover:text-teal-800"
                                            )}>
                                                {group.label}
                                            </span>
                                        </div>
                                        <motion.div
                                            animate={{ rotate: isGroupOpen ? 180 : 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            <ChevronDown size={14} className={clsx(
                                                "transition-colors",
                                                hasActiveItem
                                                    ? "text-cyan-600"
                                                    : "text-slate-300 group-hover:text-cyan-500"
                                            )} />
                                        </motion.div>
                                    </button>

                                    {/* Group Items */}
                                    <AnimatePresence initial={false}>
                                        {isGroupOpen && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2, ease: "easeInOut" }}
                                                className="overflow-hidden"
                                            >
                                                <div className="pt-1 pb-2 pr-4 space-y-1 relative">
                                                    {/* Vertical guide line */}
                                                    <div className="absolute right-[22px] top-0 bottom-2 w-px bg-teal-100/50"></div>

                                                    {group.items.map((item) => {
                                                        const Icon = item.icon;
                                                        const isActive = location.pathname === item.href;

                                                        return (
                                                            <Link
                                                                key={item.href}
                                                                to={item.href}
                                                                onClick={() => setIsOpen(false)}
                                                                className="block relative group/item pl-2"
                                                            >
                                                                {isActive && (
                                                                    <motion.div
                                                                        layoutId="activeNav"
                                                                        className="absolute inset-0 bg-gradient-to-l from-cyan-50 to-transparent rounded-lg border-r-[3px] border-cyan-500 shadow-sm"
                                                                        initial={false}
                                                                        transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                                                    />
                                                                )}
                                                                <div className={clsx(
                                                                    "relative flex items-center justify-between px-3.5 py-2 rounded-lg transition-all duration-200",
                                                                    isActive
                                                                        ? "text-cyan-900"
                                                                        : "text-slate-500 hover:text-cyan-700 hover:bg-slate-50/50"
                                                                )}>
                                                                    <div className="flex items-center gap-3">
                                                                        <Icon size={16} className={clsx(
                                                                            "transition-colors flex-shrink-0",
                                                                            isActive ? "text-cyan-600" : "text-slate-400 group-hover/item:text-cyan-500"
                                                                        )} />
                                                                        <span className={clsx(
                                                                            "text-[13px]",
                                                                            isActive ? "font-semibold" : "font-medium"
                                                                        )}>{item.name}</span>
                                                                    </div>
                                                                    {item.href === '/case-registration' && unregisteredCount > 0 && (
                                                                        <span className="flex h-5 min-w-[20px] px-1.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm shadow-red-500/30 animate-pulse">
                                                                            {unregisteredCount}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })}
                    </nav>

                    {/* Footer */}
                    <div className="p-4 border-t border-teal-100 bg-white/30">
                        {/* User Card */}
                        <div className="group flex items-center gap-3.5 px-3.5 py-3 bg-white rounded-2xl mb-3 border border-teal-100 shadow-sm hover:shadow-md hover:border-cyan-200 transition-all duration-300">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center font-bold text-xs text-white uppercase shadow-lg shadow-cyan-500/20 ring-2 ring-white flex-shrink-0 group-hover:scale-105 transition-transform">
                                {(user?.role || 'U').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate group-hover:text-cyan-800 transition-colors">{user?.name || user?.username}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <p className="text-[11px] text-slate-500 capitalize font-medium">{getUserRoleDisplay(user)}</p>
                                </div>
                            </div>
                        </div>
                        {/* Logout */}
                        <button
                            onClick={() => logout()}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl transition-all duration-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:shadow-sm border border-transparent hover:border-red-100 cursor-pointer group"
                        >
                            <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
                            <span className="font-semibold text-xs">{t.nav.logout}</span>
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

/* aria-label placeholder */
