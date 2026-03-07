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
            {isAdmin && (
                <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">أدوات إصلاح البيانات</h3>
                    <div className="space-y-4">
                        {/* Migrate Old Delegate Expenses */}
                        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                            <h4 className="font-semibold text-orange-800 mb-2">ترحيل مصاريف المناديب القديمة</h4>
                            <p className="text-sm text-orange-700 mb-4">
                                هذا الزر سيقوم بنقل مصاريف المناديب التي سُجلت خطأ في المصروفات العامة إلى قسم المناديب، وتغيير نوعها إلى "شحن وتوصيل".
                            </p>
                            <button
                                onClick={async () => {
                                    try {
                                        const [allTransactions, allUsers] = await Promise.all([
                                            db.getTransactions(),
                                            db.getUsers()
                                        ]);
                                        const reps = allUsers.filter(u =>
                                            u.role === 'representative' || (u.role === 'admin' && u.username !== 'admin')
                                        );
                                        const repIds = new Set(reps.map(r => r.id));

                                        const oldRepExpenses = allTransactions.filter(t =>
                                            t.type === 'expense' &&
                                            (t.entityType === 'general' || !t.entityType) &&
                                            t.entityId &&
                                            repIds.has(t.entityId) &&
                                            !t.description?.includes('راتب شهر') &&
                                            t.date >= '2026-02-10'
                                        );

                                        if (oldRepExpenses.length === 0) {
                                            alert('لا توجد مصاريف مناديب قديمة للترحيل.');
                                            return;
                                        }

                                        const total = oldRepExpenses.reduce((s, e) => s + e.amount, 0);
                                        if (!window.confirm(`سيتم ترحيل ${oldRepExpenses.length} مصروف بإجمالي ${total} ج.م إلى قسم المناديب مع تغيير النوع لـ "شحن وتوصيل". متأكد؟`)) return;

                                        let count = 0;
                                        for (const exp of oldRepExpenses) {
                                            await db.updateTransaction(exp.id, {
                                                entityType: 'representative',
                                                category: 'شحن وتوصيل',
                                            });
                                            count++;
                                        }
                                        alert(`تم ترحيل ${count} مصروف بنجاح ✅`);
                                        window.location.reload();
                                    } catch (error) {
                                        alert('حدث خطأ: ' + error);
                                    }
                                }}
                                className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition-colors"
                            >
                                ترحيل مصاريف المناديب
                            </button>
                        </div>

                        {/* Service Name Normalization Tool */}
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <h4 className="font-semibold text-blue-800 mb-2">توحيد أسماء الخدمات</h4>
                            <p className="text-sm text-blue-700 mb-4">
                                يوحد أسماء الخدمات بناءً على القائمة الرسمية المعتمدة. يعالج اختلاف الحروف (Capital/Small) والأخطاء الإملائية المعروفة.
                            </p>
                            <button
                                onClick={async () => {
                                    try {
                                        // Helper for robust normalization
                                        const normalizeName = (name: string) => {
                                            return name
                                                .toLowerCase()
                                                .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
                                                .replace(/\s+/g, ' ')                   // Collapse multiple spaces
                                                .trim();
                                        };

                                        // 1. HARDCODED CORRECT NAMES (The Source of Truth)
                                        const OFFICIAL_NAMES = [
                                            "Crown Lengthening Guide",
                                            "Custom Abutment Ti",
                                            "Custom Abutment Zr",
                                            "Cut Back",
                                            "Each Implant Extra in Guide",
                                            "Emax Anterior",
                                            "Emax Posterior",
                                            "Emax Ivoclar Anterior",
                                            "Emax Ivoclar Posterior",
                                            "Full Arch Denture Print",
                                            "Full Denture Acrylic (Hard)",
                                            "Gingiva for Framework",
                                            "Mock Up Cast (Smile Design)",
                                            "Orthodontic Retainer & Night Guard",
                                            "Permanent Resin",
                                            "PFM vm13",
                                            "PMMA Milled",
                                            "Print Cast only",
                                            "Print Guide only",
                                            "Printed PMMA",
                                            "Removable",
                                            "Removable Partial by tooth",
                                            "Scan Appliance Full Arch",
                                            "Scan Appliance Half Arch",
                                            "Scanner Rent",
                                            "Surgical Guide One Tooth",
                                            "Temporary Crown Print",
                                            "Toronto Metal Framework (Print)",
                                            "Toronto TI Framework (Mill)",
                                            "Zircomax",
                                            "Zircomax Elite",
                                            "Zr Elite Multi Layer",
                                            "Zr Elite Preshade",
                                            "Zr Multi Layer",
                                            "Zr Post",
                                            "Zr Preshade"
                                        ];

                                        // Lookup map: normalized key -> Official Name
                                        const officialMap = new Map<string, string>();
                                        OFFICIAL_NAMES.forEach(name => {
                                            officialMap.set(normalizeName(name), name);
                                        });

                                        // Manual aliases for stubborn cases (keys must be normalized)
                                        const MANUAL_ALIASES: Record<string, string> = {
                                            'cutback': 'Cut Back',
                                            'pfm vm 13': 'PFM vm13',
                                            'pfm vm13': 'PFM vm13',
                                            'pmma milled': 'PMMA Milled',
                                            'toronto ti framework (mill)': 'Toronto TI Framework (Mill)',
                                            // Specific user examples just in case
                                            'emax ivoclar anterior': 'Emax Ivoclar Anterior',
                                        };

                                        // 2. Fetch ALL order_items
                                        const { data: allItems, error: fetchError } = await supabase
                                            .from('order_items')
                                            .select('product_type');
                                        if (fetchError) throw fetchError;

                                        // Count occurrences
                                        const countMap = new Map<string, number>();
                                        (allItems || []).forEach((row: any) => {
                                            if (row.product_type) {
                                                const name = row.product_type; // Keep raw string to detect whitespace issues
                                                countMap.set(name, (countMap.get(name) || 0) + 1);
                                            }
                                        });

                                        // 3. Build rename map
                                        const renameMap: { from: string; to: string; reason: string }[] = [];

                                        countMap.forEach((_count, name) => {
                                            const normalized = normalizeName(name);

                                            // A. Check against Official List (Normalized Match)
                                            const official = officialMap.get(normalized);
                                            if (official) {
                                                if (official !== name) {
                                                    renameMap.push({ from: name, to: official, reason: 'Official List Match' });
                                                }
                                                return;
                                            }

                                            // B. Check Manual Aliases (Normalized Keys)
                                            if (MANUAL_ALIASES[normalized]) {
                                                if (MANUAL_ALIASES[normalized] !== name) {
                                                    renameMap.push({ from: name, to: MANUAL_ALIASES[normalized], reason: 'Manual Alias' });
                                                }
                                                return;
                                            }
                                        });


                                        // 5. Execute Relational Updates
                                        let updatedCount = 0;
                                        for (const rename of renameMap) {
                                            const { data: updated, error: updateError } = await supabase
                                                .from('order_items')
                                                .update({ product_type: rename.to })
                                                .eq('product_type', rename.from)
                                                .select('id');

                                            if (updateError) {
                                                console.error(`Error: "${rename.from}":`, updateError);
                                            } else {
                                                updatedCount += updated?.length || 0;
                                            }
                                        }

                                        // 6. Update Legacy JSON (orders.items)
                                        // Fetch orders with non-empty items
                                        const { data: legacyOrders, error: legacyError } = await supabase
                                            .from('orders')
                                            .select('id, items')
                                            .not('items', 'is', null);

                                        let jsonUpdatedCount = 0;
                                        if (legacyOrders && !legacyError) {
                                            for (const order of legacyOrders) {
                                                const items = order.items;
                                                if (Array.isArray(items)) {
                                                    let changed = false;
                                                    const newItems = items.map((item: any) => {
                                                        if (item.serviceType) {
                                                            const normalized = normalizeName(item.serviceType);
                                                            // Check official map
                                                            const official = officialMap.get(normalized);
                                                            if (official && official !== item.serviceType) {
                                                                changed = true;
                                                                return { ...item, serviceType: official };
                                                            }
                                                            // Check manual aliases
                                                            if (MANUAL_ALIASES[normalized] && MANUAL_ALIASES[normalized] !== item.serviceType) {
                                                                changed = true;
                                                                return { ...item, serviceType: MANUAL_ALIASES[normalized] };
                                                            }
                                                        }
                                                        return item;
                                                    });

                                                    if (changed) {
                                                        const { error: jsonUpdateError } = await supabase
                                                            .from('orders')
                                                            .update({ items: newItems })
                                                            .eq('id', order.id);

                                                        if (!jsonUpdateError) {
                                                            jsonUpdatedCount++;
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        alert(`تم توحيد ${updatedCount} سجل (Relational) و ${jsonUpdatedCount} سجل (Legacy JSON) بنجاح ✅`);
                                        window.location.reload();
                                    } catch (error) {
                                        alert('حدث خطأ: ' + error);
                                        console.error(error);
                                    }
                                }}
                                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                            >
                                توحيد أسماء الخدمات
                            </button>
                        </div>

                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <h4 className="font-semibold text-yellow-800 mb-2">حذف الحالات المستوردة اليوم</h4>
                            <p className="text-sm text-yellow-700 mb-4">
                                هذا الزر سيقوم بحذف جميع الحالات التي تم استيرادها اليوم (التي تحتوي على ملاحظة 'Imported / استيراد تلقائي').
                                يرجى استخدام هذا الزر بحذر وفقط إذا كنت متأكداً من رغبتك في حذف هذه الحالات.
                            </p>
                            <button
                                onClick={async () => {
                                    if (window.confirm('هل أنت متأكد تماماً من رغبتك في حذف جميع الحالات المستوردة اليوم؟ لا يمكن التراجع عن هذا الإجراء.')) {
                                        try {
                                            const today = new Date().toISOString().split('T')[0];
                                            const result = await db.getOrders(1, 1000); // Fetch recent orders
                                            const importedOrders = result.data.filter(o =>
                                                o.feedback?.notes === 'Imported / استيراد تلقائي' &&
                                                o.createdAt.startsWith(today)
                                            );

                                            if (importedOrders.length === 0) {
                                                alert('لا توجد حالات مستوردة اليوم.');
                                                return;
                                            }

                                            if (window.confirm(`سيتم حذف ${importedOrders.length} حالة. هل أنت متأكد؟`)) {
                                                let deletedCount = 0;
                                                for (const order of importedOrders) {
                                                    await db.deleteOrder(order.id);
                                                    deletedCount++;
                                                }
                                                alert(`تم حذف ${deletedCount} حالة بنجاح.`);
                                                window.location.reload();
                                            }
                                        } catch (error) {
                                            alert('حدث خطأ أثناء الحذف: ' + error);
                                        }
                                    }
                                }}
                                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
                            >
                                حذف الحالات المستوردة
                            </button>
                        </div>
                    </div>
                </div>
            )
            }

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
