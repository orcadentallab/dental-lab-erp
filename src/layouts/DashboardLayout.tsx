import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

export default function DashboardLayout() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden transition-colors duration-200">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-100 dark:border-gray-700 h-16 flex items-center justify-between px-6 z-10">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">نظام إدارة المعمل</h2>
                    <button
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        title={theme === 'dark' ? 'تحويل للوضع النهاري' : 'تحويل للوضع الليلي'}
                    >
                        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </header>
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
