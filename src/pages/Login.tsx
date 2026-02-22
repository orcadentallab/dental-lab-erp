import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Key } from 'lucide-react';

export default function Login() {
    const { login, isAuthenticated, user } = useAuth();
    const navigate = useNavigate();
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (isAuthenticated && user) {
            if (user.role === 'doctor') {
                navigate('/doctor/my-orders', { replace: true });
            } else {
                navigate('/dashboard', { replace: true });
            }
        }
    }, [isAuthenticated, user, navigate]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoggingIn(true);

        const { success, error: loginError } = await login(username, password);

        if (!success) {
            setError(loginError || 'اسم المستخدم أو كلمة المرور غير صحيحة');
            setIsLoggingIn(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4" dir="rtl">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="bg-white px-8 pt-8 pb-4 text-center">
                    <img src="/orca-logo.png" alt="ORCA Dental Lab" className="w-20 h-20 mx-auto mb-4 rounded-xl shadow-lg" />
                    <h1 className="text-2xl font-bold text-blue-900 mb-1 font-sans">ORCA Dental Lab</h1>
                    <p className="text-gray-500 text-sm">نظام إدارة معمل الأسنان</p>
                </div>

                <div className="p-8">
                    <form onSubmit={handleLogin} className="space-y-6">
                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg text-center">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">اسم المستخدم</label>
                            <input
                                type="text"
                                required
                                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="اسم المستخدم أو البريد"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور</label>
                            <input
                                type="password"
                                required
                                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="********"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoggingIn}
                            className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {isLoggingIn ? 'جاري الدخول...' : (
                                <>
                                    <Key size={20} />
                                    <span>تسجيل الدخول</span>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Doctor Registration Link */}

                </div>
            </div>
        </div>
    );
}

