/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState } from 'react';
import { db } from '../services/db';
import { Download, Upload, AlertCircle, CheckCircle, FileSpreadsheet, Cloud, Lock, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { importDoctorsFromExcel, importServicesFromExcel, importOrdersFromExcel, importTransactionsFromExcel } from '../lib/excelImporter';

export default function Settings() {
    const { user } = useAuth();
    const [importStatus, setImportStatus] = useState<{ success?: boolean; message?: string } | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const isAdmin = user?.role === 'admin';
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    const handlePasswordChange = async () => {
        if (!oldPassword) {
            setImportStatus({ success: false, message: 'يرجى إدخال كلمة المرور الحالية' });
            return;
        }
        if (newPassword.length < 8) {
            setImportStatus({ success: false, message: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setImportStatus({ success: false, message: 'كلمتا المرور غير متطابقتين' });
            return;
        }

        setIsChangingPassword(true);
        try {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            if (!currentUser?.email) throw new Error('لم يتم العثور على المستخدم');

            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: oldPassword
            });

            if (signInError) {
                setImportStatus({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
                setIsChangingPassword(false);
                return;
            }

            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;

            setImportStatus({ success: true, message: 'تم تغيير كلمة المرور بنجاح!' });
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (error: unknown) {
            setImportStatus({ success: false, message: `فشل تغيير كلمة المرور: ${error instanceof Error ? error.message : 'خطأ غير معروف'}` });
        } finally {
            setIsChangingPassword(false);
        }
    };

    const handleExport = () => {
        const data = db.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `orca_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target?.result as string;
            setImportStatus({ success: true, message: 'جاري استيراد البيانات...' });

            try {
                const result = await db.importData(content);
                if (result.success) {
                    setImportStatus({ success: true, message: 'تم استرجاع البيانات بنجاح!' });
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    setImportStatus({ success: false, message: `فشل الاسترجاع: ${result.error}` });
                }
            } catch (err: unknown) {
                setImportStatus({ success: false, message: `حدث خطأ: ${err instanceof Error ? err.message : 'غير معروف'}` });
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-gray-100 rounded-lg">
                    <SettingsIcon size={24} className="text-gray-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-800">الإعدادات</h1>
                    <p className="text-sm text-gray-500">النسخ الاحتياطي وإدارة الحساب</p>
                </div>
            </div>

            {/* Status Messages */}
            {importStatus && (
                <div className={`p-4 rounded-xl border flex flex-col gap-3 transition-all ${importStatus.success ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                    <div className="flex items-start gap-3">
                        {importStatus.success ? <CheckCircle size={20} className="mt-0.5 text-green-600" /> : <AlertCircle size={20} className="mt-0.5 text-red-600" />}
                        <div className="flex-1">
                            <h4 className="font-bold text-sm mb-1">{importStatus.success ? 'نجاح العملية' : 'حدث خطأ أثناء العملية'}</h4>
                            <p className="text-sm opacity-90 leading-relaxed whitespace-pre-line">{importStatus.message}</p>
                        </div>
                    </div>
                    {!importStatus.success && importStatus.message?.includes('\n') && (
                        <div className="mt-1 p-3 bg-white/50 rounded-lg border border-red-100 max-h-40 overflow-y-auto text-xs font-mono">
                            {importStatus.message}
                        </div>
                    )}
                </div>
            )}

            {/* Backup Section - Admin Only */}
            {isAdmin && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <Cloud size={18} className="text-blue-500" />
                            إدارة البيانات والنسخ الاحتياطي
                        </h2>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Export */}
                        <button
                            onClick={handleExport}
                            className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all text-right group"
                        >
                            <div className="p-2.5 bg-blue-100 text-blue-600 rounded-lg group-hover:scale-110 transition-transform">
                                <Download size={22} />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-800">حفظ نسخة احتياطية</h3>
                                <p className="text-xs text-gray-500">تحميل ملف JSON للبيانات الحالية</p>
                            </div>
                        </button>

                        {/* Import */}
                        <div className="relative group">
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleImport}
                                aria-label="استيراد نسخة احتياطية"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <div className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-amber-400 hover:bg-amber-50 transition-all text-right group-hover:bg-amber-50">
                                <div className="p-2.5 bg-amber-100 text-amber-600 rounded-lg group-hover:scale-110 transition-transform">
                                    <Upload size={22} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800">استرجاع البيانات</h3>
                                    <p className="text-xs text-gray-500">رفع ملف JSON محفوظ سابقاً</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Password Change Section */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                    <h2 className="font-bold text-gray-800 flex items-center gap-2">
                        <Lock size={18} className="text-indigo-500" />
                        تغيير كلمة المرور
                    </h2>
                </div>
                <div className="p-4 space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-600 px-1">كلمة المرور الحالية</label>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-600 px-1">كلمة المرور الجديدة</label>
                            <input
                                type="password"
                                placeholder="••••••••"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-600 px-1">تأكيد كلمة المرور</label>
                            <input
                                type="password"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handlePasswordChange}
                        disabled={isChangingPassword || !oldPassword || !newPassword || !confirmPassword}
                        className="w-full md:w-auto px-6 py-2.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md active:scale-95"
                    >
                        {isChangingPassword ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
                    </button>
                </div>
            </div>

            {/* Data Correction Section - Admin Only */}
            {isAdmin && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <SettingsIcon size={18} className="text-orange-500" />
                            أدوات إصلاح البيانات
                        </h2>
                    </div>
                    <div className="p-4">
                        <div className="flex items-center justify-between p-4 bg-orange-50 rounded-xl border border-orange-100">
                            <div>
                                <h3 className="font-bold text-orange-900 mb-1">تحديث أسعار الأوردرات الصفرية</h3>
                                <p className="text-xs text-orange-700">
                                    أوردرات اليوم فقط. سيتم البحث عن السعر بناءً على اسم الخدمة.
                                </p>
                            </div>
                            <button
                                onClick={async () => {
                                    if (!window.confirm('هل أنت متأكد؟ سيتم تحديث أسعار الأوردرات الصفرية المسجلة اليوم فقط.')) return;
                                    setImportStatus({ success: true, message: 'جاري تحديث الأسعار...' });
                                    try {
                                        // 1. Fetch Orders with 0 price created TODAY
                                        const today = new Date().toISOString().split('T')[0];
                                        const [allOrders, services] = await Promise.all([db.getAllOrdersUnpaginated(), db.getServices()]);

                                        // Helper for normalization
                                        const norm = (t: string) => t.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u065F]/g, '');

                                        const zeroPriceOrders = allOrders.filter(o => {
                                            const isToday = o.createdAt.startsWith(today);
                                            const isZero = o.totalPrice === 0;
                                            return isToday && isZero;
                                        });

                                        if (zeroPriceOrders.length === 0) {
                                            setImportStatus({ success: true, message: 'لا توجد أوردرات صفرية مسجلة اليوم.' });
                                            return;
                                        }

                                        let updatedCount = 0;
                                        const updates: any[] = [];

                                        for (const order of zeroPriceOrders) {
                                            let orderUpdated = false;
                                            let newTotal = 0;
                                            const newItems = order.items?.map(item => {
                                                let finalPrice = item.price;
                                                // Only update if price is 0
                                                if (finalPrice === 0 && item.serviceType) {
                                                    const matchedService = services.find(s => norm(s.name) === norm(item.serviceType));
                                                    if (matchedService) {
                                                        finalPrice = matchedService.sellingPrice;
                                                        orderUpdated = true;
                                                    }
                                                }
                                                newTotal += (finalPrice * (item.teethNumbers?.length || 1));
                                                return { ...item, price: finalPrice };
                                            });

                                            if (orderUpdated) {
                                                updatedCount++;
                                                updates.push({
                                                    ...order,
                                                    items: newItems,
                                                    totalPrice: newTotal > 0 ? newTotal : order.totalPrice, // Update total if calculated > 0
                                                    cost: order.cost // Keep cost as is for now unless logic requires update, but usually cost depends on external factors. For internal lab, maybe standard cost? keeping simple.
                                                });
                                            }
                                        }

                                        if (updates.length > 0) {
                                            await db.bulkUpsertOrders(updates);
                                            setImportStatus({ success: true, message: `تم تحديث أسعار ${updatedCount} أوردر بنجاح!` });
                                        } else {
                                            setImportStatus({ success: true, message: 'تم الفحص ولكن لم يتم العثور على خدمات مطابقة لتحديث أسعارها.' });
                                        }

                                    } catch (err: any) {
                                        setImportStatus({ success: false, message: `حدث خطأ: ${err.message}` });
                                    }
                                }}
                                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-lg shadow-sm transition-colors"
                            >
                                بدء التصحيح
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Excel Import Section - Admin Only */}
            {isAdmin && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <FileSpreadsheet size={18} className="text-emerald-600" />
                            استيراد من Excel (Strict Mode)
                        </h2>
                    </div>
                    <div className="p-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                            <h3 className="font-bold text-blue-900 text-sm mb-2 flex items-center gap-2">
                                <AlertCircle size={16} />
                                تنبيه هام حول دقة الاستيراد
                            </h3>
                            <p className="text-xs text-blue-800 leading-relaxed mb-3">
                                تم تفعيل "الوضع الصارم" لضمان عدم تداخل البيانات. يرجى التأكد من اختيار نوع الملف الصحيح قبل الرفع.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                                <div className="bg-white/60 p-2 rounded-lg border border-blue-100">
                                    <strong className="text-blue-700 block mb-1">التحصيلات والموردين</strong>
                                    تم تفعيل البحث الذكي للأسماء (مثلاً ي/ى، أ/ا واحد).
                                </div>
                                <div className="bg-white/60 p-2 rounded-lg border border-blue-100">
                                    <strong className="text-blue-700 block mb-1">تقارير الأخطاء</strong>
                                    في حال فشل أي صف، سيتم عرض قائمة تفصيلية بالأخطاء لتصحيحها.
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {/* Doctor Collections */}
                            <ImportButton
                                title="استيراد تحصيلات"
                                subtitle="دفعات الأطباء"
                                color="blue"
                                icon={<Download size={20} />}
                                onFileSelect={async (file: File) => {
                                    const [doctors, suppliers] = await Promise.all([db.getDoctors(), db.getSuppliers()]);
                                    const txs = await importTransactionsFromExcel(file, doctors, suppliers, 'doctor');
                                    return await db.bulkUpsertTransactions(txs);
                                }}
                                setStatus={setImportStatus}
                                setLoading={setIsImporting}
                                loading={isImporting}
                            />

                            {/* Supplier Payments */}
                            <ImportButton
                                title="استيراد سدادات"
                                subtitle="دفعات الموردين"
                                color="amber"
                                icon={<Upload size={20} />}
                                onFileSelect={async (file: File) => {
                                    const [doctors, suppliers] = await Promise.all([db.getDoctors(), db.getSuppliers()]);
                                    const txs = await importTransactionsFromExcel(file, doctors, suppliers, 'supplier');
                                    return await db.bulkUpsertTransactions(txs);
                                }}
                                setStatus={setImportStatus}
                                setLoading={setIsImporting}
                                loading={isImporting}
                            />

                            {/* Expenses */}
                            <ImportButton
                                title="مصروفات متنوعة"
                                subtitle="إيجارات، فواتير، إلخ"
                                color="red"
                                icon={<AlertCircle size={20} />}
                                onFileSelect={async (file: File) => {
                                    const [doctors, suppliers] = await Promise.all([db.getDoctors(), db.getSuppliers()]);
                                    const txs = await importTransactionsFromExcel(file, doctors, suppliers, 'expense');
                                    return await db.bulkUpsertTransactions(txs);
                                }}
                                setStatus={setImportStatus}
                                setLoading={setIsImporting}
                                loading={isImporting}
                            />

                            {/* Orders */}
                            <ImportButton
                                title="استيراد حالات"
                                subtitle="كشف الحالات مجمع"
                                color="purple"
                                icon={<FileSpreadsheet size={20} />}
                                onFileSelect={async (file: File) => {
                                    const [doctors, suppliers, services] = await Promise.all([db.getDoctors(), db.getSuppliers(), db.getServices()]);
                                    const orders = await importOrdersFromExcel(file, doctors, suppliers, services);
                                    return await db.bulkUpsertOrders(orders);
                                }}
                                setStatus={setImportStatus}
                                setLoading={setIsImporting}
                                loading={isImporting}
                            />

                            {/* Doctors */}
                            <ImportButton
                                title="قائمة الأطباء"
                                subtitle="أطباء جدد / تحديث"
                                color="indigo"
                                icon={<SettingsIcon size={20} />}
                                onFileSelect={async (file: File) => {
                                    const doctors = await importDoctorsFromExcel(file);
                                    return await db.bulkUpsertDoctors(doctors);
                                }}
                                setStatus={setImportStatus}
                                setLoading={setIsImporting}
                                loading={isImporting}
                            />

                            {/* Services */}
                            <ImportButton
                                title="قائمة الخدمات"
                                subtitle="الأسعار والتكاليف"
                                color="emerald"
                                icon={<CheckCircle size={20} />}
                                onFileSelect={async (file: File) => {
                                    const services = await importServicesFromExcel(file);
                                    return await db.bulkUpsertServices(services);
                                }}
                                setStatus={setImportStatus}
                                setLoading={setIsImporting}
                                loading={isImporting}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Danger Zone - Restored specific for re-import */}
            {/* Danger Zone - Restored specific for re-import */}

        </div >
    );
}

// --- Helper Components ---

function ImportButton({ title, subtitle, color, icon, onFileSelect, setStatus, setLoading, loading }: any) {
    const colorClasses: any = {
        blue: 'hover:border-blue-400 hover:bg-blue-50 text-blue-600 bg-blue-100',
        green: 'hover:border-green-400 hover:bg-green-50 text-green-600 bg-green-100',
        amber: 'hover:border-amber-400 hover:bg-amber-50 text-amber-600 bg-amber-100',
        red: 'hover:border-red-400 hover:bg-red-50 text-red-600 bg-red-100',
        purple: 'hover:border-purple-400 hover:bg-purple-50 text-purple-600 bg-purple-100',
        indigo: 'hover:border-indigo-400 hover:bg-indigo-50 text-indigo-600 bg-indigo-100',
        emerald: 'hover:border-emerald-400 hover:bg-emerald-50 text-emerald-600 bg-emerald-100'
    };

    const activeColor = colorClasses[color] || colorClasses.blue;

    return (
        <div className="relative group">
            <input
                type="file"
                accept=".xlsx,.xls"
                onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setLoading(true);
                    setStatus({ success: true, message: `جاري ${title}...` });
                    try {
                        const count = await onFileSelect(file);
                        setStatus({ success: true, message: `تمت العملية بنجاح! تم استيراد ${count} عنصر.` });
                        e.target.value = '';
                    } catch (error: any) {
                        setStatus({ success: false, message: error?.message || 'فشل الاستيراد' });
                    } finally {
                        setLoading(false);
                    }
                }}
                disabled={loading}
                aria-label={title}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className={`p-4 border-2 border-dashed border-gray-200 rounded-2xl text-right transition-all group-hover:shadow-md cursor-pointer ${activeColor}`}>
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/80 rounded-lg group-hover:scale-110 transition-transform">
                        {icon}
                    </div>
                    <div>
                        <div className="font-bold text-sm">{title}</div>
                        <div className="text-[10px] opacity-70">{subtitle}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

