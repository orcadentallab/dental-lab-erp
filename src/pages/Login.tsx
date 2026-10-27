import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Key, Stethoscope, Shield, MessageCircle, ArrowLeft, RefreshCw, CheckCircle2, AlertCircle, Phone, HelpCircle } from 'lucide-react';
import { getLandingRoute } from '../lib/navigation';
import { doctorAuthService } from '../services/auth/doctorAuthService';
import NewDoctorRegistration from '../components/doctors/NewDoctorRegistration';
import DoctorPasswordAccess from '../components/doctors/DoctorPasswordAccess';
import { passwordDoctorAccessEnabled } from '../services/auth/doctorPasswordService';

type LoginTab = 'doctor' | 'staff';

export default function Login() {
    const { login, isAuthenticated, user } = useAuth();
    const navigate = useNavigate();
    const [doctorInvitationToken] = useState(() => new URLSearchParams(window.location.search).get('doctor_invite'));

    // Tab state
    const [activeTab, setActiveTab] = useState<LoginTab>(passwordDoctorAccessEnabled || (import.meta.env.DEV && import.meta.env.VITE_OTP_CHANNEL === 'mock') ? 'doctor' : 'staff');

    // Staff Login State
    const [isStaffLoggingIn, setIsStaffLoggingIn] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [staffError, setStaffError] = useState('');

    // Doctor OTP Login State
    const [phone, setPhone] = useState('');
    const [doctorIntent, setDoctorIntent] = useState<'existing' | 'new'>('existing');
    const [showNewRegistration, setShowNewRegistration] = useState(false);
    const [otpStep, setOtpStep] = useState<'phone' | 'otp'>('phone');
    const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
    const [doctorError, setDoctorError] = useState('');
    const [doctorSuccessMessage, setDoctorSuccessMessage] = useState('');
    const [devOtpCode, setDevOtpCode] = useState<string | null>(null);
    const [countdown, setCountdown] = useState(0);

    // Doctor Code Claim Modal State
    const [showCodeClaimModal, setShowCodeClaimModal] = useState(false);
    const [claimDoctorCode, setClaimDoctorCode] = useState('');
    const [claimPhone, setClaimPhone] = useState('');
    const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);
    const [claimStatus, setClaimStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Refs for 6-digit OTP input boxes
    const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (isAuthenticated && user) {
            navigate(getLandingRoute(user), { replace: true });
        }
    }, [isAuthenticated, user, navigate]);

    // Resend countdown timer
    useEffect(() => {
        if (countdown <= 0) return;
        const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    // Focus first OTP digit on step change
    useEffect(() => {
        if (otpStep === 'otp') {
            setTimeout(() => {
                digitRefs.current[0]?.focus();
            }, 100);
        }
    }, [otpStep]);

    // Handle Staff Login
    const handleStaffLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setStaffError('');
        setIsStaffLoggingIn(true);

        const { success, error: loginError } = await login(username, password);

        if (!success) {
            setStaffError(loginError || 'اسم المستخدم أو كلمة المرور غير صحيحة');
            setIsStaffLoggingIn(false);
        }
    };

    // Handle Doctor Request OTP
    const handleRequestOtp = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setDoctorError('');
        setDoctorSuccessMessage('');
        setDevOtpCode(null);

        const cleanPhone = phone.trim();
        if (!cleanPhone) {
            setDoctorError('يرجى إدخال رقم الهاتف المسجل لدى المعمل');
            return;
        }

        setIsSendingOtp(true);
        try {
            const res = await doctorAuthService.requestOtp(cleanPhone);
            if (!res.success) {
                setDoctorError(res.message || 'فشل إرسال رمز التحقق');
                return;
            }

            setOtpDigits(['', '', '', '', '', '']);
            setOtpStep('otp');
            setCountdown(60);
            if (import.meta.env.DEV && res.channel === 'mock' && res.otp_code) {
                setDevOtpCode(res.otp_code);
            }
            setDoctorSuccessMessage(res.channel === 'mock' ? 'رمز اختبار محلي؛ لم يتم إرسال رسالة واتساب.' : 'تم إرسال رمز التحقق');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء إرسال الرمز.';
            setDoctorError(msg);
        } finally {
            setIsSendingOtp(false);
        }
    };

    // Handle OTP Digit Input
    const handleDigitChange = (index: number, value: string) => {
        // Only accept numbers
        const cleanVal = value
            .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
            .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776))
            .replace(/\D/g, '');
        const newDigits = [...otpDigits];

        if (cleanVal.length > 1) {
            // Paste or multi-character input
            const chars = cleanVal.slice(0, 6).split('');
            chars.forEach((c, i) => {
                if (index + i < 6) newDigits[index + i] = c;
            });
            setOtpDigits(newDigits);
            const nextIdx = Math.min(index + chars.length, 5);
            digitRefs.current[nextIdx]?.focus();
            return;
        }

        newDigits[index] = cleanVal;
        setOtpDigits(newDigits);

        if (cleanVal && index < 5) {
            digitRefs.current[index + 1]?.focus();
        }
    };

    const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
            digitRefs.current[index - 1]?.focus();
        }
    };

    // Handle Doctor Verify OTP
    const handleVerifyOtp = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setDoctorError('');
        const fullOtp = otpDigits.join('');

        if (fullOtp.length !== 6) {
            setDoctorError('يرجى إدخال رمز التحقق المكون من 6 أرقام');
            return;
        }

        setIsVerifyingOtp(true);
        try {
            const res = await doctorAuthService.verifyOtpAndLogin(phone, fullOtp);

            if (res.status === 'not_found' && res.success) {
                if (doctorIntent === 'new') {
                    setShowNewRegistration(true);
                    return;
                }
                setClaimPhone(phone);
                setClaimStatus(null);
                setShowCodeClaimModal(true);
                setDoctorSuccessMessage(res.message || 'أدخل كود الطبيب لطلب الربط.');
                return;
            }
            if (!res.success) {
                if (res.status === 'not_found') {
                    setClaimPhone(phone);
                    setShowCodeClaimModal(true);
                    setDoctorError('هذا الرقم غير مسجل. يرجى إدخال كود الطبيب الخاص بك لربطه.');
                    return;
                }
                setDoctorError(res.message || 'فشل التحقق من الرمز');
                return;
            }

            if (res.status === 'auto_linked') {
                // Success: AuthContext onAuthStateChange will detect the Supabase session
                setDoctorSuccessMessage(`مرحباً دكتور ${res.doctor_name || ''}! جاري الدخول...`);
                // Navigating will happen via useEffect(isAuthenticated)
            } else if (res.status === 'pending_approval') {
                setDoctorSuccessMessage('تم التحقق من الرمز بنجاح. طلب ربط رقمك قيد مراجعة الإدارة يمكنك إعادة تسجيل الدخول بعد اعتماد الطلب.');
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'فشل في التحقق من الرمز.';
            setDoctorError(msg);
        } finally {
            setIsVerifyingOtp(false);
        }
    };

    // Auto-fill dev OTP helper
    const handleFillDevOtp = () => {
        if (!devOtpCode || devOtpCode.length !== 6) return;
        setOtpDigits(devOtpCode.split(''));
    };

    // Handle Doctor Code Claim Submit
    const handleClaimSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setClaimStatus(null);
        if (!claimDoctorCode.trim() || !claimPhone.trim()) {
            setClaimStatus({ type: 'error', message: 'يرجى ملء كود الطبيب ورقم الهاتف' });
            return;
        }

        setIsSubmittingClaim(true);
        try {
            const res = await doctorAuthService.claimDoctorCode(claimPhone, claimDoctorCode);
            if (res.success) {
                setClaimStatus({
                    type: 'success',
                    message: res.message || 'تم تسجيل طلب الربط بنجاح وسيتم اعتماده من المعمل قريباً.'
                });
                setTimeout(() => {
                    setShowCodeClaimModal(false);
                    setClaimStatus(null);
                    setOtpStep('phone');
                }, 3000);
            } else {
                setClaimStatus({ type: 'error', message: res.message });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء إرسال طلب الربط.';
            setClaimStatus({ type: 'error', message: msg });
        } finally {
            setIsSubmittingClaim(false);
        }
    };

    const labWhatsAppNumber = import.meta.env.VITE_LAB_WHATSAPP_NUMBER || '201000000000';
    const whatsappHelpUrl = `https://wa.me/${labWhatsAppNumber}?text=${encodeURIComponent('مرحباً معمل ORCA، أحتاج مساعدة في تسجيل الدخول لبوابة الأطباء.')}`;

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden" dir="rtl">
            {/* Background decorative glow effects */}
            <div className="absolute top-1/4 -right-20 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-1/4 -left-20 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden relative z-10">
                {/* Header with Logo */}
                <div className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-850 dark:to-slate-900 px-8 pt-8 pb-4 text-center border-b border-slate-100 dark:border-slate-800">
                    <img
                        src="/orca-logo.png"
                        alt="ORCA Dental Lab"
                        className="w-16 h-16 mx-auto mb-3 rounded-2xl shadow-md border border-slate-100 dark:border-slate-700 object-cover"
                    />
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight font-sans">ORCA Dental Lab</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-xs font-medium mt-1">نظام إدارة معمل الأسنان الذكي</p>

                    {/* Login Tabs Switcher */}
                    <div className="mt-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => {
                                setActiveTab('doctor');
                                setDoctorError('');
                                setDoctorSuccessMessage('');
                            }}
                            className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                                activeTab === 'doctor'
                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Stethoscope size={16} />
                            <span>{passwordDoctorAccessEnabled ? 'بوابة الأطباء' : 'بوابة الأطباء (WhatsApp)'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setActiveTab('staff');
                                setStaffError('');
                            }}
                            className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                                activeTab === 'staff'
                                    ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-md'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Shield size={16} />
                            <span>طاقم العمل</span>
                        </button>
                    </div>
                </div>

                <div className="p-6 sm:p-8">
                    {/* TAB 1: DOCTOR WHATSAPP OTP LOGIN */}
                    {activeTab === 'doctor' && passwordDoctorAccessEnabled && <DoctorPasswordAccess invitationToken={doctorInvitationToken} />}
                    {activeTab === 'doctor' && !passwordDoctorAccessEnabled && (
                        <div className="space-y-5">
                            {doctorError && (
                                <div className="p-3.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-semibold rounded-xl border border-red-200 dark:border-red-900/50 flex items-start gap-2">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                    <span>{doctorError}</span>
                                </div>
                            )}

                            {doctorSuccessMessage && (
                                <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex items-start gap-2">
                                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                                    <span>{doctorSuccessMessage}</span>
                                </div>
                            )}

                            {/* Dev OTP Helper Banner */}
                            {devOtpCode && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
                                    <span>وضع الاختبار: رمز الدخول هو <strong>{devOtpCode}</strong></span>
                                    <button
                                        type="button"
                                        onClick={handleFillDevOtp}
                                        className="px-2 py-1 bg-amber-200/60 dark:bg-amber-800/60 rounded-lg font-bold hover:bg-amber-300/60 transition-colors"
                                    >
                                        ملء تلقائي
                                    </button>
                                </div>
                            )}

                            {otpStep === 'phone' ? (
                                <form onSubmit={handleRequestOtp} className="space-y-4">
                                    <fieldset className="space-y-2">
                                        <legend className="font-bold text-sm mb-2">هل تعاملت مع معمل ORCA قبل كده؟</legend>
                                        <label className="flex gap-2 text-sm"><input type="radio" name="doctorIntent" checked={doctorIntent === 'existing'} onChange={() => setDoctorIntent('existing')} />نعم، أريد الدخول وربط حسابي الموجود</label>
                                        <label className="flex gap-2 text-sm"><input type="radio" name="doctorIntent" checked={doctorIntent === 'new'} onChange={() => setDoctorIntent('new')} />لا، أول تعامل — تسجيل طبيب جديد</label>
                                        <p className="text-xs text-slate-500">{doctorIntent === 'new' ? 'نتحقق من رقمك أولًا، ثم تسجل بيانات العيادة والمركز والفروع.' : 'اكتب رقمك المسجل عندنا؛ لو تغير الرقم يمكنك طلب الربط بكود الطبيب بعد التحقق.'}</p>
                                    </fieldset>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                                            رقم الهاتف المسجل بالمعمل
                                        </label>
                                        <div className="relative flex items-center">
                                            <input
                                                type="tel"
                                                dir="ltr"
                                                required
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                placeholder="01012345678"
                                                className="w-full pl-4 pr-12 py-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-800 outline-none text-left font-mono text-base transition-all dark:text-white"
                                            />
                                            <span className="absolute right-3.5 text-slate-400">
                                                <Phone size={18} />
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                                            سنرسل رمز تحقق سريع (OTP) مكوناً من 6 أرقام إلى واتساب الخاص بك.
                                        </p>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isSendingOtp}
                                        className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
                                    >
                                        {isSendingOtp ? (
                                            <>
                                                <RefreshCw size={18} className="animate-spin" />
                                                <span>جاري إرسال الرمز...</span>
                                            </>
                                        ) : (
                                            <>
                                                <MessageCircle size={18} />
                                                <span>دخول عبر رمز واتساب</span>
                                            </>
                                        )}
                                    </button>

                                    {/* Action Links */}
                                    <div className="pt-2 flex flex-col items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setClaimPhone(phone);
                                                setShowCodeClaimModal(true);
                                            }}
                                            className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1"
                                        >
                                            <HelpCircle size={14} />
                                            <span>هل لديك كود طبيب وتريد ربط رقمك؟</span>
                                        </button>

                                        <a
                                            href={whatsappHelpUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1 transition-colors"
                                        >
                                            <MessageCircle size={13} className="text-emerald-500" />
                                            <span>تواصل مع دعم المعمل إذا واجهت مشكلة</span>
                                        </a>
                                    </div>
                                </form>
                            ) : (
                                <form onSubmit={handleVerifyOtp} className="space-y-5">
                                    <div className="text-center">
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">تم إرسال رمز التحقق إلى الرقم:</p>
                                        <div className="inline-flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-xs font-mono font-bold text-slate-700 dark:text-slate-300" dir="ltr">
                                            <span>{phone}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setOtpStep('phone');
                                                    setOtpDigits(['', '', '', '', '', '']);
                                                    setDoctorError('');
                                                }}
                                                className="text-blue-600 dark:text-blue-400 text-[11px] hover:underline"
                                            >
                                                تعديل
                                            </button>
                                        </div>
                                    </div>

                                    {/* 6 Digit Input Boxes */}
                                    <div className="flex justify-center gap-2 sm:gap-2.5" dir="ltr">
                                        {otpDigits.map((digit, idx) => (
                                            <input
                                                key={idx}
                                                ref={(el) => { digitRefs.current[idx] = el; }}
                                                type="text"
                                                inputMode="numeric"
                                                aria-label={`الرقم ${idx + 1} من رمز التحقق`}
                                                autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                                                maxLength={1}
                                                value={digit}
                                                onChange={(e) => handleDigitChange(idx, e.target.value)}
                                                onPaste={(e) => {
                                                    e.preventDefault();
                                                    handleDigitChange(idx, e.clipboardData.getData('text'));
                                                }}
                                                onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                                                className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold font-mono bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-blue-600 focus:bg-white dark:focus:bg-slate-900 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all dark:text-white"
                                            />
                                        ))}
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isVerifyingOtp || otpDigits.join('').length !== 6}
                                        className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
                                    >
                                        {isVerifyingOtp ? (
                                            <>
                                                <RefreshCw size={18} className="animate-spin" />
                                                <span>جاري التحقق والدخول...</span>
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 size={18} />
                                                <span>تأكيد الدخول</span>
                                            </>
                                        )}
                                    </button>

                                    <div className="flex items-center justify-between text-xs pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setOtpStep('phone')}
                                            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white flex items-center gap-1"
                                        >
                                            <ArrowLeft size={14} className="rotate-180" />
                                            <span>الرجوع</span>
                                        </button>

                                        <button
                                            type="button"
                                            disabled={countdown > 0 || isSendingOtp}
                                            onClick={() => handleRequestOtp()}
                                            className="text-blue-600 dark:text-blue-400 font-bold hover:underline disabled:opacity-40 disabled:no-underline"
                                        >
                                            {countdown > 0 ? `إعادة الإرسال بعد (${countdown} ث)` : 'إعادة إرسال الرمز'}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}

                    {/* TAB 2: STAFF LOGIN */}
                    {activeTab === 'staff' && (
                        <form onSubmit={handleStaffLogin} className="space-y-4">
                            {staffError && (
                                <div className="p-3.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-semibold rounded-xl border border-red-200 dark:border-red-900/50 flex items-start gap-2">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                    <span>{staffError}</span>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">اسم المستخدم</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white text-sm"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="اسم المستخدم أو البريد الإلكتروني"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">كلمة المرور</label>
                                <input
                                    type="password"
                                    required
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white text-sm"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isStaffLoggingIn}
                                className="w-full py-3.5 bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors shadow-md disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer mt-2"
                            >
                                {isStaffLoggingIn ? (
                                    <>
                                        <RefreshCw size={18} className="animate-spin" />
                                        <span>جاري التحقق...</span>
                                    </>
                                ) : (
                                    <>
                                        <Key size={18} />
                                        <span>تسجيل دخول طاقم العمل</span>
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>

            {showNewRegistration && <NewDoctorRegistration phone={phone} onClose={() => setShowNewRegistration(false)} />}
            {/* DOCTOR CODE CLAIM MODAL */}
            {showCodeClaimModal && (
                <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 relative">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
                            <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                                <Stethoscope size={18} className="text-blue-600" />
                                <span>طلب ربط حساب طبيب مسجل</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowCodeClaimModal(false)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold"
                            >
                                &times;
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                            إذا كنت مسجلاً بالفعل لدى معمل ORCA ولكن رقم هاتفك الحالي لم يتم تحديثه في النظام، أدخل كود الطبيب الخاص بك ورقم هاتفك بعد التحقق من الهاتف واعتماد الإدارة يمكنك الدخول برمز تحقق جديد.
                        </p>

                        {claimStatus && (
                            <div className={`p-3 rounded-xl text-xs font-semibold mb-4 ${
                                claimStatus.type === 'success'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                    : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800'
                            }`}>
                                {claimStatus.message}
                            </div>
                        )}

                        <form onSubmit={handleClaimSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                                    كود الطبيب لدى المعمل
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="مثال: DOC-102 أو 102"
                                    value={claimDoctorCode}
                                    onChange={(e) => setClaimDoctorCode(e.target.value)}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono dark:text-white"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                                    رقم الهاتف / الواتساب
                                </label>
                                <input
                                    type="tel"
                                    required
                                    placeholder="01012345678"
                                    value={claimPhone}
                                    onChange={(e) => setClaimPhone(e.target.value)}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono text-left dark:text-white"
                                    dir="ltr"
                                />
                            </div>

                            <div className="flex gap-2 pt-2">
                                <button
                                    type="submit"
                                    disabled={isSubmittingClaim}
                                    className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 text-xs shadow-md"
                                >
                                    {isSubmittingClaim ? 'جاري الإرسال...' : 'إرسال طلب الاعتماد'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowCodeClaimModal(false)}
                                    className="px-4 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
