import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

export default function DashboardLayout() {
    return (
        <div className="flex h-screen bg-surface-50 dark:bg-surface-950 overflow-hidden font-sans selection:bg-primary-500/30 selection:text-primary-900">
            {/* Ambient Background */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary-200/30 dark:bg-primary-900/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-overlay animate-pulse-slow" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-blue-200/30 dark:bg-blue-900/10 rounded-full blur-[100px] mix-blend-multiply dark:mix-blend-overlay animate-pulse-slow" style={{ animationDelay: '1s' }} />
            </div>

            <div className="relative z-10 flex w-full h-full">
                <Sidebar />
                <div className="flex-1 flex flex-col overflow-hidden">
                    <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-8 pt-20 md:pt-8 scrollbar-thin scrollbar-thumb-surface-300 dark:scrollbar-thumb-surface-700">
                        <div className="max-w-7xl mx-auto space-y-6">
                            <Outlet />
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
}
