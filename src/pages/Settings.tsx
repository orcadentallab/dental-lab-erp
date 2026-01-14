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
                <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${importStatus.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {importStatus.success ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                    <span className="font-medium">{importStatus.message}</span>
                </div>
            )}

            {/* Backup Section - Admin Only */}
            {isAdmin && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <h2 className="font-bold text-gray-800">النسخ الاحتياطى على الكمبيوتر</h2>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Export */}
                        <button
                            onClick={handleExport}
                            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-right"
                        >
                            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                                <Download size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-800">حفظ نسخة</h3>
                                <p className="text-xs text-gray-500">تحميل ملف البيانات</p>
                            </div>
                        </button>

                        {/* Import */}
                        <div className="relative">
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleImport}
                                aria-label="استيراد نسخة احتياطية"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <div className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-colors text-right cursor-pointer">
                                <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                                    <Upload size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800">استرجاع</h3>
                                    <p className="text-xs text-gray-500">رفع ملف نسخة احتياطية</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Cloud Backup - Admin Only */}
                    <div className="p-4 border-t border-gray-100 bg-emerald-50">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-lg text-emerald-600">
                                    <Cloud size={18} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-emerald-900 text-sm">نسخ سحابي</h3>
                                    <p className="text-xs text-emerald-700">نسخة احتياطية على السيرفر</p>
                                </div>
                            </div>
                            <button
                                onClick={() => window.open('https://github.com/orcadentallab/dental-lab-erp/actions/workflows/backup.yml', '_blank')}
                                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700"
                            >
                                تشغيل
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Password Change Section */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                    <h2 className="font-bold text-gray-800 flex items-center gap-2">
                        <Lock size={18} />
                        تغيير كلمة المرور
                    </h2>
                </div>
                <div className="p-4 space-y-3">
                    <input
                        type="password"
                        placeholder="كلمة المرور الحالية"
                        value={oldPassword}
                        aria-label="كلمة المرور الحالية"
                        onChange={(e) => setOldPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-400 outline-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <input
                            type="password"
                            placeholder="كلمة المرور الجديدة (8 أحرف على الأقل)"
                            value={newPassword}
                            aria-label="كلمة المرور الجديدة"
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-400 outline-none"
                        />
                        <input
                            type="password"
                            placeholder="تأكيد كلمة المرور"
                            value={confirmPassword}
                            aria-label="تأكيد كلمة المرور"
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-400 outline-none"
                        />
                    </div>
                    <button
                        onClick={handlePasswordChange}
                        disabled={isChangingPassword || !oldPassword || !newPassword || !confirmPassword}
                        className="px-4 py-2 bg-gray-800 text-white text-sm font-bold rounded-lg hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isChangingPassword ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
                    </button>
                </div>
            </div>

            {/* Excel Import Section - Admin Only */}
            {isAdmin && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <FileSpreadsheet size={18} className="text-green-600" />
                            استيراد من Excel
                        </h2>
                    </div>
                    <div className="p-4">
                        {/* Format Guide - Expandable */}
                        <details className="mb-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <summary className="p-3 cursor-pointer font-medium text-blue-800 text-sm">📋 ما هي البيانات المطلوبة في كل ملف؟</summary>
                            <div className="p-3 pt-0 text-xs text-blue-900 space-y-2">
                                <p><strong className="text-blue-700">الأطباء:</strong> اسم الطبيب، الهاتف، العنوان، كود الطبيب، اسم المندوب</p>
                                <p><strong className="text-green-700">الخدمات:</strong> اسم الخدمة، سعر البيع، سعر التكلفة</p>
                                <p><strong className="text-purple-700">الحالات:</strong> اسم الطبيب أو كود الطبيب، اسم المريض، رقم الحالة، الخدمات، السعر، التاريخ</p>
                                <p><strong className="text-amber-700">الحسابات:</strong> النوع (دخل/مصروف)، المبلغ، الفئة، التاريخ، الوصف</p>
                            </div>
                        </details>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {/* Doctors */}
                            <div className="relative">
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        setIsImporting(true);
                                        setImportStatus({ success: true, message: 'جاري استيراد الأطباء...' });
                                        try {
                                            const doctors = await importDoctorsFromExcel(file);
                                            const count = await db.bulkUpsertDoctors(doctors);
                                            setImportStatus({ success: true, message: `تم استيراد ${count} طبيب` });
                                            e.target.value = '';
                                        } catch (error: any) {
                                            setImportStatus({ success: false, message: error?.message || 'فشل الاستيراد' });
                                        } finally {
                                            setIsImporting(false);
                                        }
                                    }}
                                    disabled={isImporting}
                                    aria-label="استيراد الأطباء"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className="p-3 border border-dashed border-gray-300 rounded-lg text-center hover:border-blue-400 hover:bg-blue-50 cursor-pointer">
                                    <div className="text-blue-600 font-bold text-sm">الأطباء</div>
                                </div>
                            </div>

                            {/* Services */}
                            <div className="relative">
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        setIsImporting(true);
                                        setImportStatus({ success: true, message: 'جاري استيراد الخدمات...' });
                                        try {
                                            const services = await importServicesFromExcel(file);
                                            const count = await db.bulkUpsertServices(services);
                                            setImportStatus({ success: true, message: `تم استيراد ${count} خدمة` });
                                            e.target.value = '';
                                        } catch (error: any) {
                                            setImportStatus({ success: false, message: error?.message || 'فشل الاستيراد' });
                                        } finally {
                                            setIsImporting(false);
                                        }
                                    }}
                                    disabled={isImporting}
                                    aria-label="استيراد الخدمات"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className="p-3 border border-dashed border-gray-300 rounded-lg text-center hover:border-green-400 hover:bg-green-50 cursor-pointer">
                                    <div className="text-green-600 font-bold text-sm">الخدمات</div>
                                </div>
                            </div>

                            {/* Orders */}
                            <div className="relative">
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        setIsImporting(true);
                                        setImportStatus({ success: true, message: 'جاري استيراد الحالات...' });
                                        try {
                                            const [doctors, suppliers, services] = await Promise.all([
                                                db.getDoctors(),
                                                db.getSuppliers(),
                                                db.getServices()
                                            ]);
                                            const orders = await importOrdersFromExcel(file, doctors, suppliers, services);
                                            const count = await db.bulkUpsertOrders(orders);
                                            setImportStatus({ success: true, message: `تم استيراد ${count} حالة` });
                                            e.target.value = '';
                                        } catch (error: any) {
                                            setImportStatus({ success: false, message: error?.message || 'فشل الاستيراد' });
                                        } finally {
                                            setIsImporting(false);
                                        }
                                    }}
                                    disabled={isImporting}
                                    aria-label="استيراد الحالات"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className="p-3 border border-dashed border-gray-300 rounded-lg text-center hover:border-purple-400 hover:bg-purple-50 cursor-pointer">
                                    <div className="text-purple-600 font-bold text-sm">الحالات</div>
                                </div>
                            </div>

                            {/* Transactions */}
                            <div className="relative">
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        setIsImporting(true);
                                        setImportStatus({ success: true, message: 'جاري استيراد الحسابات...' });
                                        try {
                                            const transactions = await importTransactionsFromExcel(file);
                                            const count = await db.bulkUpsertTransactions(transactions);
                                            setImportStatus({ success: true, message: `تم استيراد ${count} معاملة` });
                                            e.target.value = '';
                                        } catch (error: any) {
                                            setImportStatus({ success: false, message: error?.message || 'فشل الاستيراد' });
                                        } finally {
                                            setIsImporting(false);
                                        }
                                    }}
                                    disabled={isImporting}
                                    aria-label="استيراد الحسابات"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className="p-3 border border-dashed border-gray-300 rounded-lg text-center hover:border-amber-400 hover:bg-amber-50 cursor-pointer">
                                    <div className="text-amber-600 font-bold text-sm">الحسابات</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Danger Zone - Restored specific for re-import */}

        </div >
    );
}
