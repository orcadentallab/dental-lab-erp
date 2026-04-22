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

    return <Outlet />;
}
