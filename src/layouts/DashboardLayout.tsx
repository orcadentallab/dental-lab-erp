import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

export default function DashboardLayout() {
    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden transition-colors duration-200">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 dark:bg-gray-900 p-6 pt-14 md:pt-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}

