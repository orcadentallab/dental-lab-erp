import { useState } from 'react';
import { db } from '../services/db';
import { Download, Upload, Database, AlertCircle, CheckCircle, Save, Share2, FileSpreadsheet } from 'lucide-react';
import { importDoctorsFromExcel, importServicesFromExcel, importOrdersFromExcel, importTransactionsFromExcel } from '../lib/excelImporter';

export default function Settings() {
    const [importStatus, setImportStatus] = useState<{ success?: boolean; message?: string } | null>(null);
    const [isImporting, setIsImporting] = useState(false);

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
            setImportStatus({ success: true, message: 'جاري استيراد البيانات... يرجى الانتظار' });

            try {
                const result = await db.importData(content);
                if (result.success) {
                    setImportStatus({ success: true, message: 'تم استرجاع البيانات بنجاح! يرجى تحديث الصفحة.' });
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    setImportStatus({ success: false, message: `فشل الاسترجاع: ${result.error}` });
                }
            } catch (err: any) {
                setImportStatus({ success: false, message: `حدث خطأ غير متوقع: ${err.message}` });
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">الإعدادات والنسخ الاحتياطي</h1>
                    <p className="text-gray-500">إدارة قاعدة البيانات ومشاركة النظام</p>
                </div>
            </div>

            {/* Sharing Guide */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-6">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-white rounded-xl shadow-sm text-blue-600">
                        <Share2 size={24} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-blue-900 mb-2">كيف تشارك بياناتك مع شخص آخر؟</h3>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800 leading-relaxed">
                            <li>قم بتحميل <strong>نسخة احتياطية</strong> من بياناتك الحالية (زر "حفظ البيانات" بالأسفل).</li>
                            <li>أرسل <strong>رابط الموقع</strong> + <strong>ملف البيانات</strong> (ملف .json) للشخص الآخر.</li>
                            <li>الطرف الآخر يفتح الموقع، يدخل صفحة الإعدادات، ويختار <strong>"استرجاع البيانات"</strong> ويرفع الملف.</li>
                            <li>سيظهر لديه كل الشغل والبيانات الخاصة بك فوراً! ✅</li>
                        </ol>
                    </div>
                </div>
            </div>

            {/* Backup Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* EXPORT */}
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center hover:border-blue-200 transition-colors">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
                        <Download size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">حفظ نسخة احتياطية (Export)</h3>
                    <p className="text-gray-500 text-sm mb-6">تحميل كل بيانات النظام (الأوردرات، الحسابات، الأطباء) في ملف واحد.</p>
                    <button
                        onClick={handleExport}
                        className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                    >
                        <Save size={20} />
                        تحميل الملف الآن
                    </button>
                </div>

                {/* IMPORT */}
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center hover:border-amber-200 transition-colors">
                    <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mb-4">
                        <Upload size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">استرجاع بيانات (Import)</h3>
                    <p className="text-gray-500 text-sm mb-6">رفع ملف نسخة احتياطية لاستبدال البيانات الحالية ببيانات الملف.</p>

                    <div className="w-full relative">
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleImport}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <button className="w-full py-3 bg-white border-2 border-amber-500 text-amber-700 rounded-xl font-bold hover:bg-amber-50 transition-colors flex items-center justify-center gap-2">
                            <Database size={20} />
                            اختيار ملف لاسترجاعه
                        </button>
                    </div>
                </div>
            </div>

            {/* BULK MERGE (Advanced) */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                    <Database className="text-purple-600" />
                    <h3 className="text-lg font-bold text-gray-800">دمج بيانات (Bulk Merge)</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    استخدم هذا القسم لإضافة بيانات جديدة (أوردرات أو معاملات مالية) إلى النظام الحالي دون حذف البيانات القديمة.
                    يرجى لصق البيانات بصيغة JSON Array.
                </p>

                <div className="space-y-4">
                    <details className="group bg-gray-50 border border-gray-200 rounded-xl">
                        <summary className="p-4 font-bold cursor-pointer list-none flex justify-between items-center text-gray-700">
                            <span>استيراد أوردرات (Orders)</span>
                            <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="p-4 border-t border-gray-200">
                            <textarea
                                id="orders-json"
                                className="w-full h-32 p-3 font-mono text-xs border rounded-lg mb-2"
                                placeholder='[{"patientName": "...", "doctorId": "...", "items": [...], "createdAt": "2023-01-01T..."}]'
                            ></textarea>
                            <button
                                onClick={async () => {
                                    try {
                                        const el = document.getElementById('orders-json') as HTMLTextAreaElement;
                                        const data = JSON.parse(el.value);
                                        if (!Array.isArray(data)) throw new Error("يجب أن يكون الملف بصيغة قائمة []");
                                        const count = await db.bulkUpsertOrders(data);
                                        setImportStatus({ success: true, message: `تم إضافة / تحديث ${count} أوردر بنجاح` });
                                        el.value = '';
                                    } catch (e: any) {
                                        setImportStatus({ success: false, message: `خطأ في البيانات: ${e.message}` });
                                    }
                                }}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
                            >
                                دمج الأوردرات
                            </button>
                        </div>
                    </details>

                    <details className="group bg-gray-50 border border-gray-200 rounded-xl">
                        <summary className="p-4 font-bold cursor-pointer list-none flex justify-between items-center text-gray-700">
                            <span>استيراد معاملات مالية (Transactions)</span>
                            <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="p-4 border-t border-gray-200">
                            <textarea
                                id="tx-json"
                                className="w-full h-32 p-3 font-mono text-xs border rounded-lg mb-2"
                                placeholder='[{"type": "expense", "amount": 100, "description": "...", "date": "..."}]'
                            ></textarea>
                            <button
                                onClick={async () => {
                                    try {
                                        const el = document.getElementById('tx-json') as HTMLTextAreaElement;
                                        const data = JSON.parse(el.value);
                                        if (!Array.isArray(data)) throw new Error("يجب أن يكون الملف بصيغة قائمة []");
                                        const count = await db.bulkUpsertTransactions(data);
                                        setImportStatus({ success: true, message: `تم إضافة / تحديث ${count} معاملة بنجاح` });
                                        el.value = '';
                                    } catch (e: any) {
                                        setImportStatus({ success: false, message: `خطأ في البيانات: ${e.message}` });
                                    }
                                }}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                            >
                                دمج المعاملات
                            </button>
                        </div>
                    </details>
                </div>
            </div>

            {/* Excel Import Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 mb-4">
                    <FileSpreadsheet className="text-green-600" size={24} />
                    <h3 className="text-lg font-bold text-gray-800">استيراد من Excel</h3>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    استيراد البيانات القديمة من ملفات Excel (الأطباء، الخدمات، الحالات، الحسابات) دفعة واحدة.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Import Doctors */}
                    <div className="border border-gray-200 rounded-xl p-4">
                        <h4 className="font-bold text-gray-700 mb-2">استيراد الأطباء</h4>
                        <p className="text-xs text-gray-500 mb-3">
                            الملف يجب أن يحتوي على: اسم الطبيب، الهاتف، العنوان، كود الطبيب، اسم المندوب
                        </p>
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
                                    console.log('Parsed doctors:', doctors.length);
                                    const count = await db.bulkUpsertDoctors(doctors);
                                    setImportStatus({ success: true, message: `تم استيراد ${count} طبيب بنجاح!` });
                                    e.target.value = '';
                                } catch (error: any) {
                                    console.error('Import doctors error:', error);
                                    const errorMsg = error?.userMessage || error?.message || 'حدث خطأ أثناء استيراد الأطباء';
                                    setImportStatus({ success: false, message: errorMsg });
                                } finally {
                                    setIsImporting(false);
                                }
                            }}
                            disabled={isImporting}
                            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
                        />
                    </div>

                    {/* Import Services */}
                    <div className="border border-gray-200 rounded-xl p-4">
                        <h4 className="font-bold text-gray-700 mb-2">استيراد الخدمات</h4>
                        <p className="text-xs text-gray-500 mb-3">
                            الملف يجب أن يحتوي على: اسم الخدمة، سعر البيع، سعر التكلفة
                        </p>
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
                                    console.log('Parsed services:', services.length);
                                    const count = await db.bulkUpsertServices(services);
                                    setImportStatus({ success: true, message: `تم استيراد ${count} خدمة بنجاح!` });
                                    e.target.value = '';
                                } catch (error: any) {
                                    console.error('Import services error:', error);
                                    const errorMsg = error?.userMessage || error?.message || 'حدث خطأ أثناء استيراد الخدمات';
                                    setImportStatus({ success: false, message: errorMsg });
                                } finally {
                                    setIsImporting(false);
                                }
                            }}
                            disabled={isImporting}
                            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 disabled:opacity-50"
                        />
                    </div>

                    {/* Import Orders */}
                    <div className="border border-gray-200 rounded-xl p-4">
                        <h4 className="font-bold text-gray-700 mb-2">استيراد الحالات</h4>
                        <p className="text-xs text-gray-500 mb-3">
                            الملف يجب أن يحتوي على: اسم الطبيب أو كود الطبيب، اسم المريض، رقم الحالة، الخدمات، السعر
                        </p>
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                setIsImporting(true);
                                setImportStatus({ success: true, message: 'جاري استيراد الحالات...' });

                                try {
                                    // First get all doctors to match them
                                    const doctors = await db.getDoctors();
                                    console.log('Loaded doctors:', doctors.length);
                                    const orders = await importOrdersFromExcel(file, doctors);
                                    console.log('Parsed orders:', orders.length);
                                    const count = await db.bulkUpsertOrders(orders);
                                    setImportStatus({ success: true, message: `تم استيراد ${count} حالة بنجاح!` });
                                    e.target.value = '';
                                } catch (error: any) {
                                    console.error('Import error:', error);
                                    const errorMsg = error?.userMessage || error?.message || 'حدث خطأ أثناء الاستيراد';
                                    setImportStatus({ success: false, message: errorMsg });
                                } finally {
                                    setIsImporting(false);
                                }
                            }}
                            disabled={isImporting}
                            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50"
                        />
                    </div>

                    {/* Import Transactions */}
                    <div className="border border-gray-200 rounded-xl p-4">
                        <h4 className="font-bold text-gray-700 mb-2">استيراد الحسابات</h4>
                        <p className="text-xs text-gray-500 mb-3">
                            الملف يجب أن يحتوي على: النوع (دخل/مصروف)، المبلغ، الفئة، التاريخ، الوصف
                        </p>
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
                                    setImportStatus({ success: true, message: `تم استيراد ${count} معاملة مالية بنجاح!` });
                                    e.target.value = '';
                                } catch (error: any) {
                                    setImportStatus({ success: false, message: error.message });
                                } finally {
                                    setIsImporting(false);
                                }
                            }}
                            disabled={isImporting}
                            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 disabled:opacity-50"
                        />
                    </div>
                </div>

                {/* Excel Format Guide */}
                <details className="mt-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <summary className="p-4 font-bold cursor-pointer text-blue-800">📋 دليل تنسيق ملفات Excel</summary>
                    <div className="p-4 border-t border-blue-200 space-y-4 text-sm text-blue-900">
                        <div>
                            <h5 className="font-bold mb-2">الأطباء:</h5>
                            <p className="text-xs">الأعمدة: اسم الطبيب، الهاتف، العنوان، كود الطبيب، اسم المندوب</p>
                        </div>
                        <div>
                            <h5 className="font-bold mb-2">الخدمات:</h5>
                            <p className="text-xs">الأعمدة: اسم الخدمة، سعر البيع، سعر التكلفة</p>
                        </div>
                        <div>
                            <h5 className="font-bold mb-2">الحالات:</h5>
                            <p className="text-xs">الأعمدة: اسم الطبيب (أو كود الطبيب)، اسم المريض، رقم الحالة، الخدمات، السعر، التاريخ</p>
                        </div>
                        <div>
                            <h5 className="font-bold mb-2">الحسابات:</h5>
                            <p className="text-xs">الأعمدة: النوع (دخل/مصروف)، المبلغ، الفئة، التاريخ، الوصف</p>
                        </div>
                        <p className="text-xs text-blue-700 mt-2">
                            💡 يمكن استخدام الأسماء العربية أو الإنجليزية للأعمدة
                        </p>
                    </div>
                </details>
            </div>

            {/* Status Messages */}
            {importStatus && (
                <div className={`p-4 rounded-xl flex items-center gap-3 ${importStatus.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {importStatus.success ? <CheckCircle /> : <AlertCircle />}
                    <p className="font-bold">{importStatus.message}</p>
                </div>
            )}
        </div>
    );
}
