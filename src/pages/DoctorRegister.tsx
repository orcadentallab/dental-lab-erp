import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createRegistrationRequest } from '../services/supabase/registrationRequests';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { UserPlus, Phone, MapPin, Mail, Building2, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

export default function DoctorRegister() {
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        phone2: '',
        address: '',
        email: '',
        clinicName: '',
    });
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Validation
        if (!formData.name.trim()) {
            setError('يرجى إدخال الاسم');
            return;
        }
        if (!formData.phone.trim() || formData.phone.length < 10) {
            setError('يرجى إدخال رقم الهاتف صحيح');
            return;
        }
        if (!formData.email.trim() || !formData.email.includes('@')) {
            setError('يرجى إدخال البريد الإلكتروني صحيح');
            return;
        }
        if (!formData.address.trim()) {
            setError('يرجى إدخال العنوان');
            return;
        }

        setLoading(true);
        try {
            await createRegistrationRequest({
                name: formData.name,
                phone: formData.phone,
                phone2: formData.phone2 || undefined,
                address: formData.address,
                email: formData.email,
                clinicName: formData.clinicName || undefined,
            });
            setSuccess(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'حدث خطأ، يرجى المحاولة مرة أخرى');
        } finally {
            setLoading(false);
        }
    };

    // Success State
    if (success) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4" dir="rtl">
                <div className="max-w-md w-full text-center">
                    <div className="bg-white rounded-3xl shadow-2xl shadow-green-500/10 p-8 border border-green-100">
                        <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/30">
                            <CheckCircle2 size={40} className="text-white" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800 mb-3">
                            تم استلام طلبكم بنجاح!
                        </h2>
                        <p className="text-gray-500 mb-6 leading-relaxed">
                            شكراً لتسجيلكم معنا. سيقوم فريقنا بمراجعة طلبكم والتواصل معكم خلال 24 ساعة.
                        </p>
                        <div className="bg-blue-50 rounded-xl p-4 mb-6 border border-blue-100">
                            <p className="text-sm text-blue-700">
                                <strong>📧 تنبيه:</strong> ستصلكم رسالة على البريد الإلكتروني لإعداد كلمة المرور بمجرد الموافقة على طلبكم.
                            </p>
                        </div>
                        <Link
                            to="/login"
                            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-bold transition-colors"
                        >
                            <ArrowRight size={18} />
                            العودة لصفحة الدخول
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50" dir="rtl">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white">
                <div className="max-w-4xl mx-auto px-4 py-12 text-center">
                    <img
                        src="/orca-logo.png"
                        alt="ORCA Dental Lab"
                        className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg shadow-black/20 bg-white p-2"
                    />
                    <h1 className="text-3xl font-bold mb-2">
                        مرحباً بك في ORCA Dental Lab
                    </h1>
                    <p className="text-blue-100 text-lg">
                        سجّل الآن وانضم لشبكة عملائنا المميزين
                    </p>
                </div>
                {/* Wave */}
                <svg className="w-full h-16 -mb-1" viewBox="0 0 1440 100" fill="none" preserveAspectRatio="none">
                    <path d="M0,50 C360,100 1080,0 1440,50 L1440,100 L0,100 Z" fill="white" fillOpacity="0.1" />
                    <path d="M0,70 C360,120 1080,20 1440,70 L1440,100 L0,100 Z" className="fill-blue-50" />
                </svg>
            </div>

            {/* Form */}
            <div className="max-w-2xl mx-auto px-4 -mt-4 pb-12">
                <div className="bg-white rounded-3xl shadow-2xl shadow-blue-500/10 p-8 border border-gray-100">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <UserPlus size={24} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">تسجيل طبيب جديد</h2>
                            <p className="text-sm text-gray-500">أكمل البيانات وسنتواصل معك قريباً</p>
                        </div>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Name */}
                            <div className="md:col-span-2">
                                <Input
                                    label="الاسم الكامل"
                                    required
                                    value={formData.name}
                                    onChange={e => handleChange('name', e.target.value)}
                                    placeholder="د. أحمد محمد"
                                    icon={<UserPlus size={18} className="text-gray-400" />}
                                />
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Phone size={16} className="text-blue-500" />
                                    رقم الهاتف
                                    <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="tel"
                                    required
                                    value={formData.phone}
                                    onChange={e => handleChange('phone', e.target.value)}
                                    placeholder="01xxxxxxxxx"
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-left ltr font-mono"
                                    dir="ltr"
                                />
                            </div>

                            {/* Phone 2 */}
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Phone size={16} className="text-gray-400" />
                                    رقم هاتف إضافي
                                </label>
                                <input
                                    type="tel"
                                    value={formData.phone2}
                                    onChange={e => handleChange('phone2', e.target.value)}
                                    placeholder="اختياري"
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-left ltr font-mono"
                                    dir="ltr"
                                />
                            </div>

                            {/* Email */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Mail size={16} className="text-blue-500" />
                                    البريد الإلكتروني
                                    <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={formData.email}
                                    onChange={e => handleChange('email', e.target.value)}
                                    placeholder="doctor@example.com"
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-left ltr"
                                    dir="ltr"
                                />
                            </div>

                            {/* Clinic Name */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Building2 size={16} className="text-gray-400" />
                                    اسم العيادة / المركز
                                </label>
                                <input
                                    type="text"
                                    value={formData.clinicName}
                                    onChange={e => handleChange('clinicName', e.target.value)}
                                    placeholder="اختياري"
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                                />
                            </div>

                            {/* Address */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <MapPin size={16} className="text-blue-500" />
                                    العنوان
                                    <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    required
                                    value={formData.address}
                                    onChange={e => handleChange('address', e.target.value)}
                                    placeholder="العنوان التفصيلي للعيادة..."
                                    rows={2}
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                                />
                            </div>
                        </div>

                        {/* Submit */}
                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 text-lg bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={22} className="animate-spin" />
                                    جاري الإرسال...
                                </>
                            ) : (
                                <>
                                    <UserPlus size={22} />
                                    إرسال طلب التسجيل
                                </>
                            )}
                        </Button>
                    </form>

                    {/* Back to Login */}
                    <div className="mt-6 text-center">
                        <p className="text-gray-500 text-sm">
                            لديك حساب بالفعل؟{' '}
                            <Link to="/login" className="text-blue-600 font-bold hover:text-blue-700 transition-colors">
                                تسجيل الدخول
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Features */}
                <div className="grid grid-cols-3 gap-4 mt-8">
                    {[
                        { icon: '⚡', title: 'سرعة التنفيذ', desc: 'أسرع وقت تسليم' },
                        { icon: '💎', title: 'جودة عالية', desc: 'أفضل الخامات' },
                        { icon: '🛡️', title: 'ضمان شامل', desc: 'على كل الأعمال' },
                    ].map((feature, i) => (
                        <div key={i} className="bg-white/80 backdrop-blur rounded-2xl p-4 text-center border border-gray-100 shadow-sm">
                            <div className="text-3xl mb-2">{feature.icon}</div>
                            <div className="font-bold text-gray-800 text-sm">{feature.title}</div>
                            <div className="text-xs text-gray-500">{feature.desc}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
