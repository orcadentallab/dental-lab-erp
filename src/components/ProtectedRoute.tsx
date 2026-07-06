import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isDesignerUser } from '../lib/userRoles';

interface ProtectedRouteProps {
    allowedRoles?: string[];
}

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen">Loading...</div>;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    const matchesAllowedRole = !allowedRoles || !user || allowedRoles.includes(user.role) || (allowedRoles.includes('designer') && isDesignerUser(user));

    if (!matchesAllowedRole) {
        return <div className="p-8 text-center text-red-600">غير مصرح لك بدخول هذه الصفحة</div>;
    }

    // Restrict employee-only ('other') users to their own profile page and settings only
    if (user?.employeeType === 'other' && !['lab', 'designer', 'doctor'].includes(user.role)) {
        const path = window.location.pathname;
        const isSelfProfile = path === `/employees/${user.id}` || path.startsWith(`/employees/${user.id}/`);
        if (!isSelfProfile && path !== '/settings') {
            return <Navigate to={`/employees/${user.id}`} replace />;
        }
    }

    return <Outlet />;
}
