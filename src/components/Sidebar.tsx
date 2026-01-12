import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, ShoppingBag, Users, DollarSign, LogOut, Menu, X, Factory, FileText, Shield, Settings, BarChart3, Award, Briefcase, Palette } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);

    const navigation = [
        { name: 'لوحة التحكم', href: '/', icon: LayoutDashboard, roles: ['admin', 'lab', 'representative', 'accountant'] },
        { name: 'الاوردرات', href: '/orders', icon: ShoppingBag, roles: ['admin', 'lab', 'representative', 'accountant'] },
        { name: 'الجودة', href: '/quality', icon: Award, roles: ['admin', 'representative', 'lab'] },
        { name: 'الحسابات', href: '/accounts', icon: FileText, roles: ['admin', 'accountant', 'lab'] },
        { name: 'المالية', href: '/finance', icon: DollarSign, roles: ['admin', 'accountant'] },
        { name: 'التحليلات', href: '/analytics', icon: BarChart3, roles: ['admin'] },
        { name: 'الأطباء', href: '/doctors', icon: Users, roles: ['admin', 'representative'] },
        { name: 'الموردين', href: '/suppliers', icon: Factory, roles: ['admin', 'accountant'] },
        { name: 'شؤون الموظفين', href: '/staff', icon: Briefcase, roles: ['admin', 'accountant', 'representative'] },
        { name: 'المستخدمين', href: '/users', icon: Shield, roles: ['admin'] },
        { name: 'التصميم', href: '/designer', icon: Palette, roles: ['admin', 'designer'] },
        { name: 'الإعدادات', href: '/settings', icon: Settings, roles: ['admin', 'lab', 'representative', 'accountant'] },
    ];

    const filteredNav = navigation.filter(item => user && item.roles.includes(user.role));

    return (
        <>
            {/* Mobile Menu Button - Hidden in Print */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="md:hidden fixed top-4 right-4 z-50 p-2 bg-white rounded-lg shadow-lg text-gray-600 print:hidden"
            >
                {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden print:hidden"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Sidebar - Hidden in Print */}
            <div className={clsx(
                "fixed inset-y-0 right-0 z-40 w-64 bg-white dark:bg-gray-800 shadow-xl transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:h-screen md:shadow-none print:hidden border-l border-gray-100 dark:border-gray-700",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}>
                <div className="flex flex-col h-full border-l border-gray-100 dark:border-gray-700">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
                        <img src="/orca-logo.png" alt="ORCA Dental Lab" className="w-10 h-10 rounded-lg shadow-sm" />
                        <div>
                            <h1 className="text-xl font-bold text-blue-900 dark:text-blue-400 tracking-tight" style={{ fontFamily: 'sans-serif' }}>ORCA Dental Lab</h1>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Professional Lab Management</p>
                        </div>
                    </div>

                    <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                        {filteredNav.map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    to={item.href}
                                    onClick={() => setIsOpen(false)}
                                    className={clsx(
                                        "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                                        isActive
                                            ? "bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 font-bold"
                                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                                    )}
                                >
                                    <Icon size={20} />
                                    <span>{item.name}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="p-4 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-3 px-4 py-3 text-gray-500 dark:text-gray-400 mb-2">
                            <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center font-bold text-xs uppercase">
                                {(user?.role || 'user').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-200 truncate">{user?.name || user?.username}</p>
                                <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => logout()}
                            className={clsx(
                                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                                "text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                            )}
                        >
                            <LogOut size={20} className="group-hover:scale-110 transition-transform" />
                            <span className="font-medium">تسجيل الخروج</span>
                        </button>
                        <div className="text-center mt-2 text-[10px] text-gray-300 dark:text-gray-700 font-mono">
                            v1.2 (Online)
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
